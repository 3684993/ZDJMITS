param([double]$DurationMinutes=60,[int]$Port=18092,[string]$DataDir='data',[int]$SampleSeconds=15)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$data=(Resolve-Path (Join-Path $root $DataDir)).Path
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$dir=Join-Path $root "data\acceptance-60m\$stamp"
New-Item -Force -ItemType Directory $dir|Out-Null
$samples="$dir\samples.jsonl";$out="$dir\engine.out.log";$err="$dir\engine.err.log";$base="http://127.0.0.1:$Port"
$old=@{port=$env:ZDJ_PORT;host=$env:ZDJ_HOST;data=$env:ZDJ_DATA_DIR}
$env:ZDJ_PORT=$Port;$env:ZDJ_HOST='127.0.0.1';$env:ZDJ_DATA_DIR=$data
function Api($path){Invoke-RestMethod "$base$path" -TimeoutSec 8}
function Num($value){if($null-eq$value){$null}else{try{[double]$value}catch{$null}}}
function Percentile($values,$quantile){$ordered=@($values|Where-Object{$null-ne$_}|Sort-Object);if(!$ordered){$null}else{$ordered[[math]::Floor(($ordered.Count-1)*$quantile)]}}
function Market($health){
  $detail=(@($health|Where-Object id -eq 'market')[0]).detail;$stream=$null
  if($detail-is[string]){$match=[regex]::Match($detail,'stream=(\{[\s\S]*\})\s*$');if($match.Success){try{$stream=$match.Groups[1].Value|ConvertFrom-Json}catch{}}}
  elseif($detail){$stream=$detail.stream;if(!$stream){$stream=$detail}}
  $result=[ordered]@{available=($null-ne$stream);fresh=$null;total=$null;quoteFresh=$null;orderbookFresh=$null;klineFresh=$null;quoteFreshRatio=$null;klineFreshRatio=$null;poolBookFreshRatio=$null;gaps=$null;gapsByType=$null;backfills=$null;reconnects=$null;recoverySuccess=$null;recoveryFailure=$null}
  if($stream){foreach($key in @('fresh','total','quoteFresh','orderbookFresh','klineFresh','quoteFreshRatio','klineFreshRatio','poolBookFreshRatio','gaps','backfills','reconnects','recoverySuccess','recoveryFailure')){$result[$key]=Num $stream.$key};$result.gapsByType=$stream.gapsByType}
  [pscustomobject]$result
}
$proc=$null;$finalExitCode=$null;$fatal=$false
try{
  $probe=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$Port)
  try{$probe.Start()}catch{throw "Acceptance port $Port is already in use"}finally{$probe.Stop()}
  $proc=Start-Process node -ArgumentList @('apps/engine/dist/main.js') -WorkingDirectory $root -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
  $stable=0;$until=(Get-Date).AddMinutes(8)
  while((Get-Date)-lt$until-and$stable-lt3){
    try{$health=Api '/health';$snapshot=Api '/api/v3/snapshot';$market=Market $snapshot.health;if([int]$health.pid-eq$proc.Id-and$health.ready-and$snapshot.universe.total-gt0-and$market.available-and$market.quoteFreshRatio-ge.8-and$market.klineFreshRatio-ge.8){$stable++}else{$stable=0}}catch{$stable=0}
    Start-Sleep 5
  }
  if($stable-lt3){throw 'Market did not reach stable READY state'}
  $stableAt=Get-Date;$stableAtMs=([DateTimeOffset]$stableAt).ToUnixTimeMilliseconds();$end=$stableAt.AddMinutes($DurationMinutes)
  while((Get-Date)-lt$end){
    try{
      $health=Api '/health';if([int]$health.pid-ne$proc.Id){throw "Acceptance engine PID mismatch: expected $($proc.Id), got $($health.pid)"}
      $snapshot=Api '/api/v3/snapshot'
      $orders=@($snapshot.entryOrders|Select-Object id,symbol,exchangeOrderId,createdAt,status)
      $runs=@((Api '/api/v3/brain/runs?limit=100').items|Select-Object id,role,symbol,status,direction,rawDecision,decision,parserRepaired,latencyMs,startedAt,completedAt)
      $row=[ordered]@{ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();ready=$true;market=Market $snapshot.health;universe=$snapshot.universe.total;eligible=$snapshot.universe.eligible;poolActive=@($snapshot.pool).Count;entryOrders=$orders;positions=@($snapshot.positions|Select-Object id,symbol,tpStatus,tpCoverageSource,managementStatus);aiResources=$snapshot.aiResources;pipeline=Api '/api/v3/pipeline';runs=$runs}
      [IO.File]::AppendAllText($samples,(($row|ConvertTo-Json -Depth 8 -Compress)+[Environment]::NewLine))
    }catch{$failure=[ordered]@{ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();ready=$false;error=$_.Exception.Message};[IO.File]::AppendAllText($samples,(($failure|ConvertTo-Json -Compress)+[Environment]::NewLine))}
    Start-Sleep $SampleSeconds
  }
  $finalSnapshot=Api '/api/v3/snapshot';$audit=Api "/api/v3/audit/entry-chain?since=$stableAtMs";$allOrders=Api '/api/v3/orders'
  if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force};$finalExitCode=0
  $fatal=[bool](Select-String $err -Pattern 'TypeError:|Unhandled|FATAL' -Quiet)
  $rows=@([IO.File]::ReadAllLines($samples,[Text.Encoding]::UTF8)|ForEach-Object{$_|ConvertFrom-Json});$ok=@($rows|Where-Object ready)
  # A run/order can first be sampled while RUNNING/WORKING. Keep the latest
  # projection for each id so the final summary reflects its terminal state.
  $runs=@($ok|ForEach-Object{$_.runs}|Where-Object{[double]$_.startedAt-ge$stableAtMs}|Group-Object id|ForEach-Object{$_.Group[-1]})
  $orders=@($ok|ForEach-Object{$_.entryOrders}|Where-Object{[double]$_.createdAt-ge$stableAtMs}|Group-Object id|ForEach-Object{$_.Group[-1]})
  $scout=@($runs|Where-Object role -eq 'SCOUT');$primary=@($runs|Where-Object role -eq 'PRIMARY_BRAIN');$done=@($primary|Where-Object status -eq 'COMPLETED');$rejected=@($done|Where-Object decision -eq 'REJECT_CANDIDATE')
  $noEntryReasons=@{};foreach($row in $ok){$key=[string]$row.pipeline.noEntryReason;if($key){if(!$noEntryReasons.ContainsKey($key)){$noEntryReasons[$key]=0};$noEntryReasons[$key]++}}
  $last=if($ok){$ok[-1]}else{$null}
  function MaxMetric($name){$values=@($ok|ForEach-Object{$_.market.$name}|Where-Object{$null-ne$_});if($values){($values|Measure-Object -Maximum).Maximum}else{$null}}
  function MinMetric($name){$values=@($ok|ForEach-Object{$_.market.$name}|Where-Object{$null-ne$_});if($values){($values|Measure-Object -Minimum).Minimum}else{$null}}
  function AverageMetric($name){$values=@($ok|ForEach-Object{$_.market.$name}|Where-Object{$null-ne$_});if($values){($values|Measure-Object -Average).Average}else{$null}}
  function MaxField($name){$values=@($ok|ForEach-Object{$_.$name}|Where-Object{$null-ne$_});if($values){($values|Measure-Object -Maximum).Maximum}else{$null}}
  function MinField($name){$values=@($ok|ForEach-Object{$_.$name}|Where-Object{$null-ne$_});if($values){($values|Measure-Object -Minimum).Minimum}else{$null}}
  function MaxConsecutiveField($name,$expected){$max=0;$current=0;foreach($row in $ok){if([double]$row.$name-eq[double]$expected){$current++;if($current-gt$max){$max=$current}}else{$current=0}};return $max}
  function MaxConsecutiveMarketBelow($name,$threshold){$max=0;$current=0;foreach($row in $ok){if($null-ne$row.market.$name-and[double]$row.market.$name-lt[double]$threshold){$current++;if($current-gt$max){$max=$current}}else{$current=0}};return $max}
  $recovering=@($ok|Where-Object{$_.pipeline.noEntryReason-eq'MARKET_RECOVERING'}).Count
  $lowQuote=@($ok|Where-Object{$null-ne$_.market.quoteFreshRatio-and[double]$_.market.quoteFreshRatio-lt.8}).Count
  $lowPoolBook=@($ok|Where-Object{$null-ne$_.market.poolBookFreshRatio-and[double]$_.market.poolBookFreshRatio-lt.8}).Count
  $poolEmpty=@($ok|Where-Object{[double]$_.poolActive-eq0}).Count
  $primaryOrdered=@($primary|Sort-Object startedAt);$overlaps=0;for($i=1;$i-lt$primaryOrdered.Count;$i++){if([double]$primaryOrdered[$i].startedAt-lt[double]$primaryOrdered[$i-1].completedAt){$overlaps++}}
  $auditItems=@($audit.items);$failedRunIds=@($auditItems|Where-Object type -eq 'AI_FAILED_NO_INTENT'|ForEach-Object{$_.payload.runId}|Where-Object{$_});$rejectRunIds=@($auditItems|Where-Object type -eq 'CANDIDATE_REJECTED'|ForEach-Object{$_.payload.brainRunId}|Where-Object{$_});$intentRunIds=@($auditItems|Where-Object type -eq 'ENTRY_INTENT_CREATED'|ForEach-Object{$_.payload.intent.brainRunId}|Where-Object{$_});$falseMappings=@($intentRunIds|Where-Object{($failedRunIds -contains $_) -or ($rejectRunIds -contains $_)}).Count
  $badTp=@($finalSnapshot.positions|Where-Object tpStatus -ne 'PROTECTED');$terminalInActive=@($finalSnapshot.entryOrders|Where-Object status -in @('CANCELED','FILLED','EXPIRED','REJECTED')).Count
  $summary=[ordered]@{
    startedWhenStable=$stableAt.ToString('o');completedAt=(Get-Date).ToString('o');requestedMinutes=$DurationMinutes
    market=@{sampleSuccessRatio=if($rows.Count){$ok.Count/$rows.Count}else{$null};quoteFreshRatioMin=MinMetric quoteFreshRatio;quoteFreshRatioAvg=AverageMetric quoteFreshRatio;klineFreshRatioMin=MinMetric klineFreshRatio;klineFreshRatioAvg=AverageMetric klineFreshRatio;poolBookFreshRatioMin=MinMetric poolBookFreshRatio;poolBookFreshRatioAvg=AverageMetric poolBookFreshRatio;lowQuoteFreshSamples=$lowQuote;lowPoolBookFreshSamples=$lowPoolBook;maxConsecutiveLowQuoteFresh=MaxConsecutiveMarketBelow quoteFreshRatio .8;maxConsecutiveLowPoolBookFresh=MaxConsecutiveMarketBelow poolBookFreshRatio .8;gaps=MaxMetric gaps;gapsByType=$last.market.gapsByType;backfills=MaxMetric backfills;reconnects=MaxMetric reconnects;recoverySuccess=MaxMetric recoverySuccess;recoveryFailure=MaxMetric recoveryFailure;marketRecoveringSampleRatio=if($ok.Count){$recovering/$ok.Count}else{1}}
    pipeline=@{universe=$last.universe;eligibleAtEnd=$last.eligible;poolTarget=$last.pipeline.pool.target;poolActiveAtEnd=$last.poolActive;minPoolActive=MinField poolActive;maxConsecutivePoolEmpty=MaxConsecutiveField poolActive 0;poolEmptySamples=$poolEmpty;maxEligible=MaxField eligible;maxPoolActive=MaxField poolActive;entryBlockedSamples=@($ok|Where-Object{$_.pipeline.noEntryReason-eq'ENTRY_BLOCKED'}).Count;privateNotReadySamples=@($ok|Where-Object{$_.pipeline.binancePrivate.status-ne'READY'}).Count;candidateTurnover=@($primary.symbol|Sort-Object -Unique).Count;uniqueSymbolsAnalyzed=@($runs.symbol|Sort-Object -Unique).Count}
    ai=@{scoutCompleted=@($scout|Where-Object status -eq 'COMPLETED').Count;scoutFailed=@($scout|Where-Object status -eq 'FAILED').Count;primaryCompleted=$done.Count;primaryFailed=@($primary|Where-Object status -eq 'FAILED').Count;scoutLatencyP50=Percentile @($scout|ForEach-Object{$_.latencyMs}) .5;scoutLatencyP95=Percentile @($scout|ForEach-Object{$_.latencyMs}) .95;primaryLatencyP50=Percentile @($primary|ForEach-Object{$_.latencyMs}) .5;primaryLatencyP95=Percentile @($primary|ForEach-Object{$_.latencyMs}) .95;PLACE_LONG=@($done|Where-Object decision -eq 'PLACE_LONG').Count;PLACE_SHORT=@($done|Where-Object decision -eq 'PLACE_SHORT').Count;REJECT_CANDIDATE=$rejected.Count;repeatRejectRate=if($rejected.Count){1-(@($rejected.symbol|Sort-Object -Unique).Count/$rejected.Count)}else{$null}}
    entry=@{placed=$orders.Count;binanceOrderIds=@($orders.exchangeOrderId|Where-Object{$_})}
    safety=@{falseRejectOrFailedToIntent=$falseMappings;primaryOverlaps=$overlaps;terminalOrdersInActiveProjection=$terminalInActive;historicalEntryOrders=@($allOrders.entry).Count;activeEntryOrders=@($finalSnapshot.entryOrders).Count}
    positions=@{total=@($finalSnapshot.positions).Count;protected=@($finalSnapshot.positions|Where-Object tpStatus -eq 'PROTECTED').Count;badTp=@($badTp|Select-Object id,symbol,tpStatus,tpCoverageSource);humanManaged=@($finalSnapshot.positions|Where-Object managementStatus -eq 'HUMAN_MANAGED').Count}
    runtime=@{NO_ENTRY_REASON=$noEntryReasons;finalExitCode=$finalExitCode;fatalDetected=$fatal;sampleCount=$rows.Count;failedSamples=$rows.Count-$ok.Count}
    evidenceDir=$dir
  }
  $allowedFailures=[math]::Max(1,[math]::Floor($rows.Count*.05))
  # A short, recovered market interruption is acceptable for the final candidate.
  # Evaluate duration/ratio of the degradation instead of rejecting the whole run
  # because of one transient sample with a zero global minimum.
  $summary.pass=($ok.Count-gt0-and$summary.runtime.failedSamples-le$allowedFailures-and!$fatal-and$summary.market.quoteFreshRatioAvg-ge.8-and$summary.market.klineFreshRatioMin-ge.8-and$summary.market.poolBookFreshRatioAvg-ge.8-and$summary.market.lowQuoteFreshSamples-le[math]::Max(1,[math]::Floor($ok.Count*.05))-and$summary.market.lowPoolBookFreshSamples-le[math]::Max(1,[math]::Floor($ok.Count*.05))-and$summary.market.maxConsecutiveLowQuoteFresh-le5-and$summary.market.maxConsecutiveLowPoolBookFresh-le5-and$summary.market.marketRecoveringSampleRatio-le.2-and$summary.pipeline.maxEligible-gt0-and$summary.pipeline.maxConsecutivePoolEmpty-le5-and$summary.pipeline.entryBlockedSamples-eq0-and$summary.pipeline.privateNotReadySamples-eq0-and$summary.market.reconnects-le3-and$summary.market.recoveryFailure-le[math]::Max(5,$summary.market.recoverySuccess*.25)-and$summary.ai.primaryCompleted-gt0-and$falseMappings-eq0-and$overlaps-eq0-and$terminalInActive-eq0-and$badTp.Count-eq0)
  $summary|ConvertTo-Json -Depth 10|Set-Content "$dir\summary.json";$summary|ConvertTo-Json -Depth 10
  if(!$summary.pass){exit 1}
}finally{
  if($proc-and!$proc.HasExited){Stop-Process -Id $proc.Id -Force}
  $env:ZDJ_PORT=$old.port;$env:ZDJ_HOST=$old.host;$env:ZDJ_DATA_DIR=$old.data
}
