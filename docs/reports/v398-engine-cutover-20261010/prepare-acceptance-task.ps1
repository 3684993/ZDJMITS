$ErrorActionPreference='Stop'
$private=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\issue22-acceptance-24h-20261010'
New-Item -ItemType Directory -Path $private -Force | Out-Null
$out=Join-Path $PSScriptRoot 'acceptance';New-Item -ItemType Directory -Path $out -Force | Out-Null
$collector=Join-Path $private 'acceptance-checkpoint.mjs';Copy-Item (Join-Path $PSScriptRoot 'acceptance-checkpoint.mjs') $collector
$taskName='ZDJ-V398-24h-20261010';$taskPath='\ZDJMITS\'
if(Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue){throw 'NEW_ACCEPTANCE_TASK_ALREADY_EXISTS'}
$action=New-ScheduledTaskAction -Execute (Get-Command node.exe).Source -Argument ('"'+$collector+'" --out-dir "'+$out+'"') -WorkingDirectory $private
$trigger=New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(5)) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Hours 25)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read-only new-instance24h acceptance; no lifecycle, Settings or exchange writes; safety failure aborts acceptance only.' | Out-Null
& 'D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd\scripts\set-zdj-scheduled-task-silent.ps1' -TaskName $taskName -TaskPath $taskPath -OutputDirectory (Join-Path $env:LOCALAPPDATA 'ZDJMITS\task-launchers') -Apply | Out-Null
Disable-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Out-Null
[ordered]@{at=[DateTime]::UtcNow.ToString('o');taskName=$taskName;taskPath=$taskPath;collector=$collector;outDir=$out;intervalSeconds=60;hiddenWscript=$true;disabledUntilAllGatesAndT0=$true;noTaskStartYet=$true;noEngineLifecycle=$true;collectorSha256=(Get-FileHash $collector).Hash} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'acceptance-task-prepared.json') -Encoding utf8
