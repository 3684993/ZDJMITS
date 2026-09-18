$ErrorActionPreference='Stop'
$scriptPath=Join-Path $PSScriptRoot 'run-v394-readonly-canary.ps1'
$tokens=$null;$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ("PowerShell parse failed: "+(($errors|ForEach-Object {$_.Message}) -join '; '))}
$text=Get-Content -LiteralPath $scriptPath -Raw
foreach($required in @("'READ_ONLY'","'TESTNET'","demo-fapi.binance.com","/api/v3/diagnostics/binance-governance","expectedStaticEgressIp","http429Delta","http418Delta","privateTruthTimeoutDelta")){
  if(-not $text.Contains($required)){throw "Missing Stage6 evidence contract: $required"}
}
if($text -match 'Invoke-(RestMethod|WebRequest).*(-Method\s+(Post|Put|Delete|Patch)|-Body\s)'){throw 'Stage6 collector must remain GET-only'}
Write-Output 'V3.9.4 read-only canary script contract PASS'
