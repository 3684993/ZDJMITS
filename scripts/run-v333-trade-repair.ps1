param([int]$Hours=5,[int]$Port=8080,[string]$AuditDir='')

$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if(!$AuditDir){$stamp=Get-Date -Format 'yyyyMMdd-HHmmss';$AuditDir=Join-Path $root "data\diagnostics\trade-audit-5h\$stamp"}
New-Item -ItemType Directory -Force -Path $AuditDir | Out-Null
$body=@{hours=$Hours}|ConvertTo-Json
$result=Invoke-RestMethod "http://127.0.0.1:$Port/api/v3/diagnostics/trade-audit/repair" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 180
$result | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath (Join-Path $AuditDir 'repair.json') -Encoding utf8
[ordered]@{evidenceDir=$AuditDir;cyclesDetected=$result.repair.cyclesDetected;cyclesRepaired=$result.repair.cyclesRepaired;repaired=$result.repair.repaired;repairFile=(Join-Path $AuditDir 'repair.json')}|ConvertTo-Json -Depth 8
