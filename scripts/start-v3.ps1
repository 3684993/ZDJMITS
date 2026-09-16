param(
  [Parameter(Position=0)]
  [ValidateSet('start','init')]
  [string]$Mode='start',
  [int]$Port=8080,
  [string]$BindHost='0.0.0.0',
  [int]$ReadyTimeoutSeconds=180
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$probeHost='127.0.0.1'
$healthUrl="http://${probeHost}:$Port/health"
$liveUrl="http://${probeHost}:$Port/live"

$listener=Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue|Select-Object -First 1
if($listener){
  if($Mode -eq 'init'){throw "INIT_REQUIRES_ENGINE_STOPPED: port $Port is still listening (PID $($listener.OwningProcess)). Stop V3 before local initialization."}
  $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if($owner.CommandLine -notmatch 'apps[/\\]engine[/\\]dist[/\\]main\.js'){
    throw "Port $Port is occupied by PID $($listener.OwningProcess), not ZDJ-MITS"
  }
  try{
    $h=Invoke-RestMethod $healthUrl -TimeoutSec 5
    Write-Output "ZDJ-MITS already READY: http://${probeHost}:$Port  PID: $($listener.OwningProcess)  Bind: $($listener.LocalAddress)  Readiness: $($h.status)"
  }catch{
    Write-Output "ZDJ-MITS already listening but not READY: http://${probeHost}:$Port  PID: $($listener.OwningProcess)  Bind: $($listener.LocalAddress)"
  }
  exit 0
}

if($Mode -eq 'init'){
  Write-Output 'V3.9.3 init: resetting LOCAL runtime/history only. No Binance cancel/close/order write will be issued by the init step.'
  Push-Location $root
  try{
    & node '.\scripts\init-local-runtime.mjs'
    if($LASTEXITCODE -ne 0){throw "Local init failed with exit code $LASTEXITCODE"}
  }finally{Pop-Location}
  Write-Output 'V3.9.3 init complete. Static settings/secrets/resources preserved; exchange truth will be re-synchronized during bootstrap.'
}

foreach($depPort in 20081,8081,8084){
  if(-not(Test-NetConnection 127.0.0.1 -Port $depPort -InformationLevel Quiet -WarningAction SilentlyContinue)){
    throw "Required local dependency 127.0.0.1:$depPort is unavailable"
  }
}
if(-not(Test-Path (Join-Path $root 'apps\dashboard\dist\index.html'))){
  Push-Location $root
  try{npm run build;if($LASTEXITCODE -ne 0){throw "npm run build failed with exit code $LASTEXITCODE"}}
  finally{Pop-Location}
}
$logDir=Join-Path $root 'data\logs'
New-Item -ItemType Directory -Force -Path $logDir|Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout=Join-Path $logDir "v3-$stamp.out.log"
$stderr=Join-Path $logDir "v3-$stamp.err.log"
$env:ZDJ_HOST=$BindHost
$env:ZDJ_PORT="$Port"
$p=Start-Process node -ArgumentList @('apps/engine/dist/main.js') -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
$deadline=(Get-Date).AddSeconds([Math]::Max(30,$ReadyTimeoutSeconds))
$lastHealth='NO_HEALTH_RESPONSE'
while((Get-Date) -lt $deadline){
  if($p.HasExited){
    $errTail=if(Test-Path $stderr){(Get-Content $stderr -Tail 30)-join [Environment]::NewLine}else{'<empty stderr>'}
    throw "Engine PID $($p.Id) exited during bootstrap. stderr=$stderr`n$errTail"
  }
  try{
    $h=Invoke-RestMethod $healthUrl -TimeoutSec 5
    $lastHealth=($h|ConvertTo-Json -Compress -Depth 5)
    if($h.ready){
      Write-Output "Dashboard local: http://${probeHost}:$Port"
      if($BindHost -eq '0.0.0.0'){
        $lanIps=Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue|Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'}|Select-Object -ExpandProperty IPAddress -Unique
        foreach($ip in $lanIps){Write-Output "Dashboard LAN:   http://${ip}:$Port"}
      }
      Write-Output "Engine PID: $($p.Id)  Bind: $BindHost  Readiness: $($h.status)"
      exit 0
    }
  }catch{
    if($_.ErrorDetails.Message){$lastHealth=$_.ErrorDetails.Message}else{$lastHealth=$_.Exception.Message}
  }
  Start-Sleep 1
}
$live='UNREACHABLE'
try{$live=(Invoke-RestMethod $liveUrl -TimeoutSec 3|ConvertTo-Json -Compress)}catch{$live=$_.Exception.Message}
throw "Engine PID $($p.Id) is LIVE but did not become READY within $ReadyTimeoutSeconds seconds. live=$live health=$lastHealth stdout=$stdout stderr=$stderr"
