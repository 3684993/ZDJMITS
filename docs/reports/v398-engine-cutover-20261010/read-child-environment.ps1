$ErrorActionPreference='Stop'
$source=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\testnet-entry-cutover-20261009\read-engine-environment.ps1'
$text=Get-Content -LiteralPath $source -Raw
$marker=$text.IndexOf('$health=')
if($marker -lt 0){throw 'TRUSTED_ENV_READER_DEFINITION_NOT_FOUND'}
Invoke-Expression $text.Substring(0,$marker)
$h=Invoke-RestMethod http://127.0.0.1:8080/health -TimeoutSec 10
$selected=[EntryProcessEnvReader]::ReadEntryEnvironment($h.pid)
[ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');pid=$h.pid;buildId=$h.runtime.buildId;actualChildEnvironment=$selected;readOnly=$true} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'actual-child-environment.json') -Encoding utf8
