[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Plan','Apply','Verify','Undo')][string]$Mode,
  [string]$DumpDirectory=(Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\engine-wer'),
  [string]$BackupDirectory=(Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\engine-wer-config-backups')
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$werRoot='HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps'
$targetKey=Join-Path $werRoot 'node.exe'
$globalKey='HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting'
$debugKey='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AeDebug'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath=Join-Path $BackupDirectory "wer-node-before-$stamp.json"
$manifestPath=Join-Path $BackupDirectory 'active-wer-change.json'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value

function Get-KeyState([string]$Path){
  if(-not(Test-Path -LiteralPath $Path)){return [pscustomobject]@{exists=$false;values=@{}}}
  $key=Get-Item -LiteralPath $Path
  $values=[ordered]@{}
  foreach($name in $key.GetValueNames()){
    $kind=$key.GetValueKind($name).ToString()
    $values[$name]=[ordered]@{kind=$kind;value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
  }
  return [pscustomobject]@{exists=$true;values=$values}
}
function Set-RestrictedAcl([string]$Path){
  $acl=Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true,$false)
  foreach($identity in @($sid,'S-1-5-18','S-1-5-32-544')){
    $sidRef=[Security.Principal.SecurityIdentifier]::new([string]$identity)
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($sidRef,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.SetAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Restore-Key([string]$Path,[object]$State){
  if($State.exists -ne $true){Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue;return}
  if(-not(Test-Path -LiteralPath $Path)){New-Item -Path $Path -Force|Out-Null}
  $key=Get-Item -LiteralPath $Path
  foreach($existing in @($key.GetValueNames())){$key.DeleteValue($existing,$false)}
  foreach($name in $State.values.Keys){
    $entry=$State.values[$name]
    $kind=[Microsoft.Win32.RegistryValueKind][Enum]::Parse([Microsoft.Win32.RegistryValueKind],[string]$entry.kind)
    New-ItemProperty -LiteralPath $Path -Name $name -Value $entry.value -PropertyType $kind -Force|Out-Null
  }
}
function Test-Admin{
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  return [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if($Mode -in @('Apply','Undo') -and -not(Test-Admin)){throw 'ADMINISTRATOR_REQUIRED'}

switch($Mode){
  'Plan' {
    $drive=[IO.Path]::GetPathRoot([IO.Path]::GetFullPath($DumpDirectory))
    $volume=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($drive.TrimEnd('\'))'"
    $nodeProcesses=@(Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {$_.Path -and [IO.Path]::GetFileName($_.Path) -ieq 'node.exe'})
    $maxBytes=if($nodeProcesses.Count){[long](($nodeProcesses|Measure-Object -Property PrivateMemorySize64 -Maximum).Maximum)}else{0L}
    $requiredBytes=2*$maxBytes+10GB
    $existing=Get-KeyState $targetKey
    $globals=Get-KeyState $globalKey
    $debug=Get-KeyState $debugKey
    $safePath=[IO.Path]::GetFullPath($DumpDirectory)
    [pscustomobject]@{
      mode='PLAN_ONLY';administrator=Test-Admin;targetKey=$targetKey;dumpDirectory=$safePath;backupDirectory=[IO.Path]::GetFullPath($BackupDirectory)
      dumpCount=2;dumpType=2;nodeProcessCount=$nodeProcesses.Count;largestObservedNodePrivateBytes=$maxBytes
      freeBytes=[long]$volume.FreeSpace;requiredBytes=$requiredBytes;spaceReady=([long]$volume.FreeSpace -ge $requiredBytes)
      nodeKeyExists=$existing.exists;globalWerExists=$globals.exists;aeDebugExists=$debug.exists;changeScope='node.exe image-name-only; applies to all node.exe faults on this host'
      configuration=[ordered]@{DumpFolder='%LOCALAPPDATA%\ZDJMITS\diagnostics\engine-wer';DumpCount=2;DumpType=2;DumpFolderKind='ExpandString'}
      noRegistryWrite=$true
    }|ConvertTo-Json -Depth 5 -Compress
  }
  'Apply' {
    if(-not(Test-Path -LiteralPath $BackupDirectory)){New-Item -ItemType Directory -Path $BackupDirectory -Force|Out-Null}
    Set-RestrictedAcl $BackupDirectory
    if(Test-Path -LiteralPath $manifestPath){throw 'ACTIVE_CHANGE_EXISTS_REFUSING_OVERWRITE'}
    $dumpRoot=[IO.Path]::GetFullPath($DumpDirectory)
    $dumpDirectoryExisted=Test-Path -LiteralPath $DumpDirectory
    $aclBefore=if($dumpDirectoryExisted){(Get-Acl -LiteralPath $DumpDirectory).Sddl}else{$null}
    if(-not(Test-Path -LiteralPath $dumpRoot)){New-Item -ItemType Directory -Path $dumpRoot -Force|Out-Null}
    Set-RestrictedAcl $dumpRoot
    $backup=[ordered]@{
      capturedAt=(Get-Date).ToString('o');computer=$env:COMPUTERNAME;user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
      paths=[ordered]@{target=$targetKey;global=$globalKey;aeDebug=$debugKey;dumpDirectory=$dumpRoot}
      target=Get-KeyState $targetKey;global=Get-KeyState $globalKey;aeDebug=Get-KeyState $debugKey
      dumpDirectoryExisted=$dumpDirectoryExisted;dumpDirectoryAclBefore=$aclBefore
    }
    [IO.File]::WriteAllText($backupPath,($backup|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
    $backupAcl=Get-Acl -LiteralPath $backupPath;$backupAcl.SetAccessRuleProtection($true,$false)
    foreach($identity in @($sid,'S-1-5-18','S-1-5-32-544')){$sidRef=[Security.Principal.SecurityIdentifier]::new([string]$identity);$rule=[Security.AccessControl.FileSystemAccessRule]::new($sidRef,'FullControl','Allow');$backupAcl.SetAccessRule($rule)}
    Set-Acl -LiteralPath $backupPath -AclObject $backupAcl
    if(-not(Test-Path -LiteralPath $targetKey)){New-Item -Path $targetKey -Force|Out-Null}
    New-ItemProperty -LiteralPath $targetKey -Name DumpFolder -Value '%LOCALAPPDATA%\ZDJMITS\diagnostics\engine-wer' -PropertyType ExpandString -Force|Out-Null
    New-ItemProperty -LiteralPath $targetKey -Name DumpCount -Value 2 -PropertyType DWord -Force|Out-Null
    New-ItemProperty -LiteralPath $targetKey -Name DumpType -Value 2 -PropertyType DWord -Force|Out-Null
    $manifest=[ordered]@{appliedAt=(Get-Date).ToString('o');backupPath=$backupPath;targetKey=$targetKey;dumpDirectory=$dumpRoot;dumpCount=2;dumpType=2;scope='node.exe image-name-only'}
    [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    $manifestAcl=Get-Acl -LiteralPath $manifestPath;$manifestAcl.SetAccessRuleProtection($true,$false)
    foreach($identity in @($sid,'S-1-5-18','S-1-5-32-544')){$sidRef=[Security.Principal.SecurityIdentifier]::new([string]$identity);$rule=[Security.AccessControl.FileSystemAccessRule]::new($sidRef,'FullControl','Allow');$manifestAcl.SetAccessRule($rule)}
    Set-Acl -LiteralPath $manifestPath -AclObject $manifestAcl
    & $PSCommandPath -Mode Verify -DumpDirectory $DumpDirectory -BackupDirectory $BackupDirectory
  }
  'Verify' {
    $key=Get-Item -LiteralPath $targetKey -ErrorAction Stop
    $rawFolder=[string]$key.GetValue('DumpFolder',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $dumpCount=[int]$key.GetValue('DumpCount');$dumpType=[int]$key.GetValue('DumpType')
    $folder=[Environment]::ExpandEnvironmentVariables($rawFolder)
    $acl=Get-Acl -LiteralPath $folder
    $allowed=@($acl.Access|Where-Object{$_.AccessControlType -eq 'Allow' -and $_.FileSystemRights.ToString() -match 'FullControl'}|ForEach-Object{$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value}|Sort-Object -Unique)
    $expected=@($sid,'S-1-5-18','S-1-5-32-544'|Sort-Object -Unique)
    $unapproved=@($allowed|Where-Object{$_ -notin $expected})
    $ok=$rawFolder -eq '%LOCALAPPDATA%\ZDJMITS\diagnostics\engine-wer' -and $dumpCount -eq 2 -and $dumpType -eq 2 -and (Test-Path -LiteralPath $folder) -and $acl.AreAccessRulesProtected -and $unapproved.Count -eq 0
    [pscustomobject]@{status=if($ok){'WER_READY'}else{'WER_NOT_READY'};targetKey=$targetKey;dumpFolder=$folder;rawDumpFolder=$rawFolder;dumpFolderKind=$key.GetValueKind('DumpFolder').ToString();dumpCount=$dumpCount;dumpType=$dumpType;aclProtected=$acl.AreAccessRulesProtected;allowedSids=$allowed;unexpectedFullControlSids=$unapproved;backupManifestPresent=(Test-Path -LiteralPath $manifestPath);verifiedAt=(Get-Date).ToString('o')}|ConvertTo-Json -Depth 5 -Compress
    if(-not $ok){throw 'WER_VERIFY_FAILED'}
  }
  'Undo' {
    if(-not(Test-Path -LiteralPath $manifestPath)){throw 'ACTIVE_CHANGE_MANIFEST_NOT_FOUND'}
    $manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
    $backup=Get-Content -LiteralPath $manifest.backupPath -Raw|ConvertFrom-Json
    Restore-Key $targetKey $backup.target
    # Keep the restricted dump directory and any WER artifacts for evidence retention. Undo restores
    # the pre-existing node.exe registry state; global WER/AeDebug were snapshotted and never changed.
    Remove-Item -LiteralPath $manifestPath -Force
    [pscustomobject]@{status='WER_UNDONE';restoredNodeKey=$backup.target.exists;dumpDirectoryPreserved=$true;backupPath=$manifest.backupPath;undoneAt=(Get-Date).ToString('o')}|ConvertTo-Json -Compress
  }
}
