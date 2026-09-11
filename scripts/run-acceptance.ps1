param([double]$EnduranceSmokeMinutes=1,[int]$Port=18091)
$ErrorActionPreference='Stop';$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
& (Join-Path $PSScriptRoot 'acceptance-static.ps1')
& (Join-Path $PSScriptRoot 'run-3h-endurance.ps1') -DurationMinutes $EnduranceSmokeMinutes -Port $Port -DataDir 'data-test' -SampleSeconds 2
if($LASTEXITCODE -ne 0){throw "Endurance acceptance failed with exit code $LASTEXITCODE"}
Write-Output 'PASS acceptance scripts'
