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

# Keep the long-running service detached from the caller's terminal. The engine
# emits high-volume diagnostics; redirecting them prevents a full PTY from
# applying backpressure to Node's event loop and makes LAN startup repeatable.
$logDir = Join-Path (Get-Location) 'data\runtime-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stdout = Join-Path $logDir 'engine.stdout.log'
$stderr = Join-Path $logDir 'engine.stderr.log'
$env:ZDJ_START_REASON = $StartReason
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$enginePath = Join-Path (Get-Location) 'apps\engine\dist\main.js'
if (-not (Test-Path -LiteralPath $enginePath)) { throw 'ENGINE_BUILD_MISSING: build explicitly before starting.' }
$child = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $enginePath + '"')) -WorkingDirectory (Get-Location) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
Write-Output ('ZDJ-MITS started in background. PID=' + $child.Id)
Write-Output ('LAN URL(s): ' + ((Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred'} | ForEach-Object { 'http://' + $_.IPAddress + ':8080' }) -join ', '))
Write-Output ('Logs: ' + $stdout + ' / ' + $stderr)
} finally {
  $launchMutex.ReleaseMutex()
  $launchMutex.Dispose()
}
