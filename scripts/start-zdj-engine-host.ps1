[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$EnginePath,
  [Parameter(Mandatory=$true)][string]$WorkingDirectory,
  [Parameter(Mandatory=$true)][string]$StdoutPath,
  [Parameter(Mandatory=$true)][string]$StderrPath,
  [Parameter(Mandatory=$true)][string]$LifecyclePath,
  [Parameter(Mandatory=$true)][string]$ReceiptPath,
  [Parameter(Mandatory=$true)][string]$LaunchId,
  [string]$LaunchAuthority='DIRECT_PROCESS_TREE'
)
$ErrorActionPreference='Stop'
function Write-HostLifecycle([string]$EventName,[hashtable]$Payload){
  try{
    $parent=Split-Path -Parent $LifecyclePath
    if($parent){[IO.Directory]::CreateDirectory($parent)|Out-Null}
    $parentPid=(Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction SilentlyContinue).ParentProcessId
    $row=[ordered]@{ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();event=$EventName;launchId=$LaunchId;launchAuthority=$LaunchAuthority;hostPid=$PID;hostParentPid=$parentPid;payload=$Payload}
    [IO.File]::AppendAllText($LifecyclePath,(($row|ConvertTo-Json -Compress -Depth 8)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  }catch{}
}
function Write-Receipt([int]$ChildPid){
  $parent=Split-Path -Parent $ReceiptPath
  if($parent){[IO.Directory]::CreateDirectory($parent)|Out-Null}
  $tmp=$ReceiptPath+'.'+$LaunchId+'.tmp'
  $parentPid=(Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction SilentlyContinue).ParentProcessId
  $row=[ordered]@{launchId=$LaunchId;pid=$ChildPid;hostPid=$PID;hostParentPid=$parentPid;startedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();enginePath=$EnginePath;launchAuthority=$LaunchAuthority}
  [IO.File]::WriteAllText($tmp,($row|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $ReceiptPath -Force
}
try{
  Write-HostLifecycle 'HOST_STARTED' @{workingDirectory=$WorkingDirectory;enginePath=$EnginePath}
  $dq=[char]34
  $child=Start-Process -FilePath $NodePath -ArgumentList @(($dq+$EnginePath+$dq)) -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -WindowStyle Hidden -PassThru
  # Windows PowerShell can otherwise lose ExitCode for PassThru processes when
  # standard streams are redirected. Materialize the native handle while the
  # process is alive, then wait on this same Process instance.
  $retainedHandle=$child.Handle
  Write-Receipt $child.Id
  Write-HostLifecycle 'CHILD_STARTED' @{pid=$child.Id;handleCaptured=($retainedHandle -ne [IntPtr]::Zero)}
  $child.WaitForExit()
  $exitCode=$child.ExitCode
  Write-HostLifecycle 'CHILD_EXITED' @{pid=$child.Id;exitCode=$exitCode;exitedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
  exit 0
}catch{
  Write-HostLifecycle 'HOST_FAILED' @{message=$_.Exception.Message;type=$_.Exception.GetType().FullName}
  exit 125
}
