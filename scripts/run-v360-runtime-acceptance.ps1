[CmdletBinding()]
param(
  [int]$DurationMinutes=120,
  [int]$IntervalSeconds=60,
  [string]$OutputPath=(Join-Path (Join-Path $PSScriptRoot '..\temp') 'v360-runtime-acceptance.json')
)
$ErrorActionPreference='Continue'
$startedAt=[DateTimeOffset]::Now
$deadline=$startedAt.AddMinutes($DurationMinutes)
$samples=[Collections.Generic.List[object]]::new()
$lanIp=(Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue|Where-Object{$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred'}|Select-Object -First 1 -ExpandProperty IPAddress)
function Probe([string]$url){$sw=[Diagnostics.Stopwatch]::StartNew();try{$response=Invoke-WebRequest -Uri $url -TimeoutSec 10 -UseBasicParsing;$sw.Stop();return [pscustomobject]@{ok=$response.StatusCode -eq 200;status=[int]$response.StatusCode;latencyMs=$sw.ElapsedMilliseconds;error=$null}}catch{$sw.Stop();return [pscustomobject]@{ok=$false;status=0;latencyMs=$sw.ElapsedMilliseconds;error=$_.Exception.Message}}}
do{
  $now=[DateTimeOffset]::Now;$loop=Probe 'http://127.0.0.1:8080/health';$lan=if($lanIp){Probe "http://${lanIp}:8080/health"}else{[pscustomobject]@{ok=$false;status=0;latencyMs=0;error='NO_LAN_IP'}}
  $health=$null;$mi=$null;try{$health=Invoke-RestMethod 'http://127.0.0.1:8080/health' -TimeoutSec 10}catch{};try{$mi=Invoke-RestMethod 'http://127.0.0.1:8080/api/v3/market-intelligence' -TimeoutSec 10}catch{}
  $samples.Add([pscustomobject]@{at=$now.ToUnixTimeMilliseconds();loopback=$loop;lan=$lan;version=$health.version;engine=$health.status;market=$health.checks.marketStream.state;private=$health.checks.privateData.status;shadow=$health.shadow.status;shadowSamples=$health.shadow.samples;validObservationStartedAt=$health.runtime.shadow.validObservationStartedAt;validObservationRequiredUntil=$health.runtime.shadow.validObservationRequiredUntil;autoResume=$health.autoResume;autoFrozen=$health.autoFrozen;temporalStatus=$mi.status;decisionEpisodes=$mi.coverage.total;regimeSamples=@($mi.timeline).Count;wouldReuse=$mi.stateChangeGate.wouldReuseCount;eventLoopLagP95Ms=$mi.runtime.eventLoopLagMs.p95;eventLoopLagMaxMs=$mi.runtime.eventLoopLagMs.max;researchWorkerErrors=$mi.runtime.workerErrors})
  if([DateTimeOffset]::Now -lt $deadline){Start-Sleep -Seconds $IntervalSeconds}
}while([DateTimeOffset]::Now -lt $deadline)
$endedAt=[DateTimeOffset]::Now;$loopOk=@($samples|Where-Object{$_.loopback.ok}).Count;$lanOk=@($samples|Where-Object{$_.lan.ok}).Count;$first=$samples[0];$last=$samples[$samples.Count-1]
$entryAudit=$null;try{$entryAudit=Invoke-RestMethod ("http://127.0.0.1:8080/api/v3/audit/entry-chain?since="+$startedAt.ToUnixTimeMilliseconds()) -TimeoutSec 30}catch{}
$createdOrders=@($entryAudit.items|Where-Object type -eq 'ENTRY_ORDER_CREATED').Count
$processAudit=& (Join-Path $PSScriptRoot 'audit-node-runtime.ps1')|ConvertFrom-Json
$report=[pscustomobject]@{version='3.6.2';startedAt=$startedAt.ToString('o');endedAt=$endedAt.ToString('o');elapsedMinutes=($endedAt-$startedAt).TotalMinutes;intervalSeconds=$IntervalSeconds;sampleCount=$samples.Count;summary=[pscustomobject]@{loopbackSuccessRate=if($samples.Count){$loopOk/$samples.Count}else{0};lanSuccessRate=if($samples.Count){$lanOk/$samples.Count}else{0};maxLoopbackLatencyMs=($samples.loopback.latencyMs|Measure-Object -Maximum).Maximum;maxLanLatencyMs=($samples.lan.latencyMs|Measure-Object -Maximum).Maximum;maxEventLoopLagP95Ms=($samples.eventLoopLagP95Ms|Measure-Object -Maximum).Maximum;maxEventLoopLagMs=($samples.eventLoopLagMaxMs|Measure-Object -Maximum).Maximum;decisionEpisodeGrowth=[int64]$last.decisionEpisodes-[int64]$first.decisionEpisodes;stateGateReuseGrowth=[int64]$last.wouldReuse-[int64]$first.wouldReuse;entryOrderCreatedCount=$createdOrders;autoRunning=@($samples|Where-Object{$_.autoResume -and -not $_.autoFrozen}).Count -eq $samples.Count;workerErrorSamples=@($samples|Where-Object{$_.researchWorkerErrors -gt 0}).Count;zdjOrphanCount=$processAudit.summary.zdjOrphan;nodeRepl=@($processAudit.processes|Where-Object name -eq 'node_repl.exe'|Select-Object pid,ppid,executablePath,classification)};samples=$samples;processAudit=$processAudit}
$report|Add-Member -NotePropertyName pass -NotePropertyValue ($report.elapsedMinutes -ge $DurationMinutes -and $report.summary.loopbackSuccessRate -eq 1 -and $report.summary.lanSuccessRate -eq 1 -and $report.summary.autoRunning -and $report.summary.workerErrorSamples -eq 0 -and $report.summary.zdjOrphanCount -eq 0)
$resolved=[IO.Path]::GetFullPath($OutputPath);[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($resolved))|Out-Null;[IO.File]::WriteAllText($resolved,($report|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false));$report|ConvertTo-Json -Depth 6
