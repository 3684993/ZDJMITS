[CmdletBinding()]
param(
  [switch]$Foreground
)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
$launcher=Join-Path (Get-Location) 'scripts/start-zdj-lan.ps1'
if($Foreground){
  & $launcher -Foreground
}else{
  & $launcher
}
