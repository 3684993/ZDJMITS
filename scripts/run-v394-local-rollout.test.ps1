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
Write-Output 'V3.9.4 local rollout script contract PASS'
