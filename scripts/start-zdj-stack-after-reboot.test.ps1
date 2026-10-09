$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot 'start-zdj-stack-after-reboot.ps1'
$tokens = $null; $errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ('AUTOSTART_PARSE_FAILED: ' + (($errors | ForEach-Object Message) -join '; ')) }
$source = Get-Content -LiteralPath $path -Raw
$helper = Join-Path $PSScriptRoot 'v398-integrity-current-gate.mjs'
$helperSource = Get-Content -LiteralPath $helper -Raw
$combined = $source + $helperSource
$ordered = @(
  'Wait-Model 8081',
  'Wait-Model 8083',
  'Wait-Model 8084',
  'zdj-trade-proxy-client-windows.ps1',
  'v398-integrity-current-gate.mjs',
  'start-zdj-engine-host.ps1'
)
$last = -1
foreach ($item in $ordered) {
  $index = $source.IndexOf($item, [StringComparison]::Ordinal)
  if ($index -le $last) { throw "AUTOSTART_ORDER_OR_REQUIRED_STEP_INVALID:$item" }
  $last = $index
}
foreach ($required in @('TESTNET', 'demo-fapi.binance.com', 'TP_UNVERIFIED_ENGINE_START_ALLOWED', 'ZDJ_ENTRY_ADMISSION_DISABLED', 'WARM_MODELS_SKIP_COLD_GATE', 'STARTED_ONCE', 'NoWatchdog', 'FAILED_CLOSED', '20091')) {
  if ($combined -notmatch [regex]::Escape($required)) { throw "AUTOSTART_SAFETY_GATE_MISSING:$required" }
}
if ($source -match '(?i)MaxRestarts|EnableWatchdog|while\s*\(\s*\$true\s*\)' -or $source -match '(?i)restartOnFailure\s*=\s*\$true') { throw 'AUTOSTART_AUTOMATIC_RETRY_OR_WATCHDOG_FOUND' }
if ($source -notmatch '\$freeBytes\s*=\s*\$commitLimit\s*-\s*\$committed') { throw 'MEMORY_COMMIT_ARITHMETIC_MUST_PRESERVE_INT64_RANGE' }
node --check $helper
if ($LASTEXITCODE -ne 0) { throw 'CURRENT_GATE_SYNTAX_FAILED' }
if ($helperSource.Contains("method: 'POST'") -or $helperSource -match 'method\s*:\s*[''\"]?(POST|PUT|PATCH|DELETE)') { throw 'CURRENT_GATE_MUST_REMAIN_READ_ONLY' }
if ($source -match 'ENGINE_BLOCKED_ACCOUNT_PROTECTION_GATE') { throw 'TP_STATE_MUST_NOT_BLOCK_ENGINE_START' }
Write-Output 'start-zdj-stack-after-reboot.test.ps1 PASS'
