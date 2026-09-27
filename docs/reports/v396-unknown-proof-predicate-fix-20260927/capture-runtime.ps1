param([string]$Label = 'before')
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$receiptPath = 'D:/MITS/data/runtime/engine-instance.json'
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
$observedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($receipt.pid)"
$diagnostics = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v3/diagnostics/closeout' -TimeoutSec 20
$snapshot = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v3/snapshot' -TimeoutSec 20
$scopedNames = @('evaluatedAt','entryUnknownHistorical','entryUnknownOccupyingRisk','entryUnknownProofValid','activeEntryClaims','activeUnknownEntryClaims','activeEntryClaimsObservedAt','manualUnknown','tpUnknown','snapshotConsistency','activeRiskUnresolvedCountScope')
$scoped = [ordered]@{}
foreach ($fieldName in $scopedNames) {
  if ($diagnostics.pipeline.reconciliation.PSObject.Properties.Name -contains $fieldName) {$scoped[$fieldName] = $diagnostics.pipeline.reconciliation.$fieldName} else {$scoped[$fieldName] = 'NOT_EXPOSED_BY_RUNNING_ARTIFACT'}
}
$positions = @($snapshot.positions | ForEach-Object { [ordered]@{id=$_.id;symbol=$_.symbol;side=$_.side;quantity=$_.quantity;tpStatus=$_.tpStatus;tpOrderId=$_.tpOrderId;managementStatus=$_.managementStatus} })
$tps = @($snapshot.tpOrders | ForEach-Object { [ordered]@{id=$_.id;symbol=$_.symbol;positionId=$_.positionId;status=$_.status;quantity=$_.quantity} })
$artifactRoot = if ($observedProcess.CommandLine -match '"([^"\r\n]+[\\/]apps[\\/]engine[\\/]dist[\\/]main.js)"') { (Resolve-Path (Join-Path (Split-Path $Matches[1]) '../../..')).Path } else { $null }
$record = [ordered]@{
 schema='V396_READ_ONLY_RUNTIME_OBSERVATION_1';capturedAt=[DateTime]::UtcNow.ToString('o');label=$Label
 receiptPath=$receiptPath;receipt=$receipt
 process=[ordered]@{pid=$observedProcess.ProcessId;parentPid=$observedProcess.ParentProcessId;creationDate=$observedProcess.CreationDate;commandLine=$observedProcess.CommandLine;artifactRoot=$artifactRoot}
 listener=@(Get-NetTCPConnection -LocalPort 8080 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess)
 runtime=[ordered]@{pid=$diagnostics.runtime.pid;instanceId=$diagnostics.runtime.instanceId;buildId=$diagnostics.runtime.buildId;uptimeMs=$diagnostics.runtime.uptimeMs;runtimeDataDir=$diagnostics.runtime.runtimeDataDir;lastRestartAt=$diagnostics.runtime.lastRestartAt;restartCount=$diagnostics.runtime.restartCount}
 settingsVersion=$snapshot.settings.settingsVersion
 environment=$snapshot.settings.connections.exchange.environment;executionMode=$snapshot.settings.connections.executionMode
 entryPermission=$diagnostics.pipeline.entryPermission;executionReadiness=$diagnostics.pipeline.executionReadiness;productionWriteBoundary=$diagnostics.productionWriteBoundary
 reconciliation=$diagnostics.pipeline.reconciliation;scopedUnknown=$scoped
 positions=$positions;takeProfitOrders=$tps
 positionCount=$positions.Count;tpOrderCount=$tps.Count
 entryOrders=@($snapshot.entryOrders | ForEach-Object { [ordered]@{id=$_.id;symbol=$_.symbol;status=$_.status} })
 observationOnly=$true;runtimeAcceptance='NOT_RUN_EXTERNAL';lifecycle='NOT_RUN';deployment='DEPLOYMENT_NOT_AUTHORIZED'
 limitations=@('Two HTTP responses are sequential and not atomic.','Current artifact may lack new scoped fields; legacy counts are not relabelled.','Write-boundary counters describe their instrumented path, not total exchange activity.','No external exchange request or lifecycle command was made by this collector.')
}
$target = Join-Path $PSScriptRoot "runtime-$Label.json"
$record | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $target -Encoding utf8
Write-Output "Saved read-only runtime observation: $Label PID=$($observedProcess.ProcessId) build=$($receipt.buildId) positions=$($positions.Count)"
