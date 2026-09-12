param(
  [string]$Db = "D:\MITS\data\zdj-settings.sqlite",
  [string]$BackupDir = "D:\MITS\data\backups",
  [Parameter(Mandatory=$true)][string]$VerifiedRecoveryPoint,
  [switch]$Apply
)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { throw 'ENGINE_8080_IS_STILL_LISTENING' }
if (!(Test-Path $Db)) { throw "DB_NOT_FOUND: $Db" }
if (!(Test-Path $VerifiedRecoveryPoint)) { throw "RECOVERY_POINT_NOT_FOUND: $VerifiedRecoveryPoint" }
function Test-Sqlite([string]$Path) {
  $env:ZDJ_VERIFY_DB=$Path
  $out = node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.env.ZDJ_VERIFY_DB,{readOnly:true}); const r=db.prepare('PRAGMA integrity_check').get(); console.log(r.integrity_check); db.close();"
  Remove-Item Env:ZDJ_VERIFY_DB -ErrorAction SilentlyContinue
  if (($out | Select-Object -Last 1).Trim() -ne 'ok') { throw "SQLITE_INTEGRITY_FAILED: $Path" }
}
Write-Host "[1/5] Verify live DB"; Test-Sqlite $Db
Write-Host "[2/5] Verify recovery point"; Test-Sqlite $VerifiedRecoveryPoint
Write-Host "[3/5] Backup retention plan"; node scripts/prune-zdj-backups.mjs "--dir=$BackupDir" --keep=1 --max-age-days=14 --max-total-gb=12
Write-Host "[4/5] SQLite retention plan"; node scripts/maintain-storage.mjs "--db=$Db"
if (!$Apply) { Write-Host 'DRY_RUN_COMPLETE. Re-run with -Apply only after reviewing the two plans.'; exit 0 }
Write-Host "[3/5 APPLY] Remove redundant backup generations after verified recovery point"; node scripts/prune-zdj-backups.mjs "--dir=$BackupDir" --keep=1 --max-age-days=14 --max-total-gb=12 --apply --verified-recovery-point
Write-Host "[4/5 APPLY] Purge bounded historical data and build compact DB"; node scripts/maintain-storage.mjs "--db=$Db" --apply --engine-stopped --verified-recovery-point
$compact="$Db.compact"; if (!(Test-Path $compact)) { throw "COMPACT_DB_NOT_FOUND: $compact" }
Write-Host "[5/5] Verify compact DB"; Test-Sqlite $compact
$orig=(Get-Item $Db).Length; $new=(Get-Item $compact).Length
Write-Host "COMPACT_READY original=$orig compact=$new"
Write-Host 'Original DB has NOT been replaced. Review size/integrity, then perform an explicit atomic replacement in the next controlled step.'
