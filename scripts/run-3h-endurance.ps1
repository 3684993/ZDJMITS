param([double]$DurationMinutes=180,[int]$Port=18090,[string]$DataDir='data',[int]$SampleSeconds=5)
$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedData=(Resolve-Path (Join-Path $workspace $DataDir)).Path
if(!$resolvedData.StartsWith($workspace,[StringComparison]::OrdinalIgnoreCase)){throw 'DataDir must stay inside workspace'}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss';$evidenceDir=Join-Path $workspace "data\endurance\$stamp";New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$samples=Join-Path $evidenceDir 'samples.jsonl';$events=Join-Path $evidenceDir 'engine.jsonl';$errors=Join-Path $evidenceDir 'engine.err.log';$summaryPath=Join-Path $evidenceDir 'summary.json'
$deadline=(Get-Date).AddMinutes($DurationMinutes);$base="http://127.0.0.1:$Port";$restarts=0;$sampleCount=0;$failedSamples=0;$maxEntries=0;$maxPositions=0;$maxAuditEvents=0;$process=$null;$exitCodes=@();$fatalDetected=$false;$finalExitCode=$null
$oldPort=$env:ZDJ_PORT;$oldHost=$env:ZDJ_HOST;$oldData=$env:ZDJ_DATA_DIR;$oldExit=$env:ZDJ_EXIT_AFTER_MS
function Start-Engine([int]$remainingMs){$env:ZDJ_PORT="$Port";$env:ZDJ_HOST='127.0.0.1';$env:ZDJ_DATA_DIR=$resolvedData;$env:ZDJ_EXIT_AFTER_MS="$remainingMs";Start-Process -FilePath 'node' -ArgumentList @('apps/engine/dist/main.js') -WorkingDirectory $workspace -RedirectStandardOutput $events -RedirectStandardError $errors -WindowStyle Hidden -PassThru}
function Has-FatalEngineError(){if(!(Test-Path -LiteralPath $errors)){return $false};return [bool](Select-String -LiteralPath $errors -Pattern 'TypeError:|Unhandled|Uncaught|FATAL|UnhandledPromiseRejection' -Quiet)}
try{
  $remaining=[Math]::Max(1000,[int](($deadline-(Get-Date)).TotalMilliseconds));$process=Start-Engine $remaining
  while((Get-Date) -lt $deadline){
    if($process.HasExited){$exitCode=$process.ExitCode;$exitCodes+=$exitCode;if($exitCode -ne 0 -or (Has-FatalEngineError)){$fatalDetected=$true};$restarts++;$remaining=[Math]::Max(1000,[int](($deadline-(Get-Date)).TotalMilliseconds));$process=Start-Engine $remaining}
    try{$health=Invoke-RestMethod -Uri "$base/health" -TimeoutSec 4;if($health.ready){$snapshot=Invoke-RestMethod -Uri "$base/api/v3/snapshot" -TimeoutSec 4;$ops=Invoke-RestMethod -Uri "$base/api/v3/operations/health" -TimeoutSec 4;$badTp=@($snapshot.positions|Where-Object {$_.tpStatus -notin @('PENDING','PROTECTED')}).Count;$row=[ordered]@{ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();ready=$true;universe=$snapshot.universe.total;eligible=$snapshot.universe.eligible;pool=@($snapshot.pool).Count;entries=@($snapshot.entryOrders).Count;positions=@($snapshot.positions).Count;tpOrders=@($snapshot.tpOrders).Count;badTp=$badTp;aiRuns=@($snapshot.recentAiRuns).Count;aiFailures=@($snapshot.recentAiRuns|Where-Object status -eq 'FAILED').Count;reconciliation=$ops.reconciliation;health=$snapshot.health};$maxEntries=[Math]::Max($maxEntries,$row.entries);$maxPositions=[Math]::Max($maxPositions,$row.positions);$persistence=$snapshot.health|Where-Object id -eq 'persistence';if($persistence){$pm=$persistence.detail|ConvertFrom-Json;$maxAuditEvents=[Math]::Max($maxAuditEvents,[int]$pm.auditEvents)};$row|ConvertTo-Json -Depth 8 -Compress|Add-Content -LiteralPath $samples -Encoding utf8;$sampleCount++}}catch{$failedSamples++;[ordered]@{ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();ready=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress|Add-Content -LiteralPath $samples -Encoding utf8}
    Start-Sleep -Seconds $SampleSeconds
  }
  if($process -and !$process.HasExited){if(!$process.WaitForExit(15000)){throw 'Engine did not exit gracefully before acceptance timeout'}}
  $process.Refresh();$finalExitCode=[int]$process.ExitCode;$exitCodes+=$finalExitCode;if($finalExitCode -ne 0 -or (Has-FatalEngineError)){$fatalDetected=$true}
  $db=Join-Path $resolvedData 'zdj-settings.sqlite';$summary=[ordered]@{startedAt=$stamp;completedAt=(Get-Date).ToString('o');requestedMinutes=$DurationMinutes;sampleCount=$sampleCount;failedSamples=$failedSamples;restarts=$restarts;exitCodes=$exitCodes;finalExitCode=$finalExitCode;fatalDetected=$fatalDetected;maxEntries=$maxEntries;maxPositions=$maxPositions;maxAuditEvents=$maxAuditEvents;databaseBytes=if(Test-Path $db){(Get-Item $db).Length}else{0};stdoutBytes=if(Test-Path $events){(Get-Item $events).Length}else{0};stderrBytes=if(Test-Path $errors){(Get-Item $errors).Length}else{0};evidenceDir=$evidenceDir;pass=($sampleCount -gt 0 -and $failedSamples -le 12 -and $restarts -eq 0 -and $finalExitCode -eq 0 -and !$fatalDetected)};$summary|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $summaryPath -Encoding utf8;$summary|ConvertTo-Json -Depth 5
  $passed=[bool]$summary['pass']
  if(-not $passed){exit 1}
  exit 0
}finally{$env:ZDJ_PORT=$oldPort;$env:ZDJ_HOST=$oldHost;$env:ZDJ_DATA_DIR=$oldData;$env:ZDJ_EXIT_AFTER_MS=$oldExit;if($process -and !$process.HasExited){Stop-Process -Id $process.Id -Force}}
