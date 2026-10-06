[CmdletBinding()]
param(
  [string]$StartReason = 'MANUAL_START',
  [switch]$SkipFirewall,
  [switch]$Foreground
)
$ErrorActionPreference = 'Stop'
if ($StartReason -ne 'MANUAL_START') { throw 'MANUAL_START_ONLY: automatic start/restart is disabled.' }
$launchMutex = [Threading.Mutex]::new($false, 'Local\ZDJ_MITS_MANUAL_LAUNCH_8080')
if (-not $launchMutex.WaitOne(0)) { $launchMutex.Dispose(); throw 'MANUAL_START_ALREADY_IN_PROGRESS' }
try {
Set-Location (Split-Path -Parent $PSScriptRoot)

# Ensure LAN access is configured even when an existing Engine is reused. The
# caller may explicitly suppress this optional host-security operation without
# changing any engine launch or identity behaviour.
if (-not $SkipFirewall) {
  $ruleName = 'ZDJ-MITS Engine 8080'
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 8080 -RemoteAddress Any -Action Allow -Profile Domain,Private,Public | Out-Null
  } else {
    Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Domain,Private,Public -RemoteAddress Any
  }
} else {
  Write-Output 'Firewall configuration skipped by explicit manual launch request.'
}

# Keep the LAN bind explicit even if a parent process inherited ZDJ_HOST=127.0.0.1.
$env:ZDJ_HOST = '0.0.0.0'
$env:ZDJ_PORT = '8080'
$env:ZDJ_DATA_DIR = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data')
$env:ZDJ_CONFIG_DIR = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config')

# Reuse an existing engine. Never kill or restart it on a failed health probe.
$listeners = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  $identityPath=Join-Path $env:ZDJ_DATA_DIR 'runtime\engine-instance.json'
  $identity=if(Test-Path -LiteralPath $identityPath){Get-Content -LiteralPath $identityPath -Raw|ConvertFrom-Json}else{$null}
  if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'dist[\/]main\.js(?:[\s"]|$)' -or -not $identity -or [int]$identity.pid -ne [int]$listener.OwningProcess) {
    throw "PORT_8080_OCCUPIED_BY_OTHER_PROCESS PID=$($listener.OwningProcess)"
  }
  $code = (curl.exe --connect-timeout 2 --max-time 5 -s -o NUL -w '%{http_code}' 'http://127.0.0.1:8080/health' 2>$null)
  if ($code -in @('200','202','204','503')) {
    Write-Output "ZDJ-MITS already running. PID=$($listener.OwningProcess) HTTP=$code"
    $currentIps=(Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue|Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred'}|ForEach-Object {'http://'+$_.IPAddress+':8080'}) -join ', '
    Write-Output ('LAN URL(s): ' + $currentIps)
    exit 0
  }
  throw "ENGINE_UNRESPONSIVE_MANUAL_REVIEW_REQUIRED PID=$($listener.OwningProcess): no automatic stop or restart performed."
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  if (-not (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}

# Run Node below a detached, non-restarting host. The host exists only to retain
# the Process object long enough to record the real child exit code/time. It is
# deliberately not a supervisor and never starts a replacement child.
$logDir = Join-Path (Get-Location) 'data\runtime-logs'
$runtimeDir = Join-Path (Get-Location) 'data\runtime'
New-Item -ItemType Directory -Path $logDir,$runtimeDir -Force | Out-Null
$stdout = Join-Path $logDir 'engine.stdout.log'
$stderr = Join-Path $logDir 'engine.stderr.log'
$launcherLifecycle = Join-Path $logDir 'engine-launch-lifecycle.jsonl'
$receiptPath = Join-Path $runtimeDir 'engine-launch-receipt.json'

# Disk exhaustion is an execution-safety fault: SQLite and durable runtime evidence both live under
# ZDJ_DATA_DIR. Refuse a new Engine launch while the volume is critically low instead of starting a
# process that cannot preserve state. The threshold is configurable but defaults to 2 GiB.
$volumeRoot = [IO.Path]::GetPathRoot((Get-Location).Path)
$driveInfo = New-Object System.IO.DriveInfo($volumeRoot)
$minFreeBytes = [int64](2 * 1024 * 1024 * 1024)
if (-not [string]::IsNullOrWhiteSpace([string]$env:ZDJ_MIN_FREE_DISK_BYTES)) {
  $candidateMinFreeBytes = [int64]0
  if ([int64]::TryParse([string]$env:ZDJ_MIN_FREE_DISK_BYTES, [ref]$candidateMinFreeBytes) -and $candidateMinFreeBytes -gt 0) {
    $minFreeBytes = $candidateMinFreeBytes
  }
}
$freeBytes = [int64]$driveInfo.AvailableFreeSpace
$freeGiB = [math]::Round($freeBytes / 1GB, 2)
$requiredGiB = [math]::Round($minFreeBytes / 1GB, 2)
if ($freeBytes -lt $minFreeBytes) {
  throw ("ENGINE_START_REFUSED_LOW_DISK_SPACE volume={0} freeGiB={1} requiredGiB={2}" -f $volumeRoot,$freeGiB,$requiredGiB)
}

$env:ZDJ_START_REASON = $StartReason
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$enginePath = Join-Path (Get-Location) 'apps\engine\dist\main.js'
$hostScript = Join-Path $PSScriptRoot 'start-zdj-engine-host.ps1'
if (-not (Test-Path -LiteralPath $enginePath)) { throw 'ENGINE_BUILD_MISSING: build explicitly before starting.' }

if($Foreground){
  # Decode native Node stdout/stderr as UTF-8 before the foreground tee sees it.
  $utf8=[Text.UTF8Encoding]::new($false)
  [Console]::InputEncoding=$utf8
  [Console]::OutputEncoding=$utf8
  $OutputEncoding=$utf8
  # Foreground observe mode uses the same runtime environment and the same conservative V8 guard as
  # the detached launcher, but keeps node.exe attached to this console so the last live output before
  # a native exit is visible immediately. It never starts or stops any AI service.
  if($env:NODE_OPTIONS -match '(^|\s)--jitless(?:\s|$)'){
    Write-Warning 'Removing inherited NODE_OPTIONS=--jitless because Node fetch/undici requires WebAssembly.'
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  }
  $nodeVersion=(& $nodePath --version 2>$null | Out-String).Trim()
  $v8Version=(& $nodePath -p "process.versions.v8" 2>$null | Out-String).Trim()
  $v8Options=(& $nodePath --v8-options 2>$null | Out-String)
  $nodeFlags=@()
  if($v8Options -match '(?m)(^|\s)--maglev(?:\s|$)'){$nodeFlags+='--no-maglev'}
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  $foregroundLog=Join-Path $logDir ("engine.foreground.$stamp.log")
  $reportDir=Join-Path (Get-Location) ("docs\reports\crash\foreground-$stamp")
  New-Item -ItemType Directory -Path $reportDir -Force|Out-Null
  $nodeArgs=@($nodeFlags)+@('--report-on-fatalerror','--report-uncaught-exception',("--report-directory=$reportDir"),'--trace-exit',$enginePath)
  $env:ZDJ_FOREGROUND_OBSERVE='1'
  Write-Host ''
  Write-Host '============================================================'
  Write-Host ' ZDJ-MITS ENGINE / FOREGROUND OBSERVE MODE'
  Write-Host '============================================================'
  Write-Host ('Node            : '+$nodeVersion)
  Write-Host ('V8              : '+$v8Version)
  Write-Host ('PID             : current console will own node.exe directly')
  Write-Host ('Engine          : '+$enginePath)
  $flagText=if($nodeFlags.Count){$nodeFlags -join ' '}else{'(none)'}
  Write-Host ('Node flags      : '+$flagText)
  Write-Host ('Console log     : '+$foregroundLog)
  Write-Host ('Crash reports   : '+$reportDir)
  Write-Host 'AI services     : untouched (8081/8083/8084 are not stopped or restarted)'
  Write-Host 'Press Ctrl+C only if you intentionally want to stop the Engine.'
  Write-Host '------------------------------------------------------------'
  $startedAt=Get-Date
  $header="[$($startedAt.ToString('yyyy-MM-dd HH:mm:ss.fff'))] FOREGROUND_START node=$nodeVersion v8=$v8Version flags=$($nodeFlags -join ' ') engine=$enginePath"
  $foregroundFileLogging=$true
  $foregroundLogMaxBytes=[int64](256 * 1024 * 1024)
  if (-not [string]::IsNullOrWhiteSpace([string]$env:ZDJ_FOREGROUND_LOG_MAX_BYTES)) {
    $candidateLogMaxBytes=[int64]0
    if ([int64]::TryParse([string]$env:ZDJ_FOREGROUND_LOG_MAX_BYTES,[ref]$candidateLogMaxBytes) -and $candidateLogMaxBytes -gt 0) {
      $foregroundLogMaxBytes=$candidateLogMaxBytes
    }
  }
  $foregroundPreviousLog=$foregroundLog + '.previous'
  try {
    [IO.File]::WriteAllText($foregroundLog,$header+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  } catch {
    $foregroundFileLogging=$false
    Write-Warning ("FOREGROUND_LOG_DISABLED_AT_START: " + $_.Exception.Message)
  }
  $previousErrorAction=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try {
    & $nodePath @nodeArgs 2>&1 | ForEach-Object {
      $line="[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff'))] $($_.ToString())"
      Write-Host $line
      if ($foregroundFileLogging) {
        try {
          if ((Test-Path -LiteralPath $foregroundLog) -and ((Get-Item -LiteralPath $foregroundLog).Length -ge $foregroundLogMaxBytes)) {
            if (Test-Path -LiteralPath $foregroundPreviousLog) { Remove-Item -LiteralPath $foregroundPreviousLog -Force -ErrorAction SilentlyContinue }
            Move-Item -LiteralPath $foregroundLog -Destination $foregroundPreviousLog -Force
            $rotation="[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff'))] FOREGROUND_LOG_ROTATED previous=$foregroundPreviousLog"
            [IO.File]::WriteAllText($foregroundLog,$rotation+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
          }
          [IO.File]::AppendAllText($foregroundLog,$line+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
        } catch {
          $foregroundFileLogging=$false
          Write-Warning ("FOREGROUND_LOG_DISABLED_DURING_RUN: " + $_.Exception.Message)
        }
      }
    }
    $exitCode=if($null -eq $LASTEXITCODE){0}else{[int]$LASTEXITCODE}
  } finally {
    $ErrorActionPreference=$previousErrorAction
  }
  $endedAt=Get-Date
  $duration=[math]::Round(($endedAt-$startedAt).TotalSeconds,3)
  $exitUnsigned=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$exitCode),0)
  $exitHex=('0x{0:X8}' -f $exitUnsigned)
  $footer="[$($endedAt.ToString('yyyy-MM-dd HH:mm:ss.fff'))] FOREGROUND_EXIT exitCode=$exitCode exitHex=$exitHex durationSeconds=$duration"
  if ($foregroundFileLogging) {
    try { [IO.File]::AppendAllText($foregroundLog,$footer+[Environment]::NewLine,[Text.UTF8Encoding]::new($false)) }
    catch { Write-Warning ("FOREGROUND_EXIT_LOG_WRITE_FAILED: " + $_.Exception.Message) }
  }
  Write-Host '------------------------------------------------------------'
  Write-Host ('ENGINE EXITED    : '+$endedAt.ToString('yyyy-MM-dd HH:mm:ss.fff'))
  Write-Host ('Duration seconds : '+$duration)
  Write-Host ('Exit code        : '+$exitCode)
  Write-Host ('Exit hex         : '+$exitHex)
  Write-Host ('Console log      : '+$foregroundLog)
  Write-Host ('Crash reports    : '+$reportDir)
  if($exitCode -eq -1073740791){Write-Host 'Detected Windows native fail-fast: 0xC0000409' -ForegroundColor Red}
  Write-Host 'Last 40 log lines:'
  if (Test-Path -LiteralPath $foregroundLog) {
    Get-Content -LiteralPath $foregroundLog -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
  }
  exit $exitCode
}

if (-not (Test-Path -LiteralPath $hostScript)) { throw 'ENGINE_HOST_SCRIPT_MISSING' }
$launchId=[guid]::NewGuid().ToString('N')
$hostExe=(Get-Process -Id $PID -ErrorAction Stop).Path
$dq=[char]34
$hostArgs=@('-NoProfile','-ExecutionPolicy','Bypass','-File',($dq+$hostScript+$dq),'-NodePath',($dq+$nodePath+$dq),'-EnginePath',($dq+$enginePath+$dq),'-WorkingDirectory',($dq+(Get-Location).Path+$dq),'-StdoutPath',($dq+$stdout+$dq),'-StderrPath',($dq+$stderr+$dq),'-LifecyclePath',($dq+$launcherLifecycle+$dq),'-ReceiptPath',($dq+$receiptPath+$dq),'-LaunchId',$launchId)
$hostProcess=Start-Process -FilePath $hostExe -ArgumentList $hostArgs -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
$receipt=$null
for($attempt=0;$attempt -lt 50;$attempt++){
  if(Test-Path -LiteralPath $receiptPath){
    try{$candidate=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json;if($candidate.launchId -eq $launchId){$receipt=$candidate;break}}catch{}
  }
  $hostProcess.Refresh();if($hostProcess.HasExited){break};Start-Sleep -Milliseconds 100
}
if(-not $receipt){$hostProcess.Refresh();if($hostProcess.HasExited){throw "ENGINE_HOST_FAILED exit=$($hostProcess.ExitCode). See $launcherLifecycle"};throw "ENGINE_HOST_RECEIPT_TIMEOUT hostPid=$($hostProcess.Id). Manual review required; no automatic retry."}
Write-Output ('ZDJ-MITS started in background. PID=' + $receipt.pid + ' HOST_PID=' + $hostProcess.Id + ' LAUNCH_ID=' + $launchId)
Write-Output ('LAN URL(s): ' + ((Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred'} | ForEach-Object { 'http://' + $_.IPAddress + ':8080' }) -join ', '))
Write-Output ('Logs: ' + $stdout + ' / ' + $stderr)
Write-Output ('Process lifecycle: ' + (Join-Path $logDir 'engine-process-lifecycle.jsonl') + ' / ' + $launcherLifecycle)
} finally {
  $launchMutex.ReleaseMutex()
  $launchMutex.Dispose()
}
){[int64]$env:ZDJ_FOREGROUND_LOG_MAX_BYTES}else{[int64](256MB)}
  $foregroundLogPart=0
  try{
    [IO.File]::WriteAllText($foregroundLog,$header+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  }catch{
    $foregroundFileLogging=$false
    Write-Warning ("FOREGROUND_LOG_DISABLED_AT_START: " + $_.Exception.Message)
  }
  $previousErrorAction=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try{
    & $nodePath @nodeArgs 2>&1 | ForEach-Object {
      $line="[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff'))] $($_.ToString())"
      Write-Host $line
      if($foregroundFileLogging){
        try{
          [IO.File]::AppendAllText($foregroundLog,$line+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
        }catch{
          # Losing the diagnostic mirror must never terminate node.exe. Continue draining stdout so the
          # foreground Engine remains attached and observable in the console.
          $foregroundFileLogging=$false
          Write-Warning ("FOREGROUND_LOG_DISABLED_DURING_RUN: " + $_.Exception.Message)
        }
      }
    }
    $exitCode=if($null -eq $LASTEXITCODE){0}else{[int]$LASTEXITCODE}
  }finally{
    $ErrorActionPreference=$previousErrorAction
  }
  $endedAt=Get-Date
  $duration=[math]::Round(($endedAt-$startedAt).TotalSeconds,3)
  $exitUnsigned=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$exitCode),0)
  $exitHex=('0x{0:X8}' -f $exitUnsigned)
  $footer="[$($endedAt.ToString('yyyy-MM-dd HH:mm:ss.fff'))] FOREGROUND_EXIT exitCode=$exitCode exitHex=$exitHex durationSeconds=$duration"
  if($foregroundFileLogging){
    try{[IO.File]::AppendAllText($foregroundLog,$footer+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))}
    catch{Write-Warning ("FOREGROUND_EXIT_LOG_WRITE_FAILED: " + $_.Exception.Message)}
  }
  Write-Host '------------------------------------------------------------'
  Write-Host ('ENGINE EXITED    : '+$endedAt.ToString('yyyy-MM-dd HH:mm:ss.fff'))
  Write-Host ('Duration seconds : '+$duration)
  Write-Host ('Exit code        : '+$exitCode)
  Write-Host ('Exit hex         : '+$exitHex)
  Write-Host ('Console log      : '+$foregroundLog)
  Write-Host ('Crash reports    : '+$reportDir)
  if($exitCode -eq -1073740791){Write-Host 'Detected Windows native fail-fast: 0xC0000409' -ForegroundColor Red}
  Write-Host 'Last 40 log lines:'
  if(Test-Path -LiteralPath $foregroundLog){Get-Content -LiteralPath $foregroundLog -Tail 40 -ErrorAction SilentlyContinue|ForEach-Object {Write-Host $_}}
  exit $exitCode
}

if (-not (Test-Path -LiteralPath $hostScript)) { throw 'ENGINE_HOST_SCRIPT_MISSING' }
$launchId=[guid]::NewGuid().ToString('N')
$hostExe=(Get-Process -Id $PID -ErrorAction Stop).Path
$dq=[char]34
$hostArgs=@('-NoProfile','-ExecutionPolicy','Bypass','-File',($dq+$hostScript+$dq),'-NodePath',($dq+$nodePath+$dq),'-EnginePath',($dq+$enginePath+$dq),'-WorkingDirectory',($dq+(Get-Location).Path+$dq),'-StdoutPath',($dq+$stdout+$dq),'-StderrPath',($dq+$stderr+$dq),'-LifecyclePath',($dq+$launcherLifecycle+$dq),'-ReceiptPath',($dq+$receiptPath+$dq),'-LaunchId',$launchId)
$hostProcess=Start-Process -FilePath $hostExe -ArgumentList $hostArgs -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
$receipt=$null
for($attempt=0;$attempt -lt 50;$attempt++){
  if(Test-Path -LiteralPath $receiptPath){
    try{$candidate=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json;if($candidate.launchId -eq $launchId){$receipt=$candidate;break}}catch{}
  }
  $hostProcess.Refresh();if($hostProcess.HasExited){break};Start-Sleep -Milliseconds 100
}
if(-not $receipt){$hostProcess.Refresh();if($hostProcess.HasExited){throw "ENGINE_HOST_FAILED exit=$($hostProcess.ExitCode). See $launcherLifecycle"};throw "ENGINE_HOST_RECEIPT_TIMEOUT hostPid=$($hostProcess.Id). Manual review required; no automatic retry."}
Write-Output ('ZDJ-MITS started in background. PID=' + $receipt.pid + ' HOST_PID=' + $hostProcess.Id + ' LAUNCH_ID=' + $launchId)
Write-Output ('LAN URL(s): ' + ((Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred'} | ForEach-Object { 'http://' + $_.IPAddress + ':8080' }) -join ', '))
Write-Output ('Logs: ' + $stdout + ' / ' + $stderr)
Write-Output ('Process lifecycle: ' + (Join-Path $logDir 'engine-process-lifecycle.jsonl') + ' / ' + $launcherLifecycle)
} finally {
  $launchMutex.ReleaseMutex()
  $launchMutex.Dispose()
}
){[int64]$env:ZDJ_MIN_FREE_DISK_BYTES}else{[int64](2GB)}
$freeBytes = [int64]$driveInfo.AvailableFreeSpace
$freeGiB = [math]::Round($freeBytes / 1GB, 2)
if($freeBytes -lt $minFreeBytes){
  throw ("ENGINE_START_REFUSED_LOW_DISK_SPACE volume={0} freeGiB={1} requiredGiB={2}" -f $volumeRoot,$freeGiB,[math]::Round($minFreeBytes/1GB,2))
}

$env:ZDJ_START_REASON = $StartReason
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$enginePath = Join-Path (Get-Location) 'apps\engine\dist\main.js'
$hostScript = Join-Path $PSScriptRoot 'start-zdj-engine-host.ps1'
if (-not (Test-Path -LiteralPath $enginePath)) { throw 'ENGINE_BUILD_MISSING: build explicitly before starting.' }

if($Foreground){
  # Decode native Node stdout/stderr as UTF-8 before the foreground tee sees it.
  $utf8=[Text.UTF8Encoding]::new($false)
  [Console]::InputEncoding=$utf8
  [Console]::OutputEncoding=$utf8
  $OutputEncoding=$utf8
  # Foreground observe mode uses the same runtime environment and the same conservative V8 guard as
  # the detached launcher, but keeps node.exe attached to this console so the last live output before
  # a native exit is visible immediately. It never starts or stops any AI service.
  if($env:NODE_OPTIONS -match '(^|\s)--jitless(?:\s|$)'){
    Write-Warning 'Removing inherited NODE_OPTIONS=--jitless because Node fetch/undici requires WebAssembly.'
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  }
  $nodeVersion=(& $nodePath --version 2>$null | Out-String).Trim()
  $v8Version=(& $nodePath -p "process.versions.v8" 2>$null | Out-String).Trim()
  $v8Options=(& $nodePath --v8-options 2>$null | Out-String)
  $nodeFlags=@()
  if($v8Options -match '(?m)(^|\s)--maglev(?:\s|$)'){$nodeFlags+='--no-maglev'}
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  $foregroundLog=Join-Path $logDir ("engine.foreground.$stamp.log")
  $reportDir=Join-Path (Get-Location) ("docs\reports\crash\foreground-$stamp")
  New-Item -ItemType Directory -Path $reportDir -Force|Out-Null
  $nodeArgs=@($nodeFlags)+@('--report-on-fatalerror','--report-uncaught-exception',("--report-directory=$reportDir"),'--trace-exit',$enginePath)
  $env:ZDJ_FOREGROUND_OBSERVE='1'
  Write-Host ''
  Write-Host '============================================================'
  Write-Host ' ZDJ-MITS ENGINE / FOREGROUND OBSERVE MODE'
  Write-Host '============================================================'
  Write-Host ('Node            : '+$nodeVersion)
  Write-Host ('V8              : '+$v8Version)
  Write-Host ('PID             : current console will own node.exe directly')
  Write-Host ('Engine          : '+$enginePath)
  $flagText=if($nodeFlags.Count){$nodeFlags -join ' '}else{'(none)'}
  Write-Host ('Node flags      : '+$flagText)
  Write-Host ('Console log     : '+$foregroundLog)
  Write-Host ('Crash reports   : '+$reportDir)
  Write-Host 'AI services     : untouched (8081/8083/8084 are not stopped or restarted)'
  Write-Host 'Press Ctrl+C only if you intentionally want to stop the Engine.'
  Write-Host '------------------------------------------------------------'
  $startedAt=Get-Date
  $header="[$($startedAt.ToString('yyyy-MM-dd HH:mm:ss.fff'))] FOREGROUND_START node=$nodeVersion v8=$v8Version flags=$($nodeFlags -join ' ') engine=$enginePath"
  [IO.File]::WriteAllText($foregroundLog,$header+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  $previousErrorAction=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try{
    & $nodePath @nodeArgs 2>&1 | ForEach-Object {
      $line="[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff'))] $($_.ToString())"
      Write-Host $line
      [IO.File]::AppendAllText($foregroundLog,$line+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    }
    $exitCode=if($null -eq $LASTEXITCODE){0}else{[int]$LASTEXITCODE}
  }finally{
    $ErrorActionPreference=$previousErrorAction
  }
  $endedAt=Get-Date
  $duration=[math]::Round(($endedAt-$startedAt).TotalSeconds,3)
  $exitUnsigned=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$exitCode),0)
  $exitHex=('0x{0:X8}' -f $exitUnsigned)
  $footer="[$($endedAt.ToString('yyyy-MM-dd HH:mm:ss.fff'))] FOREGROUND_EXIT exitCode=$exitCode exitHex=$exitHex durationSeconds=$duration"
  [IO.File]::AppendAllText($foregroundLog,$footer+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  Write-Host '------------------------------------------------------------'
  Write-Host ('ENGINE EXITED    : '+$endedAt.ToString('yyyy-MM-dd HH:mm:ss.fff'))
  Write-Host ('Duration seconds : '+$duration)
  Write-Host ('Exit code        : '+$exitCode)
  Write-Host ('Exit hex         : '+$exitHex)
  Write-Host ('Console log      : '+$foregroundLog)
  Write-Host ('Crash reports    : '+$reportDir)
  if($exitCode -eq -1073740791){Write-Host 'Detected Windows native fail-fast: 0xC0000409' -ForegroundColor Red}
  Write-Host 'Last 40 log lines:'
  Get-Content -LiteralPath $foregroundLog -Tail 40 -ErrorAction SilentlyContinue|ForEach-Object {Write-Host $_}
  exit $exitCode
}

if (-not (Test-Path -LiteralPath $hostScript)) { throw 'ENGINE_HOST_SCRIPT_MISSING' }
$launchId=[guid]::NewGuid().ToString('N')
$hostExe=(Get-Process -Id $PID -ErrorAction Stop).Path
$dq=[char]34
$hostArgs=@('-NoProfile','-ExecutionPolicy','Bypass','-File',($dq+$hostScript+$dq),'-NodePath',($dq+$nodePath+$dq),'-EnginePath',($dq+$enginePath+$dq),'-WorkingDirectory',($dq+(Get-Location).Path+$dq),'-StdoutPath',($dq+$stdout+$dq),'-StderrPath',($dq+$stderr+$dq),'-LifecyclePath',($dq+$launcherLifecycle+$dq),'-ReceiptPath',($dq+$receiptPath+$dq),'-LaunchId',$launchId)
$hostProcess=Start-Process -FilePath $hostExe -ArgumentList $hostArgs -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
$receipt=$null
for($attempt=0;$attempt -lt 50;$attempt++){
  if(Test-Path -LiteralPath $receiptPath){
    try{$candidate=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json;if($candidate.launchId -eq $launchId){$receipt=$candidate;break}}catch{}
  }
  $hostProcess.Refresh();if($hostProcess.HasExited){break};Start-Sleep -Milliseconds 100
}
if(-not $receipt){$hostProcess.Refresh();if($hostProcess.HasExited){throw "ENGINE_HOST_FAILED exit=$($hostProcess.ExitCode). See $launcherLifecycle"};throw "ENGINE_HOST_RECEIPT_TIMEOUT hostPid=$($hostProcess.Id). Manual review required; no automatic retry."}
Write-Output ('ZDJ-MITS started in background. PID=' + $receipt.pid + ' HOST_PID=' + $hostProcess.Id + ' LAUNCH_ID=' + $launchId)
Write-Output ('LAN URL(s): ' + ((Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred'} | ForEach-Object { 'http://' + $_.IPAddress + ':8080' }) -join ', '))
Write-Output ('Logs: ' + $stdout + ' / ' + $stderr)
Write-Output ('Process lifecycle: ' + (Join-Path $logDir 'engine-process-lifecycle.jsonl') + ' / ' + $launcherLifecycle)
} finally {
  $launchMutex.ReleaseMutex()
  $launchMutex.Dispose()
}
