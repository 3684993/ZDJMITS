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
function Invoke-NativeProbe([string]$Executable,[string]$Arguments){
  $start=[Diagnostics.ProcessStartInfo]::new()
  $start.FileName=$Executable
  $start.Arguments=$Arguments
  $start.UseShellExecute=$false
  $start.CreateNoWindow=$true
  $start.RedirectStandardOutput=$true
  $start.RedirectStandardError=$true
  $process=[Diagnostics.Process]::new()
  $process.StartInfo=$start
  if(-not $process.Start()){throw "NODE_PROBE_START_FAILED:$Arguments"}
  $stdout=$process.StandardOutput.ReadToEnd()
  $stderr=$process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if($process.ExitCode -ne 0){throw "NODE_PROBE_FAILED:$Arguments exit=$($process.ExitCode) stderr=$($stderr.Trim())"}
  return $stdout
}
function Get-NodeRuntimeGuard([string]$Executable){
  # Probe through Process rather than PowerShell's native pipeline. Some managed Node installations
  # emit a harmless preload warning on stderr; with ErrorActionPreference=Stop PowerShell promotes
  # that warning to NativeCommandError and prevents the Engine child from starting.
  $nodeVersion=(Invoke-NativeProbe $Executable '--version').Trim()
  $v8Version=(Invoke-NativeProbe $Executable '-p "process.versions.v8"').Trim()
  $v8Options=Invoke-NativeProbe $Executable '--v8-options'
  $flags=@()
  # Windows has had native fail-fast crashes in V8's Maglev tier. Disable it only when this
  # installed Node actually exposes the flag; no Node version upgrade/downgrade is implied.
  if($v8Options -match '(?m)(^|\s)--maglev(?:\s|$)'){$flags+='--no-maglev'}
  return [ordered]@{nodeVersion=$nodeVersion;v8Version=$v8Version;flags=@($flags)}
}
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
  $nodeRuntime=Get-NodeRuntimeGuard $NodePath
  Write-HostLifecycle 'HOST_STARTED' @{workingDirectory=$WorkingDirectory;enginePath=$EnginePath;nodeVersion=$nodeRuntime.nodeVersion;v8Version=$nodeRuntime.v8Version;nodeFlags=@($nodeRuntime.flags)}
  $dq=[char]34
  $nodeArguments=@($nodeRuntime.flags)
  $nodeArguments+=($dq+$EnginePath+$dq)
  $child=Start-Process -FilePath $NodePath -ArgumentList $nodeArguments -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -WindowStyle Hidden -PassThru
  # Windows PowerShell can otherwise lose ExitCode for PassThru processes when
  # standard streams are redirected. Materialize the native handle while the
  # process is alive, then wait on this same Process instance.
  $retainedHandle=$child.Handle
  Write-Receipt $child.Id
  Write-HostLifecycle 'CHILD_STARTED' @{pid=$child.Id;handleCaptured=($retainedHandle -ne [IntPtr]::Zero);nodeFlags=@($nodeRuntime.flags)}
  $child.WaitForExit()
  $exitCode=$child.ExitCode
  Write-HostLifecycle 'CHILD_EXITED' @{pid=$child.Id;exitCode=$exitCode;exitedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
  exit 0
}catch{
  Write-HostLifecycle 'HOST_FAILED' @{message=$_.Exception.Message;type=$_.Exception.GetType().FullName}
  exit 125
}
