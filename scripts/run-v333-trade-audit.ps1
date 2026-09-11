param([int]$Hours=5,[int]$Port=8080)

$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$dir=Join-Path $root "data\diagnostics\trade-audit-5h\$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$audit=Invoke-RestMethod "http://127.0.0.1:$Port/api/v3/diagnostics/trade-audit?hours=$Hours" -TimeoutSec 120
$audit | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $dir 'audit.json') -Encoding utf8
[ordered]@{
  evidenceDir=$dir
  window=$audit.window
  fills=@($audit.fills).Count
  income=@($audit.income).Count
  orders=@($audit.orders).Count
  positions=@($audit.positions).Count
  openOrders=@($audit.openOrders).Count
  symbols=@($audit.fills|Select-Object -ExpandProperty symbol -Unique)
  auditFile=(Join-Path $dir 'audit.json')
} | ConvertTo-Json -Depth 6
