param([int]$Port=18092,[string]$DataDir='data',[int]$SampleSeconds=15)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'run-v312-30m-acceptance.ps1') -DurationMinutes 60 -Port $Port -DataDir $DataDir -SampleSeconds $SampleSeconds
exit $LASTEXITCODE
