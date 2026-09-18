param(
  [ValidateSet('Status','Cleanup','Stage7','Stage8','Accept12H','Accept24H','All')]$Phase='Status',
  [int]$Port=8080,
  [double]$CanaryMarginUsd=5,
  [int]$SampleIntervalSeconds=60,
  [switch]$AuthorizeTestnetCleanup,
  [switch]$AuthorizeStage7Write,
  [switch]$AuthorizeStage8AutoTrading,
  [string]$StateRoot='data\rollout\v394-stage7-9'
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$base="http://127.0.0.1:$Port"
$ckptPath=Join-Path $root (Join-Path $StateRoot 'checkpoint.json')
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceDir=Join-Path $root (Join-Path $StateRoot "evidence-$stamp")

function ApiGet([string]$path){Invoke-RestMethod -Uri ($base+$path) -TimeoutSec 20}
function ApiPost([string]$path,[object]$body=$null,[int]$TimeoutSecValue=120){
  $p=@{Uri=($base+$path);Method='POST';ContentType='application/json';TimeoutSec=$TimeoutSecValue}
  if($null -ne $body){$p.Body=($body|ConvertTo-Json -Depth 30 -Compress)}
  Invoke-RestMethod @p
}
function ApiPut([string]$path,[object]$body){Invoke-RestMethod -Uri ($base+$path) -Method PUT -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 50 -Compress) -TimeoutSec 60}
function Get-ItemCount([object]$response){
  # Invoke-RestMethod hands a top-level JSON array out of a function as one Object[] instance, so
  # @(ApiGet ...) reports Count=1 for any non-empty payload. Enumerate through the pipeline first,
  # and return an integer: an array returned from a helper unrolls again at the call site.
  if($null -eq $response){return 0}
  return @($response|ForEach-Object {$_}).Count
}
function Save-Json([string]$path,[object]$value){
  $tmp="$path.tmp";$value|ConvertTo-Json -Depth 60|Set-Content -LiteralPath $tmp -Encoding utf8
  Move-Item -Force -LiteralPath $tmp -Destination $path
}
function Flatten([object]$node){
  $out=@{}
  if($node){foreach($e in $node.PSObject.Properties){$out[$e.Name]=$e.Value}}
  return $out
}
function Read-Ckpt{
  if(Test-Path $ckptPath){return Get-Content -LiteralPath $ckptPath -Raw|ConvertFrom-Json}
  return [pscustomobject]@{schemaVersion=1;branch=(git -C $root rev-parse --abbrev-ref HEAD);headSha=(git -C $root rev-parse HEAD);startedAt=(Get-Date).ToString('o');phases=[pscustomobject]@{}}
}
function Write-Ckpt([object]$ckpt){
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ckptPath)|Out-Null
  $ckpt.headSha=(git -C $root rev-parse HEAD)
  Save-Json $ckptPath $ckpt
}
function Set-Phase([object]$ckpt,[string]$name,[hashtable]$fields){
  $ph=Flatten $ckpt.phases
  $merged=Flatten $ph[$name]
  foreach($k in $fields.Keys){$merged[$k]=$fields[$k]}
  $ph[$name]=[pscustomobject]$merged
  $ckpt.phases=[pscustomobject]$ph
  Write-Ckpt $ckpt
  return $ckpt
}
function Test-PhasePassed([object]$ckpt,[string]$name){
  return [bool]($ckpt.phases.PSObject.Properties[$name]) -and ([string]$ckpt.phases.$name.status -eq 'PASS')
}

function Get-Sample{
  $health=ApiGet '/health'
  $gov=ApiGet '/api/v3/diagnostics/binance-governance'
  $pipeline=ApiGet '/api/v3/pipeline'
  $route=@($gov.routes|Where-Object {$_.environment -eq 'TESTNET'}|Select-Object -First 1)[0]
  if(-not $route){throw 'TESTNET_GOVERNANCE_ROUTE_MISSING'}
  $budget=$route.requestBudget
  $recon=$pipeline.reconciliation
  $tp=$pipeline.takeProfit
  $identity=(ApiGet '/api/v3/observability/entry').identity
  [ordered]@{
    at=[DateTimeOffset]::UtcNow.ToString('o')
    ready=[bool]$health.ready
    accountStatus=$health.checks.privateData.status
    wsState=$health.checks.marketStream.state
    reconciliation=if($recon.state){$recon.state}elseif($recon.lastError){'DEGRADED'}else{'SETTLED'}
    tradingMode=$pipeline.runtimeControl.mode
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
    riskBearingEntry=[int]$recon.activeRiskUnresolvedCount
    unresolvedDrift=[int]$recon.unresolvedDriftCount
    positionsApi=Get-ItemCount (ApiGet '/api/v3/positions')
    positionsProjection=[int]$pipeline.existingPositions.count
    orphanTp=[int]$tp.orphanTp
    duplicateTp=[int]$tp.duplicateTp
    tpQtyMismatch=[int]$tp.qtyMismatch
    tpWrongSide=[int]$tp.wrongSide
    tpUnverified=[int]$tp.unverifiedTp
    instanceId=$identity.instanceId
    enginePid=[int]$identity.pid
    engineRestartCount=[int]$identity.restartCount
  }
}
function Assert-TestnetOnly{
  $s=ApiGet '/api/v3/settings'
  if($s.connections.exchange.environment -ne 'TESTNET'){throw 'PRODUCTION_WRITE_FORBIDDEN: exchange environment is not TESTNET'}
  if('READ_ONLY','TESTNET_ENABLED' -notcontains $s.connections.executionMode){throw "UNSUPPORTED_EXECUTION_MODE: $($s.connections.executionMode)"}
  $sample=Get-Sample
  if($sample.restHost -ne 'demo-fapi.binance.com'){throw "REST_HOST_NOT_DEMO_FAPI: $($sample.restHost)"}
  if($sample.egressStatus -ne 'VERIFIED'){throw "EGRESS_NOT_VERIFIED: $($sample.egressStatus)"}
  if(-not $sample.ready){throw 'ENGINE_NOT_READY'}
  if($sample.accountStatus -ne 'READY'){throw "ACCOUNT_NOT_READY: $($sample.accountStatus)"}
  if($sample.wsState -ne 'LIVE'){throw "WS_NOT_LIVE: $($sample.wsState)"}
  if($sample.reconciliation -ne 'SETTLED'){throw "RECONCILIATION_NOT_SETTLED: $($sample.reconciliation)"}
  return $sample
}
function Get-PositionRows{@(ApiGet '/api/v3/positions'|ForEach-Object {$_})|ForEach-Object{[pscustomobject]@{id=$_.id;symbol=$_.symbol;side=$_.side;qty=$_.quantity;entry=$_.entryPrice;uPnL=$_.unrealizedPnl;tpStatus=$_.tpStatus;management=$_.managementStatus}}}

# ---------- phases ----------
function Invoke-StatusPhase([object]$ckpt){
  (Get-Sample|ConvertTo-Json -Depth 12)|Write-Host
  Write-Host ("head={0} cleanup={1} stage7={2} stage8={3} accept12h={4} accept24h={5}" -f (git -C $root rev-parse --short HEAD),
    $ckpt.phases.cleanup.status,$ckpt.phases.stage7.status,$ckpt.phases.stage8.status,$ckpt.phases.accept12h.status,$ckpt.phases.accept24h.status)
}

function Invoke-CleanupPhase([object]$ckpt){
  if(Test-PhasePassed $ckpt 'cleanup'){Write-Host 'CLEANUP_ALREADY_PASS_SKIPPING';return}
  if(-not $AuthorizeTestnetCleanup){throw 'CLEANUP_REQUIRES_-AuthorizeTestnetCleanup'}
  $sample=Assert-TestnetOnly
  New-Item -ItemType Directory -Force -Path $evidenceDir|Out-Null
  Set-Phase $ckpt 'cleanup' @{status='RUNNING';at=(Get-Date).ToString('o');evidenceDir=$evidenceDir}|Out-Null
  ApiPost '/api/v3/runtime/trading-control/pause' @{reason='V3.9.4 exposure cleanup; flat required before Stage7'}|Out-Null
  Save-Json (Join-Path $evidenceDir 'before.json') @{sample=$sample;positions=(Get-PositionRows)}
  $settings=ApiGet '/api/v3/settings'
  if($settings.connections.executionMode -ne 'TESTNET_ENABLED'){
    $candidate=$settings|ConvertTo-Json -Depth 50|ConvertFrom-Json
    $candidate.connections.executionMode='TESTNET_ENABLED'
    $saved=ApiPut '/api/v3/settings' $candidate
    if($saved.connections.executionMode -ne 'TESTNET_ENABLED'){throw 'CLEANUP_WRITE_MODE_DID_NOT_PERSIST'}
    ApiPost '/api/v3/runtime/trading-control/pause' @{reason='V3.9.4 exposure cleanup re-pause after mode release'}|Out-Null
  }
  Assert-TestnetOnly|Out-Null
  $preview=ApiGet '/api/v3/testnet/cleanup/preview'
  Save-Json (Join-Path $evidenceDir 'cleanup-preview.json') $preview
  Write-Host ("low-loss eligible=$(@($preview.eligible|ForEach-Object{$_.symbol})) excluded=$(@($preview.excluded|ForEach-Object{"$($_.symbol):$($_.reason)"}))")
  if((Get-ItemCount $preview.eligible) -gt 0){
    # The low-loss cleanup is a synchronous, multi-phase close that can outlast any HTTP timeout. A
    # client-side abort does not stop the engine, so a timeout is recorded and then polled for; it is
    # never read as "the close failed".
    try{ Save-Json (Join-Path $evidenceDir 'cleanup-run.json') (ApiPost '/api/v3/testnet/cleanup/run' @{confirm=$true} 1800) }
    catch{ Save-Json (Join-Path $evidenceDir 'cleanup-run-interrupted.json') @{message=$_.Exception.Message;note='engine keeps working; polling for flat instead of assuming failure'} }
  }
  # Anything still open sits outside the low-loss band and goes through the explicit human close chain,
  # which is reduce-only, re-reads exchange truth first, and replays on the same idempotency key.
  $closeKeys=Flatten $ckpt.phases.cleanup.closeKeys
  for($pass=1;$pass -le 4;$pass++){
    $positions=@(ApiGet '/api/v3/positions'|ForEach-Object {$_})
    if($positions.Count -eq 0){break}
    foreach($p in $positions){
      if(-not $closeKeys[$p.id]){$closeKeys[$p.id]="v394-cleanup-$($p.id)-$stamp"}
      Save-Json (Join-Path $evidenceDir "close-$($p.id)-pass$pass-request.json") @{id=$p.id;symbol=$p.symbol;side=$p.side;qty=$p.quantity;idempotencyKey=$closeKeys[$p.id]}
      try{
        $res=ApiPost "/api/v3/positions/$($p.id)/manual" @{action='EMERGENCY_CLOSE';confirm=$true;idempotencyKey=$closeKeys[$p.id];reason='V3.9.4 Stage7 pre-requisite Testnet exposure cleanup'} 600
        Save-Json (Join-Path $evidenceDir "close-$($p.id)-pass$pass-result.json") $res
      }catch{
        Save-Json (Join-Path $evidenceDir "close-$($p.id)-pass$pass-error.json") @{message=$_.Exception.Message;note='close may still be completing inside the engine; next pass re-reads exchange truth'}
      }
    }
    Set-Phase $ckpt 'cleanup' @{closeKeys=$closeKeys;lastPass=$pass}|Out-Null
    # Poll rather than sleep: the durable position task, not this loop, owns the close.
    $settle=Get-Date
    while(((Get-Date)-$settle).TotalSeconds -lt 180){
      if((Get-ItemCount (ApiGet '/api/v3/positions')) -eq 0){break}
      Start-Sleep -Seconds 10
    }
  }
  $final=Get-Sample
  Save-Json (Join-Path $evidenceDir 'after.json') @{sample=$final;positions=(Get-PositionRows)}
  if($final.positionsApi -gt 0){throw "CLEANUP_INCOMPLETE: positions=$($final.positionsApi) evidence=$evidenceDir"}
  if($final.riskBearingEntry -gt 0){throw "CLEANUP_INCOMPLETE: riskBearingEntry=$($final.riskBearingEntry) evidence=$evidenceDir"}
  if($final.unresolvedDrift -gt 0){throw "CLEANUP_INCOMPLETE: unresolvedDrift=$($final.unresolvedDrift) evidence=$evidenceDir"}
  if($final.orphanTp -gt 0 -or $final.duplicateTp -gt 0 -or $final.tpWrongSide -gt 0){throw "CLEANUP_INCOMPLETE: tpIntegrity orphan=$($final.orphanTp) dup=$($final.duplicateTp) wrongSide=$($final.tpWrongSide)"}
  # Hand Stage7 a READ_ONLY engine again, because its own arming gate requires that pre-condition.
  $back=(ApiGet '/api/v3/settings')|ConvertTo-Json -Depth 50|ConvertFrom-Json
  $back.connections.executionMode='READ_ONLY'
  ApiPut '/api/v3/settings' $back|Out-Null
  Set-Phase $ckpt 'cleanup' @{status='PASS';passedAt=(Get-Date).ToString('o');closeKeys=$closeKeys}|Out-Null
  Write-Host 'EXPOSURE_CLEANUP_PASS=TRUE'
}

function Ensure-ReadOnlyArmingState{
  # A previous interrupted attempt can leave the engine in TESTNET_ENABLED, which Stage7's own arming
  # gate refuses. Restore the state its gate expects instead of bypassing the gate.
  $s=ApiGet '/api/v3/settings'
  if($s.connections.executionMode -eq 'READ_ONLY'){return}
  $candidate=$s|ConvertTo-Json -Depth 50|ConvertFrom-Json
  $candidate.connections.executionMode='READ_ONLY'
  ApiPut '/api/v3/settings' $candidate|Out-Null
  ApiPost '/api/v3/runtime/trading-control/pause' @{reason='V3.9.4 restoring READ_ONLY arming state for Stage7'}|Out-Null
  $check=ApiGet '/api/v3/settings'
  if($check.connections.executionMode -ne 'READ_ONLY'){throw 'ARMING_STATE_RESTORE_FAILED'}
}
function Invoke-StagePhase([string]$Name,[object]$ckpt){
  if(Test-PhasePassed $ckpt $Name){Write-Host "$($Name.ToUpper())_ALREADY_PASS_SKIPPING";return}
  $auth=if($Name -eq 'Stage7'){$AuthorizeStage7Write}else{$AuthorizeStage8AutoTrading}
  $flag=if($Name -eq 'Stage7'){'AuthorizeTestnetWrite'}else{'AuthorizeStage8AutoTrading'}
  if(-not $auth){throw "$($Name.ToUpper())_REQUIRES_-$flag"}
  New-Item -ItemType Directory -Force -Path $evidenceDir|Out-Null
  if($Name -eq 'Stage7'){Ensure-ReadOnlyArmingState}
  $log=Join-Path $evidenceDir "$Name.log"
  $errLog=Join-Path $evidenceDir "$Name.err.log"
  Set-Phase $ckpt $Name @{status='RUNNING';at=(Get-Date).ToString('o');evidenceDir=$evidenceDir}|Out-Null
  $childArgs=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'run-v394-local-rollout.ps1'),'-Phase',$Name,'-Port',[string]$Port,'-CanaryMarginUsd',[string]$CanaryMarginUsd,"-$flag")
  # This stage spawns a long-lived Engine. Piping the child through this process would hand that
  # Engine the pipe write handle and the parent would never see EOF; -Wait additionally drains the
  # redirected streams, which the Engine also holds open. Wait on the process handle only.
  $proc=Start-Process -FilePath 'powershell' -ArgumentList $childArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError $errLog
  $proc.WaitForExit()
  $code=$proc.ExitCode
  if($null -eq $code){throw "$($Name.ToUpper())_EXIT_CODE_UNOBSERVED evidence=$evidenceDir"}
  if($code -eq 3){
    # The rollout exits 3 when no natural AI entry appeared in its window. That is an observation to
    # investigate (pool, eligibility, AI invocation, gates, cooldown), not a PASS and not a defect.
    Set-Phase $ckpt $Name @{status='PENDING_NO_NATURAL_ENTRY';pendingAt=(Get-Date).ToString('o');log=$log;exitCode=3}|Out-Null
    throw "$($Name.ToUpper())_PENDING_NO_NATURAL_ENTRY evidence=$evidenceDir"
  }
  if($code -ne 0){throw "$($Name.ToUpper())_FAILED_EXIT_$code evidence=$evidenceDir stdout=$log stderr=$errLog"}
  Set-Phase $ckpt $Name @{status='PASS';passedAt=(Get-Date).ToString('o');log=$log}|Out-Null
}

function Invoke-AcceptancePhase([string]$Name,[int]$Minutes,[object]$ckpt){
  if(Test-PhasePassed $ckpt $Name){Write-Host "$($Name.ToUpper())_ALREADY_PASS_SKIPPING";return}
  New-Item -ItemType Directory -Force -Path $evidenceDir|Out-Null
  $samplesFile=Join-Path $evidenceDir "samples-$Name.jsonl"
  $start=Assert-TestnetOnly
  if($start.tradingMode -ne 'RUNNING'){throw "ACCEPTANCE_REQUIRES_RUNNING_TRADE_CONTROL: $($start.tradingMode)"}
  $baseline429=[int]$start.http429
  $baseline418=[int]$start.http418
  $expected=$start.expectedEgressIp
  $routeId=$start.routeIdentity
  $begin=Get-Date
  $breaks=0
  $rows=@()
  $prev=$null
  Set-Phase $ckpt $Name @{status='RUNNING';at=(Get-Date).ToString('o');evidenceDir=$evidenceDir;windowStart=$begin.ToString('o');requiredMinutes=$Minutes;samples=0;breaks=0}|Out-Null
  while(((Get-Date)-$begin).TotalMinutes -lt $Minutes){
    $s=Get-Sample
    if($prev){
      $gap=(([DateTime]$s.at)-([DateTime]$prev.at)).TotalSeconds
      # Continuity is measured, never assumed: a sampling gap or an engine restart ends the window,
      # so an interrupted run reports a broken window instead of quietly claiming a PASS.
      if($gap -gt ($SampleIntervalSeconds*3+30) -or $s.instanceId -ne $prev.instanceId){
        $breaks++
        Save-Json (Join-Path $evidenceDir "continuity-break-$(Get-Date -Format 'HHmmss').json") @{previous=$prev;current=$s;gapSeconds=$gap}
      }
    }
    if([int]$s.positionsApi -ne [int]$s.positionsProjection){
      $breaks++
      Save-Json (Join-Path $evidenceDir "position-count-divergence-$(Get-Date -Format 'HHmmss').json") $s
    }
    $prev=$s
    $rows+=$s
    ($s|ConvertTo-Json -Depth 12 -Compress)|Add-Content -LiteralPath $samplesFile -Encoding utf8
    Set-Phase $ckpt $Name @{status='RUNNING';samples=$rows.Count;breaks=$breaks;elapsedMinutes=[Math]::Round(((Get-Date)-$begin).TotalMinutes,2)}|Out-Null
    Start-Sleep -Seconds $SampleIntervalSeconds
  }
  $last=$rows[-1]
  # Hard gates must hold at literally every sample: routing, egress and readiness have no legitimate
  # transient state. Exposure integrity does - a fill waiting for the next 5 minute reconciliation
  # scan, or a TP being re-armed after a partial, briefly reads non-zero. Judging those as failures
  # would be a flaky gate, so they must instead never persist: a metric that stays non-zero for more
  # samples than a full reconciliation interval is a real defect, and the final sample must be clean.
  $sustainLimit=[Math]::Max(3,[Math]::Ceiling(360/$SampleIntervalSeconds)+2)
  function Get-MaxRun([object[]]$collection,[scriptblock]$predicate){
    $max=0;$current=0
    foreach($row in $collection){if(& $predicate $row){$current++;if($current -gt $max){$max=$current}}else{$current=0}}
    return $max
  }
  $riskRun=Get-MaxRun $rows{param($r)$r.riskBearingEntry -gt 0 -or $r.unresolvedDrift -gt 0}
  $tpRun=Get-MaxRun $rows{param($r)$r.orphanTp -gt 0 -or $r.duplicateTp -gt 0 -or $r.tpQtyMismatch -gt 0 -or $r.tpWrongSide -gt 0}
  $unverifiedRun=Get-MaxRun $rows{param($r)$r.tpUnverified -gt 0}
  $summary=[ordered]@{
    phase=$Name;requiredMinutes=$Minutes;actualMinutes=[Math]::Round(((Get-Date)-$begin).TotalMinutes,2);samples=$rows.Count
    continuityBreaks=$breaks
    http429Start=$baseline429;http429End=[int]$last.http429;http429Delta=([int]$last.http429-$baseline429)
    http418Start=$baseline418;http418End=[int]$last.http418;http418Delta=([int]$last.http418-$baseline418)
    restHostViolations=@($rows|Where-Object {$_.restHost -ne 'demo-fapi.binance.com'}).Count
    egressViolations=@($rows|Where-Object {$_.egressStatus -ne 'VERIFIED' -or $_.verifiedEgressIp -ne $expected}).Count
    routeIdentityViolations=@($rows|Where-Object {$_.routeIdentity -ne $routeId}).Count
    readinessViolations=@($rows|Where-Object {-not $_.ready -or $_.accountStatus -ne 'READY' -or $_.wsState -ne 'LIVE' -or $_.reconciliation -ne 'SETTLED'}).Count
    maxConsecutiveRiskSamples=$riskRun;maxConsecutiveTpIntegritySamples=$tpRun;maxConsecutiveUnverifiedTpSamples=$unverifiedRun
    sustainedViolationLimit=$sustainLimit
    riskViolations=if($riskRun -gt $sustainLimit -or [int]$last.riskBearingEntry -gt 0 -or [int]$last.unresolvedDrift -gt 0){1}else{0}
    tpIntegrityViolations=if($tpRun -gt $sustainLimit -or [int]$last.orphanTp -gt 0 -or [int]$last.duplicateTp -gt 0 -or [int]$last.tpWrongSide -gt 0 -or [int]$last.tpQtyMismatch -gt 0){1}else{0}
    falseCounterDiscontinuity=@(foreach($row in $rows){foreach($lim in @($row.rateLimits)){if($lim.counterDiscontinuity -eq $true -and $lim.windowReset -ne $true){1}}}).Count
    finalPositions=[int]$last.positionsApi;finalUnverifiedTp=[int]$last.tpUnverified;evidenceDir=$evidenceDir
  }
  Save-Json (Join-Path $evidenceDir "summary-$Name.json") $summary
  $violations=@($summary.continuityBreaks,$summary.restHostViolations,$summary.egressViolations,$summary.routeIdentityViolations,$summary.readinessViolations,$summary.riskViolations,$summary.tpIntegrityViolations,$summary.falseCounterDiscontinuity,$summary.http429Delta,$summary.http418Delta|Where-Object {[int]$_ -gt 0})
  if($summary.actualMinutes -lt $Minutes){throw "ACCEPTANCE_WINDOW_SHORT: $Name measured=$($summary.actualMinutes) required=$Minutes evidence=$evidenceDir"}
  if($violations.Count -gt 0){throw "ACCEPTANCE_FAILED: $Name violationCounts=[$($violations -join ',')] evidence=$evidenceDir"}
  Set-Phase $ckpt $Name @{status='PASS';passedAt=(Get-Date).ToString('o');summary=($summary|ConvertTo-Json -Depth 6|ConvertFrom-Json)}|Out-Null
  Write-Host "$($Name.ToUpper())_PASS=TRUE minutes=$($summary.actualMinutes)"
}

$ckpt=Read-Ckpt
switch($Phase){
  'Status'{Invoke-StatusPhase $ckpt}
  'Cleanup'{Invoke-CleanupPhase $ckpt}
  'Stage7'{Invoke-CleanupPhase (Read-Ckpt);Invoke-StagePhase 'Stage7' (Read-Ckpt)}
  'Stage8'{Invoke-CleanupPhase (Read-Ckpt);Invoke-StagePhase 'Stage7' (Read-Ckpt);Invoke-StagePhase 'Stage8' (Read-Ckpt)}
  'Accept12H'{Invoke-AcceptancePhase 'accept12h' 720 $ckpt}
  'Accept24H'{Invoke-AcceptancePhase 'accept24h' 1440 $ckpt}
  'All'{
    Invoke-CleanupPhase (Read-Ckpt)
    Invoke-StagePhase 'Stage7' (Read-Ckpt)
    Invoke-StagePhase 'Stage8' (Read-Ckpt)
    Invoke-AcceptancePhase 'accept12h' 720 (Read-Ckpt)
    Invoke-AcceptancePhase 'accept24h' 1440 (Read-Ckpt)
    Write-Host 'V394_STAGE7_TO_STAGE9_COMPLETE=TRUE'
  }
}
