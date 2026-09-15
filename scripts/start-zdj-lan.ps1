[CmdletBinding()]
param(
  [string]$StartReason = 'MANUAL_START',
  [switch]$SkipFirewall
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
$env:ZDJ_START_REASON = $StartReason
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$enginePath = Join-Path (Get-Location) 'apps\engine\dist\main.js'
$hostScript = Join-Path $PSScriptRoot 'start-zdj-engine-host.ps1'
if (-not (Test-Path -LiteralPath $enginePath)) { throw 'ENGINE_BUILD_MISSING: build explicitly before starting.' }
if (-not (Test-Path -LiteralPath $hostScript)) { throw 'ENGINE_HOST_SCRIPT_MISSING' }
$launchId=[guid]::NewGuid().ToString('N')
$hostExe=(Get-Process -Id $PID -ErrorAction Stop).Path
$quote={param($v) '"'+([string]$v).Replace('"','\"')+'"'}
$hostArgs=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(& $quote $hostScript),'-NodePath',(& $quote $nodePath),'-EnginePath',(& $quote $enginePath),'-WorkingDirectory',(& $quote (Get-Location).Path),'-StdoutPath',(& $quote $stdout),'-StderrPath',(& $quote $stderr),'-LifecyclePath',(& $quote $launcherLifecycle),'-ReceiptPath',(& $quote $receiptPath),'-LaunchId',$launchId)
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
