[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Plan','Apply','Verify','Undo')][string]$Mode,
  [string]$ObserverSource=(Join-Path $PSScriptRoot 'observe-zdj-engine-readonly.ps1'),
  [string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'ZDJMITS\scripts'),
  [string]$TaskName='ZDJ-MITS-Engine-Crash-Observer',
  [string]$TaskPath='\ZDJMITS\'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$installed=Join-Path $InstallRoot 'observe-zdj-engine-readonly.ps1'
$manifestPath=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\engine-observer\task-manifest.json'
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Set-PrivateDirectory([string]$Path){
  if(-not(Test-Path -LiteralPath $Path)){New-Item -ItemType Directory -Path $Path -Force|Out-Null}
  $acl=Get-Acl -LiteralPath $Path;$acl.SetAccessRuleProtection($true,$false)
  foreach($sidText in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')){$sid=[Security.Principal.SecurityIdentifier]::new($sidText);$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.SetAccessRule($rule)}
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Get-ExistingTask{
  try{return Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop}catch{return $null}
}
function Get-FileSha([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()}

switch($Mode){
  'Plan' {
    $existing=Get-ExistingTask
    [pscustomobject]@{mode='PLAN_ONLY';observerSource=$ObserverSource;observerSourceExists=(Test-Path -LiteralPath $ObserverSource);installedPath=$installed;taskName=$TaskName;taskPath=$TaskPath;existingTask=$null-ne$existing;existingTaskState=if($existing){[string]$existing.State}else{$null};willStartAtLogon=$true;delaySeconds=60;intervalSeconds=45;autoRestart=$false;engineLifecycleAction='NONE';noTaskWrite=$true}|ConvertTo-Json -Compress
  }
  'Apply' {
    if(-not(Test-Path -LiteralPath $ObserverSource -PathType Leaf)){throw 'OBSERVER_SOURCE_MISSING'}
    if(-not(Test-Path -LiteralPath $manifestPath)){Set-PrivateDirectory (Split-Path -Path $manifestPath -Parent)}
    $existing=Get-ExistingTask
    if($existing){
      $action=$existing.Actions|Select-Object -First 1
      if($action.Arguments -notlike "*`"$installed`"*" -or $action.Arguments -notlike '*-FollowCurrentReceipt*'){throw 'EXISTING_TASK_CONFLICT_REFUSING_OVERWRITE'}
    }
    Set-PrivateDirectory $InstallRoot
    Copy-Item -LiteralPath $ObserverSource -Destination $installed -Force
    $scriptHash=Get-FileSha $installed
    $tokens=$null;$parseErrors=$null;[System.Management.Automation.Language.Parser]::ParseFile($installed,[ref]$tokens,[ref]$parseErrors)|Out-Null
    if(@($parseErrors).Count){throw 'INSTALLED_OBSERVER_PARSE_FAILED'}
    if(-not $existing -or $existing.Actions[0].Execute -ne $powershell){
      $trigger=New-ScheduledTaskTrigger -AtLogOn -User $user;$trigger.Delay='PT60S'
      $arguments="-NoProfile -ExecutionPolicy Bypass -File `"$installed`" -FollowCurrentReceipt -WaitForLaunchMinutes 30 -IntervalSeconds 45 -MaxBytes 25165824"
      $action=New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $InstallRoot
      $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
      $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
      Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read-only ZDJMITS Engine PID/build/health/resource/crash evidence observer. Never starts, stops or restarts Engine.' -Force|Out-Null
    }
    $task=Get-ExistingTask;$xml=Export-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
    $manifest=[ordered]@{registeredAt=(Get-Date).ToString('o');computer=$env:COMPUTERNAME;user=$user;taskName=$TaskName;taskPath=$TaskPath;installedScript=$installed;scriptSha256=$scriptHash;scheduledTaskXml=$xml;mode='READ_ONLY_NO_ENGINE_LIFECYCLE'}
    [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    $manifestAcl=Get-Acl $manifestPath;$manifestAcl.SetAccessRuleProtection($true,$false);foreach($sidText in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')){$sid=[Security.Principal.SecurityIdentifier]::new($sidText);$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow');$manifestAcl.SetAccessRule($rule)};Set-Acl $manifestPath $manifestAcl
    Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
    Start-Sleep -Seconds 2
    & $PSCommandPath -Mode Verify -ObserverSource $ObserverSource -InstallRoot $InstallRoot -TaskName $TaskName -TaskPath $TaskPath
  }
  'Verify' {
    $task=Get-ExistingTask
    if(-not $task){throw 'OBSERVER_TASK_NOT_REGISTERED'}
    $action=$task.Actions|Select-Object -First 1
    $hash=Get-FileSha $installed
    $info=Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath $TaskPath
    $ok=$task.State -eq 'Running' -and $action.Execute -eq $powershell -and $action.Arguments -like "*`"$installed`"*" -and $action.Arguments -like '*-FollowCurrentReceipt*' -and (Test-Path -LiteralPath $installed) -and (Test-Path -LiteralPath $manifestPath)
    [pscustomobject]@{status=if($ok){'OBSERVER_TASK_RUNNING'}else{'OBSERVER_TASK_NOT_RUNNING'};taskName=$TaskName;taskPath=$TaskPath;state=[string]$task.State;installedPath=$installed;scriptSha256=$hash;lastRunTime=$info.LastRunTime;lastTaskResult=$info.LastTaskResult;taskAction=$action.Arguments;noEngineLifecycleAction=($action.Arguments -notmatch '(?i)start-zdj-engine-host|Stop-Process|Restart-Computer|Stop-Computer');verifiedAt=(Get-Date).ToString('o')}|ConvertTo-Json -Depth 4 -Compress
    if(-not $ok){throw 'OBSERVER_TASK_VERIFY_FAILED'}
  }
  'Undo' {
    $task=Get-ExistingTask
    if($task){Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false}
    if(Test-Path -LiteralPath $manifestPath){Remove-Item -LiteralPath $manifestPath -Force}
    [pscustomobject]@{status='OBSERVER_TASK_REMOVED_LOGS_PRESERVED';taskName=$TaskName;installedScriptPreserved=(Test-Path -LiteralPath $installed);logDirectoryPreserved=$true;undoneAt=(Get-Date).ToString('o')}|ConvertTo-Json -Compress
  }
}
