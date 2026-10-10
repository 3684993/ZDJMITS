$ErrorActionPreference='Stop'
$stage='D:\MITS-RELEASES\ZDJMITS-v398-trade24h-6533e4d'
$privateRoot='D:/MITS-OPERATIONS/trade24h-private-20261010'
$task=Get-ScheduledTask -TaskName 'ZDJ-MITS-Engine-Crash-Observer'
if($task.State -eq 'Running'){throw 'OLD_OBSERVER_STILL_RUNNING_WAIT_NO_KILL'}
Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Set-Content (Join-Path $privateRoot 'observer-task-before.xml') -Encoding utf8
$observer=Join-Path $env:LOCALAPPDATA 'ZDJMITS\scripts\observe-zdj-engine-readonly.ps1'
$arguments='-NoProfile -File "'+$observer+'" -FollowCurrentReceipt -HostReceiptPath "'+(Join-Path $privateRoot 'new-engine-receipt.json')+'" -HostLifecyclePath "'+(Join-Path $privateRoot 'new-engine-lifecycle.jsonl')+'" -RepositoryRoot "'+$stage+'" -SourceCommit "6533e4d5bbedfe758336f3dd40c188bad37413cd" -IntervalSeconds 45 -MaxBytes 25165824'
$action=New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument $arguments -WorkingDirectory (Split-Path $observer -Parent)
Set-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Action $action | Out-Null
& (Join-Path $stage 'scripts\set-zdj-scheduled-task-silent.ps1') -TaskName $task.TaskName -TaskPath $task.TaskPath -OutputDirectory (Join-Path $env:LOCALAPPDATA 'ZDJMITS\task-launchers') -Apply | Out-Null
$updated=Get-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath
if($updated.Actions.Count -ne 1 -or $updated.Actions[0].Execute -notmatch 'wscript\.exe$' -or $updated.Settings.RestartCount -ne $task.Settings.RestartCount -or $updated.Principal.UserId -ne $task.Principal.UserId){throw 'OBSERVER_TASK_READBACK_FAILED'}
Start-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath
[ordered]@{at=[DateTime]::UtcNow.ToString('o');oldObserverEndedNaturallyWithOldEngine=$true;oldObserverKilledByTask=$false;task=$task.TaskName;hiddenWscript=$true;principalPreserved=$true;restartSettingsPreserved=$true;newReceipt=(Join-Path $privateRoot 'new-engine-receipt.json');newRepositoryRoot=$stage;newSourceCommit='6533e4d5bbedfe758336f3dd40c188bad37413cd';state=[string](Get-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath).State} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'observer-rearmed.json') -Encoding utf8
