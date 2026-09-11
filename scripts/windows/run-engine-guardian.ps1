param([int]$Port=8080,[string]$HostAddress='127.0.0.1')
throw 'MANUAL_START_ONLY: automatic Engine guardian is disabled. Run scripts/start-zdj-lan.ps1 manually.'
$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir=Join-Path $workspace 'data\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
while($true){
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss';$stdout=Join-Path $logDir "engine-$stamp.jsonl";$stderr=Join-Path $logDir "engine-$stamp.err.log"
  $env:ZDJ_PORT="$Port";$env:ZDJ_HOST=$HostAddress
  $process=Start-Process -FilePath 'node' -ArgumentList @('apps/engine/dist/main.js') -WorkingDirectory $workspace -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  $process.WaitForExit();$exitCode=$process.ExitCode
  Get-ChildItem -LiteralPath $logDir -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 40 | Remove-Item -Force
  if($exitCode -eq 0){break};Start-Sleep -Seconds 3
}
