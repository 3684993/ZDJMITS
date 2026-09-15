[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ProjectRoot,
  [Parameter(Mandatory=$true)][string]$NodePath,
  [string]$EngineRelativePath='apps\engine\dist\main.js',
  [string]$StartReason='MANUAL_START'
)
$ErrorActionPreference='Stop'
if($StartReason -ne 'MANUAL_START'){throw 'MANUAL_START_ONLY'}
Set-Location $ProjectRoot
$env:ZDJ_HOST='0.0.0.0';$env:ZDJ_PORT='8080'
$env:ZDJ_DATA_DIR=Join-Path $ProjectRoot 'data';$env:ZDJ_CONFIG_DIR=Join-Path $ProjectRoot 'config'
$env:ZDJ_START_REASON=$StartReason;$env:ZDJ_LAUNCH_AUTHORITY='WINDOWS_TASK_SCHEDULER_MANUAL'
$listeners=@(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)
if($listeners.Count){throw "PORT_8080_ALREADY_LISTENING PID=$($listeners[0].OwningProcess)"}
$logDir=Join-Path $ProjectRoot 'data\runtime-logs';$runtimeDir=Join-Path $ProjectRoot 'data\runtime'
New-Item -ItemType Directory -Path $logDir,$runtimeDir -Force|Out-Null
$enginePath=Join-Path $ProjectRoot $EngineRelativePath
if(-not(Test-Path -LiteralPath $enginePath)){throw 'ENGINE_BUILD_MISSING'}
$launchId=[guid]::NewGuid().ToString('N')
& (Join-Path $PSScriptRoot 'start-zdj-engine-host.ps1') -NodePath $NodePath -EnginePath $enginePath -WorkingDirectory $ProjectRoot -StdoutPath (Join-Path $logDir 'engine.stdout.log') -StderrPath (Join-Path $logDir 'engine.stderr.log') -LifecyclePath (Join-Path $logDir 'engine-launch-lifecycle.jsonl') -ReceiptPath (Join-Path $runtimeDir 'engine-launch-receipt.json') -LaunchId $launchId -LaunchAuthority 'WINDOWS_TASK_SCHEDULER_MANUAL'
exit $LASTEXITCODE
