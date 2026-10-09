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
foreach ($required in @('TESTNET', 'demo-fapi.binance.com', 'TP_UNVERIFIED_ENGINE_START_ALLOWED', 'ZDJ_ENTRY_ADMISSION_DISABLED', 'ZDJ_ENTRY_EXECUTION_POLICY', 'EntryApprovalFile', 'ENTRY_APPROVAL_INVALID_OR_EXPIRED', 'ANALYSIS_ONLY_FALLBACK', 'entrypointSha256', 'runtimeMustVerifyFullArtifactAndSource', 'WARM_MODELS_SKIP_COLD_GATE', 'Invoke-NodeDiagnostic', 'STARTED_ONCE', 'NoWatchdog', 'FAILED_CLOSED', '20091')) {
  if ($combined -notmatch [regex]::Escape($required)) { throw "AUTOSTART_SAFETY_GATE_MISSING:$required" }
}
if ($source -match '(?i)MaxRestarts|EnableWatchdog|while\s*\(\s*\$true\s*\)' -or $source -match '(?i)restartOnFailure\s*=\s*\$true') { throw 'AUTOSTART_AUTOMATIC_RETRY_OR_WATCHDOG_FOUND' }
if ($source -notmatch '\$freeBytes\s*=\s*\$commitLimit\s*-\s*\$committed') { throw 'MEMORY_COMMIT_ARITHMETIC_MUST_PRESERVE_INT64_RANGE' }
if ($source -match '&\s*\$NodePath\s+\(Join-Path\s+\$ProjectRoot.*v398-integrity-current-gate') { throw 'DIAGNOSTIC_STDERR_MUST_NOT_ABORT_POWERHSHELL_STARTUP' }
node --check $helper
if ($LASTEXITCODE -ne 0) { throw 'CURRENT_GATE_SYNTAX_FAILED' }
if ($helperSource.Contains("method: 'POST'") -or $helperSource -match 'method\s*:\s*[''\"]?(POST|PUT|PATCH|DELETE)') { throw 'CURRENT_GATE_MUST_REMAIN_READ_ONLY' }
if ($source -match 'ENGINE_BLOCKED_ACCOUNT_PROTECTION_GATE') { throw 'TP_STATE_MUST_NOT_BLOCK_ENGINE_START' }
if ($source -match 'gate\.uncoveredPositions') { throw 'TP_DIAGNOSTIC_SUMMARY_REFERENCES_REMOVED_HEURISTIC_FIELD' }
if ($source -match '\$host\s*=\s*Start-Process') { throw 'ENGINE_HOST_ASSIGNMENT_MUST_NOT_USE_READONLY_AUTOMATION_VARIABLE' }
Write-Output 'start-zdj-stack-after-reboot.test.ps1 PASS'

# Extract only the pure predicate from the parsed source: never execute orchestration,
# register tasks, alter task state, or launch Engine in this test.
$autostartAst = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
$guard = $autostartAst.Find({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -eq 'Test-ExistingAutostartAction'
}, $true)
if (-not $guard) { throw 'SILENT_REBOOT_RECONCILIATION_GUARD_MISSING' }
. ([scriptblock]::Create($guard.Extent.Text))
$fixtureDir = Join-Path ([IO.Path]::GetTempPath()) ('zdj-reboot-guard-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixtureDir | Out-Null
try {
  $task = 'ZDJ-MITS-AfterReboot-TESTNET'
  $fixture = Join-Path $fixtureDir ('_' + $task + '.vbs')
  @(
    'Option Explicit'
    'Dim shell, result'
    'Set shell = CreateObject("WScript.Shell")'
    'shell.CurrentDirectory = "D:\MITS"'
    'result = shell.Run("""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -File ""D:\MITS\scripts\start-zdj-stack-after-reboot.ps1""", 0, True)'
    'WScript.Quit result'
  ) | Set-Content -LiteralPath $fixture -Encoding Unicode
  $wrapped = [pscustomobject]@{Execute='C:\Windows\System32\wscript.exe';Arguments=('//B //Nologo "'+$fixture+'"')}
  if (-not (Test-ExistingAutostartAction -Action $wrapped -ExpectedTaskName $task)) { throw 'KNOWN_SILENT_WRAPPER_REJECTED' }
  $direct = [pscustomobject]@{Execute='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';Arguments='-NoProfile -File "D:\MITS\scripts\start-zdj-stack-after-reboot.ps1"'}
  if (-not (Test-ExistingAutostartAction -Action $direct -ExpectedTaskName $task)) { throw 'DIRECT_AUTOSTART_REJECTED' }
  if (Test-ExistingAutostartAction -Action $wrapped -ExpectedTaskName 'ZDJ-MITS-OtherTask') { throw 'UNRELATED_TASK_WRAPPER_ACCEPTED' }
  Add-Content -LiteralPath $fixture -Value 'MsgBox "unexpected"' -Encoding Unicode
  if (Test-ExistingAutostartAction -Action $wrapped -ExpectedTaskName $task) { throw 'ALTERED_WRAPPER_ACCEPTED' }
  $unknown = [pscustomobject]@{Execute='C:\Windows\System32\wscript.exe';Arguments='//B //Nologo "D:\random\untrusted.vbs"'}
  if (Test-ExistingAutostartAction -Action $unknown -ExpectedTaskName $task) { throw 'ARBITRARY_SCRIPT_ACCEPTED' }
  Write-Output 'SILENT_REBOOT_REREGISTRATION_GUARD_PASS'
} finally {
  Remove-Item -LiteralPath $fixtureDir -Recurse -Force
}
