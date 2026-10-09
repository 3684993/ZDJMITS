[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$TaskName,
  [string]$TaskPath='\ZDJMITS\',
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [switch]$Apply
)
$ErrorActionPreference='Stop'
# Changes presentation only. Never starts/stops a task, Engine, model or proxy.
$task=Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
if ($TaskName -notmatch '^ZDJ[- ]') { throw 'ONLY_ZDJ_TASKS_ALLOWED' }
if (@($task.Actions).Count -ne 1) { throw 'SINGLE_EXEC_ACTION_REQUIRED' }
$original=$task.Actions[0]
if ([IO.Path]::GetFileName($original.Execute) -notmatch '^(node|powershell|pwsh)(\.exe)?$') { throw 'UNSUPPORTED_EXECUTABLE' }
if ([string]$original.Arguments -match '[\r\n]' -or [string]$original.Execute -match '[\r\n]') { throw 'MULTILINE_ACTION_REFUSED' }
$exe=([string]$original.Execute).Trim('"')
if (-not [IO.Path]::IsPathRooted($exe)) { $exe=(Get-Command $exe -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'EXECUTABLE_MISSING' }
$output=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$slug=($TaskPath+$TaskName) -replace '[^a-zA-Z0-9-]','_'
$launcher=Join-Path $output ($slug+'.vbs')
$backup=Join-Path $output ($slug+'.before.xml')
# Preserve complete registration for review/rollback, including triggers/principal/settings.
Export-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath | Set-Content -LiteralPath $backup -Encoding Unicode
$command='"'+$exe+'" '+[string]$original.Arguments
$working=[string]$original.WorkingDirectory
$lines=@('Option Explicit','Dim shell, result','Set shell = CreateObject("WScript.Shell")')
if ($working) { $lines+=('shell.CurrentDirectory = "'+$working.Replace('"','""')+'"') }
$lines+=('result = shell.Run("'+$command.Replace('"','""')+'", 0, True)')
$lines+='WScript.Quit result'
$lines | Set-Content -LiteralPath $launcher -Encoding Unicode
$action=New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\wscript.exe') -Argument ('//B //Nologo "'+$launcher+'"')
if ($working) { $action.WorkingDirectory=$working }
if ($Apply) {
  Set-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $action | Out-Null
  $read=Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
  if ($read.Actions.Execute -ne $action.Execute -or $read.Actions.Arguments -ne $action.Arguments) { throw 'ACTION_READBACK_MISMATCH' }
  # The existing running instance continues unchanged; next scheduled run uses hidden child.
  if ($read.Principal.UserId -ne $task.Principal.UserId -or $read.Principal.LogonType -ne $task.Principal.LogonType) { throw 'PRINCIPAL_CHANGED' }
}
[pscustomobject]@{task=$TaskPath+$TaskName;applied=[bool]$Apply;launcher=$launcher;backup=$backup;originalExecute=$original.Execute;originalArguments=$original.Arguments;workingDirectory=$working;hiddenWindowStyle=0;waitForChild=$true;propagateExitCode=$true;startedTasks=0;stoppedTasks=0}
