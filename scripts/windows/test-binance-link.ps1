[CmdletBinding()]
param(
  [string]$Symbol = 'ETCUSDC'
)

$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

Set-Location (Resolve-Path "$PSScriptRoot\..\..")
$root = (Get-Location).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $root ("data\diagnostics\binance-link-audit-" + $stamp)
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

function Save-LocalJson {
  param([string]$Path,[string]$FileName)
  try {
    $value = Invoke-RestMethod -Uri ("http://127.0.0.1:8080" + $Path) -TimeoutSec 10
    $json = $value | ConvertTo-Json -Depth 100
    $json = $json -replace '(?i)("(?:api.?key|api.?secret|signature|authorization|proxyUrl|listenKey)"\s*:\s*)"[^"]*"', '$1"[REDACTED]"'
    [IO.File]::WriteAllText((Join-Path $outDir $FileName),$json,$utf8)
  } catch {
    [IO.File]::WriteAllText((Join-Path $outDir ($FileName + '.error.txt')),$_.Exception.Message,$utf8)
  }
}

Save-LocalJson '/api/v3/diagnostics/binance-governance' 'binance-governance.json'
Save-LocalJson '/api/v3/settings/readiness' 'readiness.json'
Save-LocalJson '/api/v3/operational-incidents' 'operational-incidents.json'
Save-LocalJson '/api/v3/pipeline' 'pipeline.json'
Save-LocalJson '/api/v3/ops/runtime' 'runtime.json'
Save-LocalJson '/api/v3/universe' 'universe.json'
Save-LocalJson ('/api/v3/eip/' + [Uri]::EscapeDataString($Symbol)) 'eip-symbol.json'

$signedScript = Join-Path $root 'scripts\v397-signed-account-readback.mjs'
if (Test-Path -LiteralPath $signedScript) {
  $signedOut = Join-Path $outDir 'signed-account-readback.json'
  $signedErr = Join-Path $outDir 'signed-account-readback.stderr.txt'
  & node $signedScript $root (Join-Path $root 'data') 1> $signedOut 2> $signedErr
}

$latestForeground = Get-ChildItem -LiteralPath (Join-Path $root 'data\runtime-logs') -Filter 'engine.foreground.*.log' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latestForeground) {
  Copy-Item -LiteralPath $latestForeground.FullName -Destination (Join-Path $outDir $latestForeground.Name)
}

$meta = [ordered]@{
  capturedAt = (Get-Date).ToString('o')
  symbol = $Symbol
  engineExpected = '127.0.0.1:8080'
  productionWritesAddedByThisScript = 0
  note = 'READ_ONLY evidence capture; 8083/8084 untouched'
}
[IO.File]::WriteAllText((Join-Path $outDir 'capture-meta.json'),($meta | ConvertTo-Json -Depth 10),$utf8)

$zip = $outDir + '.zip'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host ('UPLOAD_THIS_FILE=' + $zip)
