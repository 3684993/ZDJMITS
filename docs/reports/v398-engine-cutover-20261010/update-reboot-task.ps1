$ErrorActionPreference='Stop'
$task=Get-ScheduledTask -TaskName 'ZDJ-MITS-AfterReboot-TESTNET'
$stage='D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd'
$private=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\issue22-cutover-20261010'
Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Set-Content (Join-Path $private 'reboot-task-before.xml') -Encoding utf8
$approval=Join-Path $env:LOCALAPPDATA 'ZDJMITS\entry-authorization\v398-testnet-entry-bb45c11-20261010.json'
$arguments='-NoProfile -File "'+(Join-Path $stage 'scripts\start-zdj-stack-after-reboot.ps1')+'" -ProjectRoot "'+$stage+'" -ModelScriptsRoot "D:\MITS-WORKTREES\llama-memory-20261009\scripts\llama-vulkan" -DataRoot "D:\MITS\data" -ProxyPort 20091 -EntryMode TESTNET_ENTRY_ENABLED -EntryApprovalFile "'+$approval+'"'
$action=New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument $arguments -WorkingDirectory $stage
Set-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Action $action | Out-Null
& (Join-Path $stage 'scripts\set-zdj-scheduled-task-silent.ps1') -TaskName $task.TaskName -TaskPath $task.TaskPath -OutputDirectory (Join-Path $env:LOCALAPPDATA 'ZDJMITS\task-launchers') -Apply | Out-Null
$updated=Get-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath
if($updated.Actions.Count -ne 1 -or $updated.Actions[0].Execute -notmatch 'wscript\.exe$' -or $updated.Principal.UserId -ne $task.Principal.UserId -or $updated.Settings.RestartCount -ne $task.Settings.RestartCount -or $updated.Triggers.Count -ne $task.Triggers.Count){throw 'REBOOT_TASK_PRESERVATION_FAILED'}
Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Set-Content (Join-Path $private 'reboot-task-after.xml') -Encoding utf8
[ordered]@{at=[DateTime]::UtcNow.ToString('o');taskName=$task.TaskName;taskPath=$task.TaskPath;newStableRoot=$stage;approvalFile=$approval;hiddenWscript=$true;restartSettingsPreserved=$true;principalPreserved=$true;triggerCountPreserved=$true;taskStarted=$false;liveEngineStarts=0;action=$updated.Actions[0] | Select-Object Execute,Arguments,WorkingDirectory} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $PSScriptRoot 'reboot-task-readback.json') -Encoding utf8
