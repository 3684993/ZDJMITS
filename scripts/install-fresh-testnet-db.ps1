param(
  [string]$DataDir = "D:\MITS\data",
  [string]$FreshName = "zdj-settings.sqlite.fresh"
)
$ErrorActionPreference='Stop'
if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { throw 'ENGINE_8080_IS_STILL_LISTENING' }
$live=Join-Path $DataDir 'zdj-settings.sqlite'; $fresh=Join-Path $DataDir $FreshName; $reportPath="$fresh.verification.json"
if(!(Test-Path $live)){throw 'LIVE_DB_NOT_FOUND'};if(!(Test-Path $fresh)){throw 'FRESH_DB_NOT_FOUND'};if(!(Test-Path $reportPath)){throw 'FRESH_VERIFICATION_NOT_FOUND'}
$report=Get-Content $reportPath -Raw | ConvertFrom-Json
if($report.status -ne 'FRESH_TESTNET_DB_READY_NOT_INSTALLED' -or $report.strategy -ne 'SCHEMA_ONLY_REBUILD' -or $report.integrity -ne 'ok' -or $report.autoVacuum -ne 'INCREMENTAL' -or $report.originalPreserved -ne $true){throw 'FRESH_VERIFICATION_STATUS_INVALID'}
$actualFresh=(Get-FileHash $fresh -Algorithm SHA256).Hash.ToLowerInvariant();if($actualFresh -ne [string]$report.outputHash){throw 'FRESH_DB_HASH_MISMATCH'}
$legacy="$live.legacy";$legacyWal="$legacy-wal";$legacyShm="$legacy-shm";foreach($p in @($legacy,$legacyWal,$legacyShm)){if(Test-Path $p){throw "LEGACY_TARGET_ALREADY_EXISTS:$p"}}
$installed=$false
try{
 Move-Item -LiteralPath $live -Destination $legacy
 if(Test-Path "$live-wal"){Move-Item -LiteralPath "$live-wal" -Destination $legacyWal}
 if(Test-Path "$live-shm"){Move-Item -LiteralPath "$live-shm" -Destination $legacyShm}
 Move-Item -LiteralPath $fresh -Destination $live
 $installed=$true
 $verifyCode=@'
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);try{const i=db.prepare('PRAGMA integrity_check').get().integrity_check,fk=db.prepare('PRAGMA foreign_key_check').all(),av=Number(db.prepare('PRAGMA auto_vacuum').get().auto_vacuum);if(i!=='ok'||fk.length||av!==2)throw new Error(JSON.stringify({i,fk:fk.length,av}));console.log(JSON.stringify({integrity:i,foreignKeys:fk.length,autoVacuum:av}));}finally{db.close();}
'@
 $verified=& node -e $verifyCode $live;if($LASTEXITCODE -ne 0){throw 'INSTALLED_DB_SQLITE_VERIFICATION_FAILED'}
 $result=[ordered]@{status='FRESH_TESTNET_DB_INSTALLED';strategy='SCHEMA_ONLY_REBUILD';installedAt=(Get-Date).ToString('o');live=$live;liveHash=(Get-FileHash $live -Algorithm SHA256).Hash.ToLowerInvariant();legacy=$legacy;legacyWal=(Test-Path $legacyWal);legacyShm=(Test-Path $legacyShm);freshVerification=$reportPath;sqliteVerification=($verified|Out-String).Trim();rollbackPreserved=$true}
 $result|ConvertTo-Json -Depth 5|Set-Content (Join-Path $DataDir 'fresh-testnet-install.verification.json') -Encoding utf8
 $result|ConvertTo-Json -Depth 5
}catch{
 if($installed -and (Test-Path $live)){Move-Item -LiteralPath $live -Destination $fresh -Force}
 if(Test-Path $legacy){Move-Item -LiteralPath $legacy -Destination $live -Force}
 if(Test-Path $legacyWal){Move-Item -LiteralPath $legacyWal -Destination "$live-wal" -Force}
 if(Test-Path $legacyShm){Move-Item -LiteralPath $legacyShm -Destination "$live-shm" -Force}
 throw
}
