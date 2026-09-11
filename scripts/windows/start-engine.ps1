$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
& (Join-Path (Get-Location) 'scripts/start-zdj-lan.ps1')
