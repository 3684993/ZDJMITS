[CmdletBinding()]
param([string]$TaskName='ZDJ-MITS Manual Engine')
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodePath=(Get-Command node.exe -ErrorAction Stop).Source
$shellPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if(-not(Test-Path -LiteralPath $shellPath)){throw 'WINDOWS_POWERSHELL_NOT_FOUND'}
$runner=Join-Path $PSScriptRoot 'start-zdj-task-engine.ps1';$dq=[char]34
$arguments="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $dq$runner$dq -ProjectRoot $dq$projectRoot$dq -NodePath $dq$nodePath$dq -StartReason MANUAL_START"
$action=New-ScheduledTaskAction -Execute $shellPath -Argument $arguments -WorkingDirectory $projectRoot
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 0
$task=New-ScheduledTask -Action $action -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force|Out-Null
$registered=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$info=Get-ScheduledTaskInfo -TaskName $TaskName
$triggerCount=@($registered.Triggers|Where-Object {$_}).Count
if($triggerCount-ne 0){throw 'MANUAL_TASK_HAS_TRIGGER'}
if([int]$registered.Settings.RestartCount-ne 0){throw 'MANUAL_TASK_AUTO_RESTART_ENABLED'}
[ordered]@{taskName=$TaskName;taskPath=$registered.TaskPath;triggers=$triggerCount;restartCount=[int]$registered.Settings.RestartCount;state=[string]$registered.State;execute=$registered.Actions[0].Execute;arguments=$registered.Actions[0].Arguments;lastTaskResult=$info.LastTaskResult;launchAuthority='WINDOWS_TASK_SCHEDULER_MANUAL'}|ConvertTo-Json -Depth 5
