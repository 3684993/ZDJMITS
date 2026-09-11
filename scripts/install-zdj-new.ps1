[CmdletBinding()]
param([switch]$Start)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
function Ensure-Command($name,$url) {
  if (Get-Command $name -ErrorAction SilentlyContinue) { return }
  $installer=Join-Path $env:TEMP ([IO.Path]::GetFileName($url)); Invoke-WebRequest $url -OutFile $installer
  Start-Process $installer -ArgumentList '/quiet','InstallAllUsers=1','PrependPath=1' -Wait
}
Ensure-Command 'node.exe' 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi'
if (-not (Get-Command npm.exe -ErrorAction SilentlyContinue)) { throw 'npm was not installed; open a new PowerShell and rerun.' }
Set-Location $root
New-Item -ItemType Directory -Path (Join-Path $root 'data') -Force | Out-Null
npm ci
npm run build
if ($Start) { & (Join-Path $root 'scripts\start-zdj-lan.ps1') -StartReason MANUAL_START }
Write-Output 'ZDJ-MITS deployment prepared. Production writes remain locked; start is manual only.'
