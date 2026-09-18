$ErrorActionPreference='Stop'
$scriptPath=Join-Path $PSScriptRoot 'run-v394-local-rollout.ps1'
$tokens=$null;$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ("PowerShell parse failed: "+(($errors|ForEach-Object {$_.Message}) -join '; '))}
$text=Get-Content -LiteralPath $scriptPath -Raw
foreach($required in @(
  "ValidateSet('Stage6','Stage7','Stage8','Status')",
  "AuthorizeStage6ProxyEnable",
  "--authorize-enable-proxy",
  "ExpectedStaticEgressIp",
  "--expected-static-egress-ip",
  "STAGE6_RETRY_STOPPED_READ_ONLY_ENGINE=TRUE",
  "STAGE6_CURRENT_HEAD_DIST_BUILD_PASS=TRUE",
  "STAGE6_BUILD_FAILED",
  "VerifyStage6ProxyEgress",
  "/api/v3/settings/resources/proxy/binance-proxy/test",
  '${StageLabel}_PROXY_EGRESS_NOT_VERIFIED',
  "_PROXY_EGRESS_VERIFIED=",
  "VerifyStage6ProxyEgress 'STAGE7'",
  "STAGE7_EGRESS_PROBE_RETRY_",
  "STAGE6_RATE_LIMIT_BASELINE",
  "BaselineHttp429",
  "BINANCE_REQUEST_BUDGET_NOT_HEALTHY",
  "STAGE6_SHORT_RECHECK_USING_PRIOR_EVIDENCE",
  "STAGE6_SHORT_RECHECK_REQUIRES_QUALIFIED_PRIOR_30M_EVIDENCE",
  "PriorEvidenceDir",
  "STAGE7_REQUIRES_-AuthorizeTestnetWrite",
  "STAGE8_REQUIRES_-AuthorizeAutoTrading",
  "demo-fapi.binance.com",
  "expectedStaticEgressIp",
  "TESTNET_ENABLED",
  "PauseEntries 'V3.9.4 Stage7",
  "maxPositions=1",
  "maxPendingEntries=1",
  "dynamicMarginEnabled",
  "STAGE7_PASS_ENGINE_REMAINS_PAUSED=TRUE",
  "STAGE8_AUTO_TRADING_STARTED"
)){
  if(-not $text.Contains($required)){throw "Missing rollout safety contract: $required"}
}
if($text -match "environment\s*=\s*'PRODUCTION'"){throw 'Rollout must never switch exchange environment to PRODUCTION'}
if($text -match '\$positions=@\(ApiGet'){throw 'Exposure gate must not size engine arrays with @(ApiGet ...), which counts 1 for any non-empty array'}
foreach($observed in @('activeRiskUnresolvedCount','unresolvedDriftCount','rawStatusActive')){
  if(-not $text.Contains($observed)){throw "Exposure gate must consult the engine risk read model: $observed"}
}
# Execute the shipped helper itself, so the coercion is proven on real payloads rather than asserted as text.
$helperAst=[System.Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
$helper=$helperAst.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-ResponseItemCount'},$true)|Select-Object -First 1
if(-not $helper){throw 'Exposure gate helper Get-ResponseItemCount is missing from the rollout script'}
. ([ScriptBlock]::Create($helper.Extent.Text))
if((Get-ResponseItemCount (,(@(1,2,3,4,5,6)))) -ne 6){throw 'Get-ResponseItemCount must count 6 positions when Invoke-RestMethod returns one wrapped Object[]'}
if((Get-ResponseItemCount (,([object[]]@()))) -ne 0){throw 'Get-ResponseItemCount must count 0 for an empty engine array'}
if((Get-ResponseItemCount $null) -ne 0){throw 'Get-ResponseItemCount must count 0 when the engine returns no array'}
if((Get-ResponseItemCount ([pscustomobject]@{symbol='BTCUSDT'})) -ne 1){throw 'Get-ResponseItemCount must count exactly 1 for a single position, otherwise one open position slips past the gate'}
if((Get-ResponseItemCount (,@([pscustomobject]@{symbol='BTCUSDT'}))) -ne 1){throw 'Get-ResponseItemCount must count exactly 1 for one wrapped position row'}
Write-Output 'V3.9.4 local rollout script contract PASS'

if($text.Contains('HTTP_429_ALREADY_OBSERVED') -or $text.Contains('HTTP_418_ALREADY_OBSERVED')){throw 'Historical cumulative 429/418 totals must not permanently block V3.9.4 rollout'}
