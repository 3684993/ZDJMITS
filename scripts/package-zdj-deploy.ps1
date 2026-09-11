[CmdletBinding()]
param([string]$Output = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Output) { $Output = Join-Path $root 'release\zdj-mits-deploy.zip' }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('zdj-mits-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
  $items = @('apps','packages','scripts','config','package.json','package-lock.json','tsconfig.json','README.md')
  foreach ($item in $items) { $src=Join-Path $root $item; if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $stage -Recurse -Force } }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-zdj-new.ps1') -Destination $stage -Force
  $release = Split-Path -Parent $Output; New-Item -ItemType Directory -Path $release -Force | Out-Null
  if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $Output -CompressionLevel Optimal
  Write-Output "Created $Output"
} finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
