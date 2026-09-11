param([Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
$samples=Join-Path $EvidenceDir 'samples.jsonl'
$summaryPath=Join-Path $EvidenceDir 'summary.json'
if(!(Test-Path $samples)-or!(Test-Path $summaryPath)){throw 'Acceptance evidence is incomplete'}
$rows=@([IO.File]::ReadAllLines($samples,[Text.Encoding]::UTF8)|ForEach-Object{$_|ConvertFrom-Json})
$summary=Get-Content $summaryPath -Raw|ConvertFrom-Json
$stableAtMs=[double]$rows[0].ts
$runs=@($rows|Where-Object ready|ForEach-Object{$_.runs}|Where-Object{[double]$_.startedAt-ge$stableAtMs}|Group-Object id|ForEach-Object{$_.Group[-1]})
$scout=@($runs|Where-Object role -eq 'SCOUT')
$primary=@($runs|Where-Object role -eq 'PRIMARY_BRAIN')
$done=@($primary|Where-Object status -eq 'COMPLETED')
function Percentile($values,[double]$p){$v=@($values|Where-Object{$null-ne$_}|Sort-Object);if(!$v.Count){return $null};$v[[math]::Min($v.Count-1,[math]::Floor(($v.Count-1)*$p))]}
$ordered=@($primary|Sort-Object startedAt);$overlaps=0
for($i=1;$i-lt$ordered.Count;$i++){if($null-ne$ordered[$i-1].completedAt-and[double]$ordered[$i].startedAt-lt[double]$ordered[$i-1].completedAt){$overlaps++}}
$summary.ai.scoutCompleted=@($scout|Where-Object status -eq 'COMPLETED').Count
$summary.ai.scoutFailed=@($scout|Where-Object status -eq 'FAILED').Count
$summary.ai.primaryCompleted=$done.Count
$summary.ai.primaryFailed=@($primary|Where-Object status -eq 'FAILED').Count
$summary.ai.scoutLatencyP50=Percentile @($scout|ForEach-Object{$_.latencyMs}) .5
$summary.ai.scoutLatencyP95=Percentile @($scout|ForEach-Object{$_.latencyMs}) .95
$summary.ai.primaryLatencyP50=Percentile @($primary|ForEach-Object{$_.latencyMs}) .5
$summary.ai.primaryLatencyP95=Percentile @($primary|ForEach-Object{$_.latencyMs}) .95
$summary.ai.PLACE_LONG=@($done|Where-Object decision -eq 'PLACE_LONG').Count
$summary.ai.PLACE_SHORT=@($done|Where-Object decision -eq 'PLACE_SHORT').Count
$summary.ai.REJECT_CANDIDATE=@($done|Where-Object decision -eq 'REJECT_CANDIDATE').Count
$rejected=@($done|Where-Object decision -eq 'REJECT_CANDIDATE')
$summary.ai.repeatRejectRate=if($rejected.Count){1-(@($rejected.symbol|Sort-Object -Unique).Count/$rejected.Count)}else{$null}
$summary.safety.primaryOverlaps=$overlaps
$allowedFailures=[math]::Max(1,[math]::Floor([double]$summary.runtime.sampleCount*.05))
$summary.pass=([double]$summary.market.sampleSuccessRatio-gt0-and[double]$summary.runtime.failedSamples-le$allowedFailures-and-not[bool]$summary.runtime.fatalDetected-and[double]$summary.market.quoteFreshRatio-ge.8-and[double]$summary.market.klineFreshRatio-ge.8-and[double]$summary.market.marketRecoveringSampleRatio-le.2-and[double]$summary.pipeline.maxEligible-gt0-and[double]$summary.pipeline.maxPoolActive-gt0-and[double]$summary.market.reconnects-le3-and[double]$summary.market.recoveryFailure-le[math]::Max(5,[double]$summary.market.recoverySuccess*.25)-and[double]$summary.ai.primaryCompleted-gt0-and[double]$summary.safety.falseRejectOrFailedToIntent-eq0-and$overlaps-eq0-and[double]$summary.safety.terminalOrdersInActiveProjection-eq0-and@($summary.positions.badTp).Count-eq0)
$summary|ConvertTo-Json -Depth 10|Set-Content $summaryPath
$summary|ConvertTo-Json -Depth 10
if(!$summary.pass){exit 1}
