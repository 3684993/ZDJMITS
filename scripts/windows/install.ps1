$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
Write-Host "[ZDJ V3] Installing workspace dependencies..."
npm install
Write-Host "[ZDJ V3] Running verification..."
npm run verify
