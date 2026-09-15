[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$EnginePath,
  [Parameter(Mandatory=$true)][string]$WorkingDirectory,
  [Parameter(Mandatory=$true)][string]$StdoutPath,
  [Parameter(Mandatory=$true)][string]$StderrPath,
  [Parameter(Mandatory=$true)][string]$LifecyclePath,
  [Parameter(Mandatory=$true)][string]$ReceiptPath,
  [Parameter(Mandatory=$true)][string]$LaunchId
)
$ErrorActionPreference='Stop'
function Write-HostLifecycle([string]$EventName,[hashtable]$Payload){
  try{
    $parent=Split-Path -Parent $LifecyclePath
    if($parent){[IO.Directory]::CreateDirectory($parent)|Out-Null}
    $row=[ordered]@{ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();event=$EventName;launchId=$LaunchId;hostPid=$PID;payload=$Payload}
    [IO.File]::AppendAllText($LifecyclePath,(($row|ConvertTo-Json -Compress -Depth 8)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  }catch{}
}
function Write-Receipt([int]$ChildPid){
  $parent=Split-Path -Parent $ReceiptPath
  if($parent){[IO.Directory]::CreateDirectory($parent)|Out-Null}
  $tmp=$ReceiptPath+'.'+$LaunchId+'.tmp'
  $row=[ordered]@{launchId=$LaunchId;pid=$ChildPid;hostPid=$PID;startedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();enginePath=$EnginePath}
  [IO.File]::WriteAllText($tmp,($row|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $ReceiptPath -Force
}
try{
  Write-HostLifecycle 'HOST_STARTED' @{workingDirectory=$WorkingDirectory;enginePath=$EnginePath}
  $dq=[char]34
  $child=Start-Process -FilePath $NodePath -ArgumentList @(($dq+$EnginePath+$dq)) -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -WindowStyle Hidden -PassThru
  Write-Receipt $child.Id
  Write-HostLifecycle 'CHILD_STARTED' @{pid=$child.Id}
  $child.WaitForExit()
  $child.Refresh()
  Write-HostLifecycle 'CHILD_EXITED' @{pid=$child.Id;exitCode=$child.ExitCode;exitedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
  exit 0
}catch{
  Write-HostLifecycle 'HOST_FAILED' @{message=$_.Exception.Message;type=$_.Exception.GetType().FullName}
  exit 125
}
