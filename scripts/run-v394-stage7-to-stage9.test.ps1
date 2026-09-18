$ErrorActionPreference='Stop'
$scriptPath=Join-Path $PSScriptRoot 'run-v394-stage7-to-stage9.ps1'
$tokens=$null;$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ('PowerShell parse failed: '+(($errors|ForEach-Object {$_.Message}) -join '; '))}
$text=Get-Content -LiteralPath $scriptPath -Raw
foreach($required in @(
  "ValidateSet('Status','Cleanup','Stage7','Stage8','Accept12H','Accept24H','All')",
  'CLEANUP_REQUIRES_-AuthorizeTestnetCleanup',
  '_REQUIRES_-$flag',
  'PRODUCTION_WRITE_FORBIDDEN',
  'demo-fapi.binance.com',
  'EGRESS_NOT_VERIFIED',
  'ACCOUNT_NOT_READY',
  'WS_NOT_LIVE',
  'RECONCILIATION_NOT_SETTLED',
  'action=''EMERGENCY_CLOSE''',
  'idempotencyKey',
  '/api/v3/testnet/cleanup/preview',
  '/api/v3/testnet/cleanup/run',
  'EXPOSURE_CLEANUP_PASS=TRUE',
  'ALREADY_PASS_SKIPPING',
  'ACCEPTANCE_WINDOW_SHORT',
  'ACCEPTANCE_FAILED',
  'PENDING_NO_NATURAL_ENTRY',
  'continuityBreaks',
  'continuity-break-',
  'positionsProjection',
  'maxConsecutiveRiskSamples',
  'sustainedViolationLimit',
  'http429Delta',
  'http418Delta',
  'falseCounterDiscontinuity',
  'tpIntegrityViolations',
  'run-v394-local-rollout.ps1'
)){
  if(-not $text.Contains($required)){throw "Missing stage7-to-stage9 safety contract: $required"}
}
if($text -match "environment\s*=\s*'PRODUCTION'"){throw 'Stage7-to-stage9 runner must never switch exchange environment to PRODUCTION'}
if($text -match '(?<!demo-)(?<!-)fapi\.binance\.com'){throw 'Stage7-to-stage9 runner must hard-verify demo-fapi and never name the production REST host'}
if($text -match 'https?://api\.binance\.com'){throw 'Stage7-to-stage9 runner must never reference the production API host'}
if($text -match 'Remove-Item.*(sqlite|\.db)'){throw 'Stage7-to-stage9 runner must not delete persistence to fake a flat account'}
# Execute the shipped array coercion so the exposure count is proven on real payloads, not asserted.
$t2=$null;$e2=$null
$ast=[System.Management.Automation.Language.Parser]::ParseInput($text,[ref]$t2,[ref]$e2)
foreach($name in @('Get-ItemCount','Get-MaxRun')){
  $def=$ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)|Select-Object -First 1
  if(-not $def){throw "helper $name is missing from the stage7-to-stage9 runner"}
  . ([ScriptBlock]::Create($def.Extent.Text))
}
if((Get-ItemCount (,(@(1,2,3,4,5,6)))) -ne 6){throw 'Get-ItemCount must count 6 when Invoke-RestMethod returns one wrapped Object[]'}
if((Get-ItemCount (,([object[]]@()))) -ne 0){throw 'Get-ItemCount must count 0 for an empty engine array'}
if((Get-ItemCount $null) -ne 0){throw 'Get-ItemCount must count 0 when the engine returns nothing'}
if((Get-ItemCount ([pscustomobject]@{symbol='BTCUSDT'})) -ne 1){throw 'Get-ItemCount must count exactly 1, otherwise one open position slips past the flat gate'}
if((Get-ItemCount (,@([pscustomobject]@{symbol='BTCUSDT'}))) -ne 1){throw 'Get-ItemCount must count exactly 1 for one wrapped position row'}
# The acceptance window must separate a transient reconciliation state from a sustained defect.
$runRows=@([ordered]@{v=0},[ordered]@{v=1},[ordered]@{v=0},[ordered]@{v=1},[ordered]@{v=1},[ordered]@{v=0})
if((Get-MaxRun $runRows {param($r)$r.v -gt 0}) -ne 2){throw 'Get-MaxRun must report the longest consecutive non-zero run, not the total count'}
if((Get-MaxRun @() {param($r)$r.v -gt 0}) -ne 0){throw 'Get-MaxRun must return 0 for an empty sample set'}
if((Get-MaxRun @([ordered]@{v=1}) {param($r)$r.v -gt 0}) -ne 1){throw 'Get-MaxRun must count a single transient sample as a run of 1'}
Write-Output 'V3.9.4 stage7-to-stage9 runner contract PASS'
