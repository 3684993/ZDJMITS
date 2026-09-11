[CmdletBinding()]
param(
  [int]$Minutes = 90,
  [int]$IntervalSeconds = 60,
  [string]$ReportPath = (Join-Path $PSScriptRoot '..\data\v363-testnet-acceptance.json')
)
$ErrorActionPreference='Continue'
$base='http://127.0.0.1:8080';$started=Get-Date;$samples=@()
while((Get-Date)-lt$started.AddMinutes($Minutes)){
  $at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  try{
    $health=Invoke-RestMethod "$base/health" -TimeoutSec 8
    $pipeline=Invoke-RestMethod "$base/api/v3/pipeline" -TimeoutSec 8
    $snapshot=Invoke-RestMethod "$base/api/v3/snapshot" -TimeoutSec 8
    $readiness=Invoke-RestMethod "$base/api/v3/auto-readiness" -TimeoutSec 8
    $runs=(Invoke-RestMethod "$base/api/v3/brain/runs?limit=100" -TimeoutSec 8).items
    $write=$readiness.writeBoundary;$samples+=,[ordered]@{at=$at;ready=$health.ready;version=$health.version;autoResume=$health.autoResume;autoFrozen=$health.autoFrozen;market=$health.checks.marketStream.state;private=$health.checks.privateData.status;drift=$health.checks.reconciliation.driftCount;runtime=$pipeline.runtimeControl.mode;governance=$pipeline.entryPermission.autoExecutionMode;primaryActive=@($snapshot.aiResources|Where-Object {$_.role -eq 'PRIMARY_BRAIN'}|Select-Object -First 1).active;scoutActive=@($snapshot.aiResources|Where-Object {$_.role -eq 'SCOUT'}|Select-Object -First 1).active;pool=$pipeline.pool.current;poolTarget=$pipeline.pool.target;nextCandidate=$pipeline.candidateLifecycle.nextCandidate;aiHealth=$pipeline.aiHealth;activity=$pipeline.entryActivity;entryFills=$snapshot.exchangeFillFacts.entryFillsLast1h;exitFills=$snapshot.exchangeFillFacts.exitFillsLast1h;unattributed=$snapshot.exchangeFillFacts.unattributedFillsLast1h;productionWrites=$write.productionWrites;recentRuns=@($runs|Select-Object -First 20 symbol,role,status,latencyMs,direction,decision,protocolNormalization)}
  }catch{$samples+=,[ordered]@{at=$at;ready=$false;error=$_.Exception.Message}}
  Start-Sleep -Seconds $IntervalSeconds
}
$ended=Get-Date;$valid=@($samples|Where-Object {$_.ready});$primary=@($valid|ForEach-Object {$_.activity.primaryCount30m}|Measure-Object -Maximum).Maximum;$place=@($valid|ForEach-Object {$_.activity.placeCount30m}|Measure-Object -Maximum).Maximum;$intent=@($valid|ForEach-Object {$_.activity.entryIntentCount30m}|Measure-Object -Maximum).Maximum;$submit=@($valid|ForEach-Object {$_.activity.submitCount30m}|Measure-Object -Maximum).Maximum;$fill=@($valid|ForEach-Object {$_.activity.fillCount30m}|Measure-Object -Maximum).Maximum;$processAudit=& (Join-Path $PSScriptRoot 'audit-node-runtime.ps1')|ConvertFrom-Json
[ordered]@{version='3.6.3';startedAt=$started.ToString('o');endedAt=$ended.ToString('o');elapsedMinutes=($ended-$started).TotalMinutes;sampleCount=$samples.Count;verdict=[ordered]@{autoRunning=($valid.Count -eq $samples.Count -and @($valid|Where-Object {$_.runtime -ne 'RUNNING' -or $_.governance -ne 'AUTO_RUNNING'}).Count -eq 0);testnetPrivateReady=@($valid|Where-Object {$_.private -ne 'READY'}).Count -eq 0;productionWriteZero=@($valid|Where-Object {[int]$_.productionWrites -ne 0}).Count -eq 0;reconciliationHealthy=@($valid|Where-Object {[int]$_.drift -ne 0}).Count -eq 0;primaryConcurrencyBounded=@($valid|Where-Object {[int]$_.primaryActive -gt 1}).Count -eq 0;zdjOrphanZero=($processAudit.summary.zdjOrphan -eq 0);fills='INCONCLUSIVE_IF_ZERO_NO_SYNTHETIC_FILL'};throughput=[ordered]@{primaryRuns30mMax=$primary;place30mMax=$place;intent30mMax=$intent;submit30mMax=$submit;fill30mMax=$fill;normalizationMax=@($valid|ForEach-Object {$_.aiHealth.normalized}|Measure-Object -Maximum).Maximum;quarantineMax=@($valid|ForEach-Object {$_.aiHealth.quarantine}|Measure-Object -Maximum).Maximum;cooldownMax=@($valid|ForEach-Object {$_.aiHealth.cooldown}|Measure-Object -Maximum).Maximum};samples=$samples;processAudit=$processAudit}|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $ReportPath -Encoding utf8
