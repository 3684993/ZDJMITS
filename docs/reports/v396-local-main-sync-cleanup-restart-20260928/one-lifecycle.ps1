# User-authorized single-use lifecycle. No retry, recovery, watchdog or autostart.
$ErrorActionPreference='Stop'
$root='D:\MITS';$out=Join-Path $root 'docs\reports\v396-local-main-sync-cleanup-restart-20260928'
$recordPath=Join-Path $out 'lifecycle-receipt.json'
if(Test-Path -LiteralPath $recordPath){throw 'LIFECYCLE_ALREADY_ATTEMPTED_NO_RETRY'}
Set-Location $root
$head=(git rev-parse HEAD).Trim();$remote=(git rev-parse origin/main).Trim()
if($head -ne $remote -or (git branch --show-current).Trim() -ne 'main'){throw 'CANONICAL_MAIN_IDENTITY_NOT_CLOSED'}
if(@(git status --porcelain).Count -ne 0){throw 'PRE_LIFECYCLE_TREE_NOT_CLEAN'}
& (Join-Path $out 'capture-runtime.ps1') -Label before
node (Join-Path $out 'check-persistence-safety.mjs') before
if($LASTEXITCODE -ne 0){throw 'PRESTOP_SAFETY_BLOCKED'}
$before=Get-Content (Join-Path $out 'runtime-before.json') -Raw | ConvertFrom-Json
$build=Get-Content (Join-Path $out 'build-identity.json') -Raw | ConvertFrom-Json
if($before.runtime.pid -ne 18644 -or $before.receipt.artifactHash -ne $build.rollback.artifactHash){throw 'OLD_RUNTIME_CHANGED_REVIEW_REQUIRED'}
$record=[ordered]@{authorized='User pasted 20260928 one stop -> one MANUAL_START';gitSha=$head;oldPid=$before.runtime.pid;oldInstance=$before.runtime.instanceId;stopAttempts=0;startAttempts=0;events=@();status='PRESTOP_SAFE';stopSemantics='Repository guarded Windows stop-zdj-lan.ps1 validates PID/identity then Stop-Process -Force. No graceful shutdown acknowledgement is claimed; pre-stop durable/in-flight checks required.'}
function Save-Receipt {$record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $recordPath -Encoding utf8}
$record.stopAttempts=1;$record.events+=@{action='STOP_REQUESTED';at=[DateTime]::UtcNow.ToString('o')};Save-Receipt
$stopScript=Join-Path $before.process.artifactRoot 'scripts\stop-zdj-lan.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript *> (Join-Path $out 'stop.txt')
if($LASTEXITCODE -ne 0){$record.status='STOP_FAILED_NO_RETRY';Save-Receipt;throw $record.status}
if(Get-Process -Id $before.runtime.pid -ErrorAction SilentlyContinue){throw 'OLD_PID_STILL_ALIVE_NO_START'}
$others=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -match '[\\/]apps[\\/]engine[\\/]dist[\\/]main\.js'})
if($others.Count -ne 0){throw 'OTHER_ENGINE_INSTANCE_NO_START'}
$record.events+=@{action='OLD_PID_EXITED_NO_OTHER_ENGINE';at=[DateTime]::UtcNow.ToString('o')};Save-Receipt
$oldLogs=Join-Path $root 'backups\rollback-fa4fbc8660ef12849644\pre-cutover-logs'
New-Item -ItemType Directory -Path $oldLogs -Force | Out-Null
foreach($name in @('engine.stdout.log','engine.stderr.log','engine-launch-lifecycle.jsonl','engine-process-lifecycle.jsonl')){
 $p=Join-Path $root ('data\runtime-logs\'+$name);if(Test-Path -LiteralPath $p){Copy-Item -LiteralPath $p -Destination (Join-Path $oldLogs $name)}
}
$record.startAttempts=1;$record.events+=@{action='MANUAL_START_REQUESTED';at=[DateTime]::UtcNow.ToString('o')};Save-Receipt
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\start-zdj-lan.ps1') -StartReason MANUAL_START -SkipFirewall *> (Join-Path $out 'start.txt')
if($LASTEXITCODE -ne 0){$record.status='START_FAILED_NO_RETRY';Save-Receipt;throw $record.status}
$receipt=Get-Content (Join-Path $root 'data\runtime\engine-launch-receipt.json') -Raw | ConvertFrom-Json
$record.newPid=$receipt.pid;$record.launchReceipt=$receipt;$record.status='STARTED_WAITING_READ_ONLY_READY';$record.events+=@{action='START_SCRIPT_RETURNED';at=[DateTime]::UtcNow.ToString('o')};Save-Receipt
Write-Output ($record | ConvertTo-Json -Depth 8)
