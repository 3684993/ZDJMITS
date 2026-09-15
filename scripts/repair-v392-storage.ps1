param(
  [string]$Db = "D:\MITS\data\zdj-settings.sqlite",
  [switch]$Apply
)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { throw 'ENGINE_8080_IS_STILL_LISTENING' }
$maintenanceArgs = @('scripts/maintain-storage.mjs', "--db=$Db")
if ($Apply) { $maintenanceArgs += @('--apply', '--engine-stopped') }
& node @maintenanceArgs
if ($LASTEXITCODE -ne 0) { throw "STORAGE_MAINTENANCE_FAILED: $LASTEXITCODE" }
if ($Apply) {
  Write-Host 'Verified replacement is ready. Original DB and all backups are unchanged.'
  Write-Host 'Review the .compact.verification.json before a separate explicit offline replacement. Backup pruning is only allowed after replacement verification.'
}
