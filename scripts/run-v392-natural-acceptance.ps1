[CmdletBinding()]
param([int]$DurationMinutes = 120, [int]$IntervalSeconds = 60)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dir = Join-Path $root "data\reports\v392-natural-acceptance-$stamp"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$samplesPath = Join-Path $dir 'samples.jsonl'
$summaryPath = Join-Path $dir 'summary.json'
$deadline = (Get-Date).AddMinutes($DurationMinutes)
$samples = [System.Collections.Generic.List[object]]::new()
$formalStarted = $null
$stableSince = $null
function Get-Json([string]$path) {
  try { return Invoke-RestMethod -Uri ("http://127.0.0.1:8080" + $path) -TimeoutSec 15 }
  catch { return $null }
}
while ((Get-Date) -lt $deadline) {
  $health = Get-Json '/health'
  $closeout = Get-Json '/api/v3/diagnostics/closeout'
  $obs = Get-Json '/api/v3/observability/entry'
  $timestamp = [DateTimeOffset]::UtcNow.ToString('o')
  $pipe = if ($closeout -and $closeout.pipeline) { $closeout.pipeline } else { $null }
  $stable = $health -and $health.ready -and $health.status -eq 'READY' -and $health.checks.privateData.status -eq 'READY' -and $health.checks.marketStream.state -eq 'LIVE' -and $pipe -and $pipe.takeProfit.status -eq 'READY' -and [double]$pipe.reconciliation.lastRun -gt 0 -and [int]$pipe.reconciliation.driftCount -eq 0 -and [int]$pipe.reconciliation.unresolvedDriftCount -eq 0
  if (-not $formalStarted) {
    if (-not $stable) { $stableSince=$null }
    elseif (-not $stableSince) { $stableSince=Get-Date }
    elseif (((Get-Date)-$stableSince).TotalSeconds -ge 60) { $formalStarted=Get-Date; $deadline=$formalStarted.AddMinutes($DurationMinutes) }
  }
  $frames = @{}
  foreach ($tf in @('1m','5m','15m')) { $frames[$tf] = [pscustomobject]@{ total=0; fresh=0; closed=0; gap=0; blocked=0 } }
  $quoteFresh = 0; $bookFresh = 0; $hotTotal = 0; $gapReasons = @{}; $symbolTrace = @{}
  if ($closeout -and $closeout.hot) {
    foreach ($row in @($closeout.hot)) {
      $symbol = [string]$row.symbol
      if (-not $symbol) { $symbol = [string]$row.s }
      if ($symbol) { $symbolTrace[$symbol] = [ordered]@{ quoteAgeMs=$row.quoteAgeMs; bookAgeMs=$row.bookAgeMs; frames=[ordered]@{}; reasons=@($row.reasons) } }
      $hotTotal++
      if ($row.quoteAgeMs -ne $null -and [double]$row.quoteAgeMs -le 15000) { $quoteFresh++ }
      if ($row.bookAgeMs -ne $null -and [double]$row.bookAgeMs -le 15000) { $bookFresh++ }
      foreach ($tf in @('1m','5m','15m')) {
        $f = $row.frames.$tf
        if ($symbol -and $f) { $symbolTrace[$symbol].frames[$tf] = [ordered]@{ isClosed=$f.isClosed; followingBoundary=$f.followingBoundary; gapCount=[int]$f.gapCount; expectedClose=$f.expectedClose; actualClose=$f.actualClose; receivedAt=$f.receivedAt } }
        if (-not $f) { continue }
        $frames[$tf].total++
        if ($f.followingBoundary -eq $true -and $f.isClosed -eq $true -and [int]$f.gapCount -eq 0) { $frames[$tf].fresh++; $frames[$tf].closed++ }
        elseif ($f.isClosed -eq $true) { $frames[$tf].closed++ }
        if ([int]$f.gapCount -gt 0) { $frames[$tf].gap += [int]$f.gapCount }
      }
      foreach ($reason in @($row.reasons)) {
        if ($reason -match '^TECHNICAL_') { $prior = if ($gapReasons.ContainsKey($reason)) { [int]$gapReasons[$reason] } else { 0 }; $gapReasons[$reason] = 1 + $prior }
      }
    }
  }
  $counts = if ($obs) { $obs.counts } else { $null }
  $chain = [pscustomobject]@{ runs=0; intents=0; orders=0; firstFills=0; completeFills=0; externalOrUnknown=0 }
  if ($obs -and $obs.chains) {
    $chain.runs = @($obs.chains).Count
    foreach ($c in @($obs.chains)) {
      if ($c.intentAt) { $chain.intents++ }
      $chain.orders += @($c.exchangeOrderIds).Count
      if ($c.firstFillAt) { $chain.firstFills++ }
      if ($c.completeFillAt) { $chain.completeFills++ }
      if ([string]$c.linkStatus -match 'UNKNOWN|EXTERNAL') { $chain.externalOrUnknown++ }
    }
  }
  $sample = [ordered]@{
    timestamp=$timestamp; phase=if($formalStarted){if($stable){'FORMAL'}else{'DEGRADED'}}else{'PRE_READY'}; health=if($health){$health.status}else{'UNKNOWN'}; ready=if($health){$health.ready}else{$false}; symbols=$symbolTrace
    marketStream=if($health){$health.checks.marketStream.state}else{'UNKNOWN'}; hotTotal=$hotTotal
    quoteFreshRate=if($hotTotal){$quoteFresh/$hotTotal}else{$null}; bookFreshRate=if($hotTotal){$bookFresh/$hotTotal}else{$null}
    frames=$frames; technicalReasons=$gapReasons; decisions=$counts; completed=if($obs){$obs.completed}else{$null}; running=if($obs){$obs.running}else{$null}; chain=$chain
    runtime=$closeout.runtime; private=$pipe.binancePrivate; reconciliation=$pipe.reconciliation; takeProfit=$pipe.takeProfit; ws=$health.checks.marketStream; entryObservation=$obs; rest=(Get-Json '/api/v3/pipeline').restBudget
  }
  $samples.Add([pscustomobject]$sample)
  ($sample | ConvertTo-Json -Depth 12 -Compress) | Add-Content -LiteralPath $samplesPath -Encoding utf8
  Start-Sleep -Seconds ([Math]::Max(30, $IntervalSeconds))
}
function Rate([object[]]$rows, [string]$property) {
  $v=@($rows | ForEach-Object { $_.$property } | Where-Object { $_ -ne $null }); if(!$v.Count){return $null}; return (($v | Measure-Object -Average).Average)
}
$rows=@($samples | Where-Object {$_.phase -ne 'PRE_READY'})
$denominator=($rows|Measure-Object -Property hotTotal -Sum).Sum
$freshness=@{}
foreach($tf in @('1m','5m','15m')) { $fresh=($rows|ForEach-Object {$_.frames.$tf.fresh}|Measure-Object -Sum).Sum; $freshness[$tf]=if($denominator){$fresh/$denominator}else{$null} }
$summary=[ordered]@{
  schemaVersion='V3.9.2-NATURAL-ACCEPTANCE-2'; startedAt=$stamp; formalStartedAt=if($formalStarted){$formalStarted.ToString('o')}else{$null}; completedAt=(Get-Date).ToString('o'); durationMinutes=$DurationMinutes; intervalSeconds=$IntervalSeconds; sampleCount=$rows.Count; preReadySamples=@($samples|Where-Object {$_.phase -eq 'PRE_READY'}).Count
  healthReadyRate=if($rows.Count){(@($rows|Where-Object {$_.ready}).Count/$rows.Count)}else{0}; wsLiveRate=if($rows.Count){(@($rows|Where-Object {$_.marketStream -eq 'LIVE'}).Count/$rows.Count)}else{0}
  quoteFreshRate=Rate $rows 'quoteFreshRate'; bookFreshRate=Rate $rows 'bookFreshRate'
  timeframeFreshness=$freshness; hotSymbolSampleDenominator=$denominator; degradedSamples=@($rows|Where-Object {$_.phase -eq 'DEGRADED'}).Count
  gapSamples=@($rows|Where-Object {$_.technicalReasons.PSObject.Properties.Count -gt 0}).Count
  decisionLatest=if($rows.Count){$rows[-1].decisions}else{$null}; completedLatest=if($rows.Count){$rows[-1].completed}else{$null}; runningLatest=if($rows.Count){$rows[-1].running}else{$null}
  chainLatest=if($rows.Count){$rows[-1].chain}else{$null}; evidence='read-only; missing facts remain UNKNOWN; no trade or runtime control performed'
}
$summary | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $summaryPath -Encoding utf8
& node (Join-Path $root 'scripts/summarize-v392-trajectories.mjs') $dir
Write-Output ("EVIDENCE_DIR=" + $dir)
Write-Output ($summary | ConvertTo-Json -Depth 15)
