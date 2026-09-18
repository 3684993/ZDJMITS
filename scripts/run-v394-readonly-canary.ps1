[CmdletBinding()]
param(
  [ValidateRange(5,120)][int]$DurationMinutes=60,
  [ValidateRange(10,300)][int]$IntervalSeconds=30,
  [int]$Port=8080,
  [int]$BaselineHttp429=-1,
  [int]$BaselineHttp418=-1,
  [string]$PriorEvidenceDir
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base="http://127.0.0.1:$Port"
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir=Join-Path $root "data\reports\v394-stage6-readonly-$stamp"
New-Item -ItemType Directory -Force -Path $outDir|Out-Null
$samples=Join-Path $outDir 'samples.jsonl'
$summary=Join-Path $outDir 'summary.json'
if($DurationMinutes -lt 30){
  if([string]::IsNullOrWhiteSpace($PriorEvidenceDir)){throw 'STAGE6_SHORT_RECHECK_REQUIRES_PRIOR_30M_EVIDENCE'}
  $priorSummaryPath=Join-Path $PriorEvidenceDir 'summary.json'
  if(-not(Test-Path $priorSummaryPath)){throw "STAGE6_SHORT_RECHECK_PRIOR_SUMMARY_MISSING:$priorSummaryPath"}
  $prior=Get-Content $priorSummaryPath -Raw|ConvertFrom-Json
  $qualified=([int]$prior.requestedDurationMinutes -ge 30 -and [int]$prior.routeViolationSamples -eq 0 -and [int]$prior.egressViolationSamples -eq 0 -and [int]$prior.http429Delta -eq 0 -and [int]$prior.http418Delta -eq 0 -and [int]$prior.privateTruthTimeoutDelta -eq 0 -and [double]$prior.readyRate -eq 1 -and [double]$prior.accountReadyRate -eq 1 -and [double]$prior.wsLiveRate -eq 1 -and [double]$prior.reconciliationSettledRate -eq 1 -and [int]$prior.falseCounterDiscontinuity -gt 0)
  if(-not $qualified){throw 'STAGE6_SHORT_RECHECK_PRIOR_EVIDENCE_NOT_QUALIFIED'}
}

function Get-Api([string]$path){Invoke-RestMethod -Uri ($base+$path) -TimeoutSec 15}
$settings=Get-Api '/api/v3/settings'
if($settings.connections.executionMode -ne 'READ_ONLY'){throw "STAGE6_REQUIRES_READ_ONLY: $($settings.connections.executionMode)"}
if($settings.connections.exchange.environment -ne 'TESTNET'){throw "STAGE6_REQUIRES_TESTNET"}
$rest=[string]$settings.connections.exchange.testnetRestBaseUrl
if([string]::IsNullOrWhiteSpace($rest)){$rest=[string]$settings.connections.exchange.testnetBaseUrl}
if(([uri]$rest).Host -ne 'demo-fapi.binance.com'){throw "STAGE6_REQUIRES_BINANCE_DEMO_REST: $rest"}
$expected=[string]$settings.connections.proxy.expectedStaticEgressIp
if([string]::IsNullOrWhiteSpace($expected)){throw "STAGE6_REQUIRES_EXPECTED_STATIC_EGRESS_IP"}
if(-not $settings.connections.proxy.enabled){throw "STAGE6_REQUIRES_PROXY_ENABLED"}

$deadline=(Get-Date).AddMinutes($DurationMinutes)
$list=[System.Collections.Generic.List[object]]::new()
while((Get-Date) -lt $deadline){
  $health=Get-Api '/health'
  $gov=Get-Api '/api/v3/diagnostics/binance-governance'
  $private=Get-Api '/api/v3/diagnostics/private-sync'
  $pipeline=Get-Api '/api/v3/pipeline'
  $route=@($gov.routes|Where-Object {$_.environment -eq 'TESTNET'}|Select-Object -First 1)[0]
  $budget=$route.requestBudget
  $recon=$pipeline.reconciliation
  $sample=[ordered]@{
    at=[DateTimeOffset]::UtcNow.ToString('o')
    healthStatus=$health.status
    ready=[bool]$health.ready
    accountStatus=$health.checks.privateData.status
    wsState=$health.checks.marketStream.state
    reconciliation=if($recon){if($recon.state){$recon.state}elseif($recon.lastError){'DEGRADED'}else{'SETTLED'}}else{'UNKNOWN'}
    restHost=$route.rest.host
    routeIdentity=$route.rest.routeIdentity
    egressStatus=$route.egress.status
    expectedEgressIp=$route.egress.expectedEgressIp
    verifiedEgressIp=$route.egress.lastVerifiedEgressIp
    observationTrust=$budget.observationTrust
    budgetStatus=$budget.status
    http429=[int]$budget.http429
    http418=[int]$budget.http418
    backgroundTimeout=[int]$budget.laneStats.BACKGROUND.timeout
    privateTruthTimeout=[int]$budget.laneStats.PRIVATE_TRUTH.timeout
    rateLimits=@($budget.rateLimits)
  }
  $list.Add([pscustomobject]$sample)
  ($sample|ConvertTo-Json -Depth 12 -Compress)|Add-Content -LiteralPath $samples -Encoding utf8
  Start-Sleep -Seconds $IntervalSeconds
}
if(-not $list.Count){throw 'STAGE6_NO_SAMPLES'}
$first=$list[0];$last=$list[$list.Count-1]
$http429Start=if($BaselineHttp429 -ge 0){$BaselineHttp429}else{[int]$first.http429}
$http418Start=if($BaselineHttp418 -ge 0){$BaselineHttp418}else{[int]$first.http418}
$all=@($list)
$badRoute=@($all|Where-Object {$_.restHost -ne 'demo-fapi.binance.com'}).Count
$badEgress=@($all|Where-Object {$_.egressStatus -ne 'VERIFIED' -or $_.verifiedEgressIp -ne $expected}).Count
$falseDiscontinuity=0
foreach($row in $all){foreach($limit in @($row.rateLimits)){if($limit.counterDiscontinuity -eq $true -and $limit.windowReset -ne $true){$falseDiscontinuity++}}}
$result=[ordered]@{
  schema='V3.9.4-STAGE6-READONLY-1'
  startedAt=$first.at
  completedAt=$last.at
  requestedDurationMinutes=$DurationMinutes
  qualificationMode=if($DurationMinutes -lt 30){'PRIOR_30M_PLUS_TARGETED_RECHECK'}else{'FULL_CANARY'}
  priorEvidenceDir=if($DurationMinutes -lt 30){$PriorEvidenceDir}else{$null}
  sampleCount=$list.Count
  executionMode='READ_ONLY'
  restHost='demo-fapi.binance.com'
  expectedStaticEgressIp=$expected
  routeViolationSamples=$badRoute
  egressViolationSamples=$badEgress
  http429Baseline=$http429Start
  http418Baseline=$http418Start
  http429Final=[int]$last.http429
  http418Final=[int]$last.http418
  http429Delta=([int]$last.http429-$http429Start)
  http418Delta=([int]$last.http418-$http418Start)
  falseCounterDiscontinuity=$falseDiscontinuity
  privateTruthTimeoutDelta=([int]$last.privateTruthTimeout-[int]$first.privateTruthTimeout)
  backgroundTimeoutDelta=([int]$last.backgroundTimeout-[int]$first.backgroundTimeout)
  readyRate=(@($all|Where-Object {$_.ready}).Count/[double]$list.Count)
  accountReadyRate=(@($all|Where-Object {$_.accountStatus -eq 'READY'}).Count/[double]$list.Count)
  wsLiveRate=(@($all|Where-Object {$_.wsState -eq 'LIVE'}).Count/[double]$list.Count)
  reconciliationSettledRate=(@($all|Where-Object {$_.reconciliation -eq 'SETTLED'}).Count/[double]$list.Count)
}
$result.pass=($result.routeViolationSamples -eq 0 -and $result.egressViolationSamples -eq 0 -and $result.http429Delta -eq 0 -and $result.http418Delta -eq 0 -and $result.falseCounterDiscontinuity -eq 0 -and $result.privateTruthTimeoutDelta -eq 0 -and $result.accountReadyRate -eq 1 -and $result.wsLiveRate -eq 1 -and $result.reconciliationSettledRate -eq 1)
$result|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $summary -Encoding utf8
Write-Output "STAGE6_EVIDENCE_DIR=$outDir"
Write-Output ($result|ConvertTo-Json -Depth 12)
if(-not $result.pass){exit 2}
