[CmdletBinding()]
param([int]$Port=8080)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$identityPath=Join-Path $projectRoot 'data\runtime\engine-instance.json'
if(-not(Test-Path -LiteralPath $identityPath)){throw 'ZDJ_RUNTIME_IDENTITY_MISSING_DO_NOT_KILL'}
$identity=Get-Content -LiteralPath $identityPath -Raw|ConvertFrom-Json
$listeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
foreach($listener in $listeners){
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  $identityMatches=[int]$identity.pid -eq [int]$listener.OwningProcess -and [int]$identity.port -eq $Port
  $binaryMatches=$proc -and $proc.Name -eq 'node.exe' -and $proc.ExecutablePath -like '*\node.exe'
  $commandMatches=$proc -and $proc.CommandLine -match '(^|[\\/])dist[\\/]main\.js([\s"]|$)'
  if(-not($identityMatches -and $binaryMatches -and $commandMatches)){throw "PORT_${Port}_OWNER_NOT_PROVEN_ZDJ PID=$($listener.OwningProcess) UNKNOWN_DO_NOT_KILL"}
  $payload=@{instanceId=[string]$identity.instanceId}|ConvertTo-Json -Compress
  $response=Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/ops/shutdown" -ContentType 'application/json' -Body $payload -TimeoutSec 5
  if(-not $response.accepted){throw 'ENGINE_GRACEFUL_STOP_NOT_ACCEPTED'}
}
for($i=0;$i-lt 60;$i++){
  if(-not(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)){Write-Output "ZDJ-MITS stopped; port $Port is free";exit 0}
  Start-Sleep -Milliseconds 250
}
throw "PORT_${Port}_DID_NOT_RELEASE"
