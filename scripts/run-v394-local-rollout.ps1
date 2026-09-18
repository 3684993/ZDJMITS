[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('Stage6','Stage7','Stage8','Status')]
  [string]$Phase,
  [int]$Port=8080,
  [ValidateRange(30,120)][int]$Stage6Minutes=60,
  [ValidateRange(1,100)][decimal]$CanaryMarginUsd=5,
  [ValidateRange(5,240)][int]$EntryWaitMinutes=120,
  [ValidateRange(5,240)][int]$LifecycleWaitMinutes=120,
  [switch]$AuthorizeStage6ProxyEnable,
  [string]$ExpectedStaticEgressIp,
  [switch]$AuthorizeTestnetWrite,
  [switch]$AuthorizeAutoTrading
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base="http://127.0.0.1:$Port"
$activeStatuses=@('NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED')

function ApiGet([string]$path){Invoke-RestMethod -Uri ($base+$path) -TimeoutSec 20}
function ApiPost([string]$path,[object]$body=$null){
  $params=@{Uri=($base+$path);Method='POST';ContentType='application/json';TimeoutSec=30}
  if($null -ne $body){$params.Body=($body|ConvertTo-Json -Depth 30 -Compress)}
  Invoke-RestMethod @params
}
function ApiPut([string]$path,[object]$body){
  Invoke-RestMethod -Uri ($base+$path) -Method PUT -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 50 -Compress) -TimeoutSec 30
}
function EngineListener(){Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue|Select-Object -First 1}
function AssertEngineOff(){if(EngineListener){throw "ENGINE_MUST_BE_OFF: port $Port is listening"}}
function AssertEngineOn(){if(-not(EngineListener)){throw "ENGINE_NOT_RUNNING: port $Port is not listening"}}
function PrepareStage6EngineOff(){
  $listener=EngineListener
  if(-not $listener){return}
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if($p.CommandLine -notmatch 'apps[/\\]engine[/\\]dist[/\\]main\.js'){throw "ENGINE_MUST_BE_OFF: port $Port is occupied by non-ZDJ PID $($listener.OwningProcess)"}
  try{$current=ApiGet '/api/v3/settings'}catch{throw "STAGE6_RETRY_REFUSES_UNREADABLE_ENGINE: PID=$($listener.OwningProcess)"}
  if($current.connections.exchange.environment -ne 'TESTNET' -or $current.connections.executionMode -ne 'READ_ONLY'){throw "STAGE6_RETRY_REFUSES_NON_READ_ONLY_ENGINE: environment=$($current.connections.exchange.environment) executionMode=$($current.connections.executionMode)"}
  StopEngine
  Write-Output 'STAGE6_RETRY_STOPPED_READ_ONLY_ENGINE=TRUE'
}
function StartEngine(){
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-v3.ps1') start -Port $Port
  if($LASTEXITCODE -ne 0){throw "ENGINE_START_FAILED:$LASTEXITCODE"}
  AssertEngineOn
}
function StopEngine(){
  $listener=EngineListener
  if(-not $listener){return}
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if($p.CommandLine -notmatch 'apps[/\\]engine[/\\]dist[/\\]main\.js'){throw "REFUSE_STOP_NON_ZDJ_PROCESS: PID=$($listener.OwningProcess)"}
  Stop-Process -Id $listener.OwningProcess -Force
  $deadline=(Get-Date).AddSeconds(20)
  while((Get-Date)-lt $deadline -and (EngineListener)){Start-Sleep -Milliseconds 250}
  AssertEngineOff
}
function LatestPassing([string]$pattern){
  $dirs=Get-ChildItem (Join-Path $root 'data\reports') -Directory -Filter $pattern -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending
  foreach($dir in $dirs){
    $summary=Join-Path $dir.FullName 'summary.json'
    if(Test-Path $summary){
      try{$obj=Get-Content $summary -Raw|ConvertFrom-Json;if($obj.pass -eq $true){return [pscustomobject]@{dir=$dir.FullName;summary=$obj}}}catch{}
    }
  }
  return $null
}
function AssertCoreRuntime([object]$settings){
  if($settings.connections.exchange.environment -ne 'TESTNET'){throw 'TESTNET_REQUIRED'}
  $rest=[string]$settings.connections.exchange.testnetRestBaseUrl
  if([string]::IsNullOrWhiteSpace($rest)){$rest=[string]$settings.connections.exchange.testnetBaseUrl}
  if(([uri]$rest).Host -ne 'demo-fapi.binance.com'){throw "DEMO_REST_REQUIRED:$rest"}
  if(-not $settings.connections.proxy.enabled){throw 'PROXY_REQUIRED'}
  if([string]::IsNullOrWhiteSpace([string]$settings.connections.proxy.expectedStaticEgressIp)){throw 'EXPECTED_STATIC_EGRESS_REQUIRED'}
}
function VerifyStage6ProxyEgress(){
  $probe=ApiPost '/api/v3/settings/resources/proxy/binance-proxy/test'
  if($probe.status -ne 'HEALTHY'){throw "STAGE6_PROXY_HEALTH_NOT_HEALTHY:$($probe.status):$($probe.egress.status):$($probe.egress.lastError)"}
  if($probe.egress.status -ne 'VERIFIED'){throw "STAGE6_PROXY_EGRESS_NOT_VERIFIED:$($probe.egress.status):$($probe.egress.lastError)"}
  if($probe.egress.expectedEgressIp -ne $probe.egress.lastVerifiedEgressIp){throw "STAGE6_PROXY_EGRESS_IP_MISMATCH:expected=$($probe.egress.expectedEgressIp):observed=$($probe.egress.lastVerifiedEgressIp)"}
  Write-Output "STAGE6_PROXY_EGRESS_VERIFIED=$($probe.egress.lastVerifiedEgressIp)"
  return $probe
}
function AssertGovernance(){
  $gov=ApiGet '/api/v3/diagnostics/binance-governance'
  $route=@($gov.routes|Where-Object {$_.environment -eq 'TESTNET'}|Select-Object -First 1)[0]
  if(-not $route){throw 'TESTNET_GOVERNANCE_ROUTE_MISSING'}
  if($route.rest.host -ne 'demo-fapi.binance.com'){throw "REST_HOST_VIOLATION:$($route.rest.host)"}
  if($route.egress.status -ne 'VERIFIED'){throw "STATIC_EGRESS_NOT_VERIFIED:$($route.egress.status)"}
  if($route.egress.verifiedEgressIp -and $route.egress.expectedEgressIp -and $route.egress.verifiedEgressIp -ne $route.egress.expectedEgressIp){throw 'STATIC_EGRESS_IP_MISMATCH'}
  $blockedBudgetStatuses=@('PRIVATE_ONLY','SATURATED','RATE_LIMITED','RECOVERING','PERSISTENCE_FAILED')
  if($blockedBudgetStatuses -contains [string]$route.requestBudget.status){throw "BINANCE_REQUEST_BUDGET_NOT_HEALTHY:$($route.requestBudget.status)"}
  if([string]$route.requestBudget.observationTrust -eq 'RATE_LIMITED'){throw "BINANCE_REQUEST_BUDGET_TRUST_RATE_LIMITED"}
  return $route
}
function AssertPrivateReady(){
  $h=ApiGet '/health'
  if(-not $h.ready){throw "ENGINE_NOT_READY:$($h.status)"}
  if($h.checks.privateData.status -ne 'READY'){throw "ACCOUNT_NOT_READY:$($h.checks.privateData.status)"}
  if($h.checks.marketStream.state -ne 'LIVE'){throw "WS_NOT_LIVE:$($h.checks.marketStream.state)"}
  $p=ApiGet '/api/v3/pipeline'
  $recon=if($p.reconciliation.state){$p.reconciliation.state}elseif($p.reconciliation.lastError){'DEGRADED'}else{'SETTLED'}
  if($recon -ne 'SETTLED'){throw "RECONCILIATION_NOT_SETTLED:$recon"}
}
function PauseEntries([string]$reason){ApiPost '/api/v3/runtime/trading-control/pause' @{reason=$reason}|Out-Null}
function ResumeEntries(){ApiPost '/api/v3/runtime/trading-control/resume'|Out-Null}
function AssertNoExistingExposure(){
  $positions=@(ApiGet '/api/v3/positions')
  $orders=ApiGet '/api/v3/orders'
  $active=@($orders.entry|Where-Object {$activeStatuses -contains $_.status})
  if($positions.Count -gt 0 -or $active.Count -gt 0){throw "STAGE7_REQUIRES_NO_EXISTING_EXPOSURE: positions=$($positions.Count) activeEntry=$($active.Count)"}
}
function SaveJson([string]$path,[object]$value){$value|ConvertTo-Json -Depth 50|Set-Content -LiteralPath $path -Encoding utf8}

if($Phase -eq 'Status'){
  AssertEngineOn
  $s=ApiGet '/api/v3/settings';$h=ApiGet '/health';$g=AssertGovernance;$c=ApiGet '/api/v3/runtime/trading-control'
  [pscustomobject]@{release='V3.9.4';executionMode=$s.connections.executionMode;health=$h.status;account=$h.checks.privateData.status;ws=$h.checks.marketStream.state;restHost=$g.rest.host;egress=$g.egress.status;egressIp=$g.egress.verifiedEgressIp;runtimeMode=$c.mode;executionGovernance=$c.executionGovernance.mode}|Format-List
  exit 0
}

if($Phase -eq 'Stage6'){
  PrepareStage6EngineOff
  AssertEngineOff
  Push-Location $root
  try{
    $normalizeArgs=@('.\\scripts\\v394-stage6-set-readonly.mjs','--port',[string]$Port)
    if($AuthorizeStage6ProxyEnable){$normalizeArgs+='--authorize-enable-proxy'}
    if(-not [string]::IsNullOrWhiteSpace($ExpectedStaticEgressIp)){$normalizeArgs+=@('--expected-static-egress-ip',$ExpectedStaticEgressIp)}
    & node @normalizeArgs
    if($LASTEXITCODE -ne 0){throw "STAGE6_READONLY_DOWNGRADE_FAILED:$LASTEXITCODE"}
    & npm run v394:stage6:preflight
    if($LASTEXITCODE -ne 0){throw "STAGE6_PREFLIGHT_FAILED:$LASTEXITCODE"}
    & npm run build
    if($LASTEXITCODE -ne 0){throw "STAGE6_BUILD_FAILED:$LASTEXITCODE"}
    Write-Output 'STAGE6_CURRENT_HEAD_DIST_BUILD_PASS=TRUE'
  }finally{Pop-Location}
  StartEngine
  $settings=ApiGet '/api/v3/settings'
  AssertCoreRuntime $settings
  if($settings.connections.executionMode -ne 'READ_ONLY'){throw "STAGE6_REQUIRES_READ_ONLY:$($settings.connections.executionMode)"}
  AssertPrivateReady
  VerifyStage6ProxyEgress|Out-Null
  $stage6Baseline=AssertGovernance
  Write-Output "STAGE6_RATE_LIMIT_BASELINE=http429:$([int]$stage6Baseline.requestBudget.http429),http418:$([int]$stage6Baseline.requestBudget.http418)"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'run-v394-readonly-canary.ps1') -DurationMinutes $Stage6Minutes -IntervalSeconds 30 -Port $Port -BaselineHttp429 ([int]$stage6Baseline.requestBudget.http429) -BaselineHttp418 ([int]$stage6Baseline.requestBudget.http418)
  if($LASTEXITCODE -ne 0){throw "STAGE6_READONLY_CANARY_FAILED:$LASTEXITCODE"}
  Write-Output 'STAGE6_PASS_ENGINE_REMAINS_READ_ONLY=TRUE'
  exit 0
}

if($Phase -eq 'Stage7'){
  if(-not $AuthorizeTestnetWrite){throw 'STAGE7_REQUIRES_-AuthorizeTestnetWrite'}
  AssertEngineOn
  $stage6=LatestPassing 'v394-stage6-readonly-*'
  if(-not $stage6){throw 'STAGE6_PASS_EVIDENCE_REQUIRED'}
  $settings=ApiGet '/api/v3/settings'
  AssertCoreRuntime $settings
  if($settings.connections.executionMode -ne 'READ_ONLY'){throw "STAGE7_ARM_EXPECTED_READ_ONLY:$($settings.connections.executionMode)"}
  AssertPrivateReady
  AssertGovernance|Out-Null
  AssertNoExistingExposure
  PauseEntries 'V3.9.4 Stage7 single-entry canary arming'
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  $outDir=Join-Path $root "data\reports\v394-stage7-testnet-$stamp"
  New-Item -ItemType Directory -Force -Path $outDir|Out-Null
  SaveJson (Join-Path $outDir 'settings-before.json') $settings

  $candidate=$settings|ConvertTo-Json -Depth 50|ConvertFrom-Json
  $candidate.connections.executionMode='TESTNET_ENABLED'
  $candidate.portfolio.maxPositions=1
  $candidate.portfolio.maxPendingEntries=1
  $candidate.portfolio.entryMarginUsd=[double]$CanaryMarginUsd
  $candidate.portfolioIntelligence.dynamicMarginEnabled=$false
  $candidate.portfolioIntelligence.baseMarginUsd=[double]$CanaryMarginUsd
  $candidate.portfolioIntelligence.minMarginUsd=[Math]::Min([double]$CanaryMarginUsd,[Math]::Max(0.01,[double]$candidate.portfolioIntelligence.minMarginUsd))
  $candidate.portfolioIntelligence.maxMarginPerPositionUsd=[double]$CanaryMarginUsd
  $saved=ApiPut '/api/v3/settings' $candidate
  SaveJson (Join-Path $outDir 'settings-canary.json') $saved
  if($saved.connections.executionMode -ne 'TESTNET_ENABLED'){throw 'STAGE7_WRITE_MODE_DID_NOT_PERSIST'}
  Start-Sleep -Seconds 2

  StopEngine
  StartEngine
  PauseEntries 'V3.9.4 Stage7 armed; waiting for explicit canary release'
  $armed=ApiGet '/api/v3/settings'
  AssertCoreRuntime $armed
  if($armed.connections.executionMode -ne 'TESTNET_ENABLED'){throw 'STAGE7_RESTART_NOT_TESTNET_ENABLED'}
  AssertPrivateReady
  $route=AssertGovernance
  $exchangeTest=ApiPost '/api/v3/settings/resources/exchange/binance-usdm/test'
  if($exchangeTest.status -ne 'READY' -and $exchangeTest.status -ne 'HEALTHY'){throw "EXCHANGE_TEST_NOT_READY:$($exchangeTest.status)"}
  if($exchangeTest.credentials.configured -ne $true){throw 'TESTNET_CREDENTIALS_NOT_CONFIGURED'}
  if($exchangeTest.writeEnabled -ne $true){throw 'TESTNET_WRITE_BOUNDARY_NOT_ENABLED'}

  $beforeOrders=ApiGet '/api/v3/orders'
  $baselineIds=@($beforeOrders.entry|ForEach-Object {[string]$_.id})
  $startGov=AssertGovernance
  ResumeEntries
  $entry=$null
  $entryDeadline=(Get-Date).AddMinutes($EntryWaitMinutes)
  while((Get-Date)-lt $entryDeadline){
    Start-Sleep -Seconds 2
    $orders=ApiGet '/api/v3/orders'
    $entry=@($orders.entry|Where-Object {$baselineIds -notcontains [string]$_.id}|Sort-Object updatedAt -Descending|Select-Object -First 1)[0]
    if($entry){
      PauseEntries 'V3.9.4 Stage7 first canary entry observed; lock new entries'
      SaveJson (Join-Path $outDir 'entry-first-observed.json') $entry
      break
    }
  }
  if(-not $entry){
    PauseEntries 'V3.9.4 Stage7 no natural entry in observation window'
    $summary=[ordered]@{schema='V3.9.4-STAGE7-CANARY-1';pass=$false;status='NO_NATURAL_ENTRY';canaryMarginUsd=[double]$CanaryMarginUsd;stage6Evidence=$stage6.dir;outDir=$outDir}
    SaveJson (Join-Path $outDir 'summary.json') $summary
    Write-Output "STAGE7_PENDING_NO_NATURAL_ENTRY=$outDir"
    exit 3
  }

  $entryId=[string]$entry.id
  $symbol=[string]$entry.symbol
  $filled=$false;$tpProtected=$false;$lastEntry=$entry;$tp=$null
  $lifeDeadline=(Get-Date).AddMinutes($LifecycleWaitMinutes)
  while((Get-Date)-lt $lifeDeadline){
    Start-Sleep -Seconds 3
    $orders=ApiGet '/api/v3/orders'
    $lastEntry=@($orders.entry|Where-Object {[string]$_.id -eq $entryId}|Select-Object -First 1)[0]
    if($lastEntry -and ($lastEntry.status -eq 'FILLED' -or [double]$lastEntry.filledQuantity -gt 0)){$filled=$true}
    if($filled){
      $tp=@($orders.takeProfit|Where-Object {$_.symbol -eq $symbol -and $activeStatuses -contains $_.status}|Sort-Object updatedAt -Descending|Select-Object -First 1)[0]
      if($tp){$tpProtected=$true;break}
    }
    if($lastEntry -and @('CANCELED','EXPIRED','REJECTED').Contains([string]$lastEntry.status) -and -not $filled){break}
  }
  PauseEntries 'V3.9.4 Stage7 canary evidence captured'
  $endGov=AssertGovernance
  $private=ApiGet '/api/v3/diagnostics/private-sync'
  $integrity=ApiGet '/api/v3/diagnostics/p0-entry-integrity'
  SaveJson (Join-Path $outDir 'entry-final.json') $lastEntry
  SaveJson (Join-Path $outDir 'tp.json') $tp
  SaveJson (Join-Path $outDir 'private-sync.json') $private
  SaveJson (Join-Path $outDir 'p0-entry-integrity.json') $integrity
  $summary=[ordered]@{
    schema='V3.9.4-STAGE7-CANARY-1';pass=($filled -and $tpProtected);status=if($filled -and $tpProtected){'PASS'}elseif($filled){'FILLED_TP_PENDING'}else{'ENTRY_NOT_FILLED'};
    canaryMarginUsd=[double]$CanaryMarginUsd;symbol=$symbol;entryId=$entryId;entryStatus=$lastEntry.status;filled=$filled;tpProtected=$tpProtected;
    http429Delta=([int]$endGov.requestBudget.http429-[int]$startGov.requestBudget.http429);http418Delta=([int]$endGov.requestBudget.http418-[int]$startGov.requestBudget.http418);
    stage6Evidence=$stage6.dir;settingsBefore=(Join-Path $outDir 'settings-before.json');settingsCanary=(Join-Path $outDir 'settings-canary.json')
  }
  if($summary.http429Delta -ne 0 -or $summary.http418Delta -ne 0){$summary.pass=$false;$summary.status='RATE_LIMIT_VIOLATION'}
  SaveJson (Join-Path $outDir 'summary.json') $summary
  Write-Output "STAGE7_EVIDENCE_DIR=$outDir"
  Write-Output ($summary|ConvertTo-Json -Depth 20)
  if(-not $summary.pass){exit 4}
  Write-Output 'STAGE7_PASS_ENGINE_REMAINS_PAUSED=TRUE'
  exit 0
}

if($Phase -eq 'Stage8'){
  if(-not $AuthorizeAutoTrading){throw 'STAGE8_REQUIRES_-AuthorizeAutoTrading'}
  AssertEngineOn
  $stage7=LatestPassing 'v394-stage7-testnet-*'
  if(-not $stage7){throw 'STAGE7_PASS_EVIDENCE_REQUIRED'}
  $beforePath=[string]$stage7.summary.settingsBefore
  if(-not(Test-Path $beforePath)){throw "STAGE7_SETTINGS_BACKUP_MISSING:$beforePath"}
  PauseEntries 'V3.9.4 Stage8 restore normal Testnet settings before automatic trading'
  $current=ApiGet '/api/v3/settings'
  $restore=Get-Content $beforePath -Raw|ConvertFrom-Json
  $restore.settingsVersion=$current.settingsVersion
  $restore.connections.executionMode='TESTNET_ENABLED'
  $saved=ApiPut '/api/v3/settings' $restore
  AssertCoreRuntime $saved
  if($saved.connections.executionMode -ne 'TESTNET_ENABLED'){throw 'STAGE8_RESTORE_NOT_TESTNET_ENABLED'}
  AssertPrivateReady
  AssertGovernance|Out-Null
  ResumeEntries
  $control=ApiGet '/api/v3/runtime/trading-control'
  if($control.mode -ne 'RUNNING' -or $control.executionGovernance.mode -ne 'AUTO_RUNNING'){
    throw "AUTO_TRADING_NOT_RUNNING: runtime=$($control.mode) governance=$($control.executionGovernance.mode)"
  }
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  $outDir=Join-Path $root "data\reports\v394-stage8-start-$stamp"
  New-Item -ItemType Directory -Force -Path $outDir|Out-Null
  $result=[ordered]@{schema='V3.9.4-STAGE8-START-1';startedAt=[DateTimeOffset]::UtcNow.ToString('o');executionMode='TESTNET_ENABLED';runtimeMode=$control.mode;executionGovernance=$control.executionGovernance.mode;stage7Evidence=$stage7.dir;automaticTradingStarted=$true}
  SaveJson (Join-Path $outDir 'summary.json') $result
  Write-Output "STAGE8_AUTO_TRADING_STARTED=$outDir"
  Write-Output ($result|ConvertTo-Json -Depth 20)
  Write-Output 'NEXT=run 12H V3.9.4 write canary acceptance while keeping Engine and fixed proxy unchanged'
  exit 0
}
