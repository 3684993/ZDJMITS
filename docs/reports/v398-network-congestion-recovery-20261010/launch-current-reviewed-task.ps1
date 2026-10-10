[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference='Stop'
$release=Get-Content -LiteralPath $Manifest -Raw|ConvertFrom-Json
if(@(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue).Count){throw 'ENGINE_ALREADY_OWNED_NO_RESTART'}
$gatePath=Join-Path $release.privateRoot ('task-gate-'+(Get-Date -Format yyyyMMddHHmmss)+'.json')
$node=(Get-Command node.exe).Source
& $node (Join-Path $PSScriptRoot 'signed-offline-gate.mjs') --out $gatePath
if($LASTEXITCODE -ne 0){throw 'SIGNED_GATE_PROCESS_FAILED'}
# Future manual/reboot dispatches always use fresh facts and disable new Entry.
& (Join-Path $PSScriptRoot 'launch-reviewed-release.ps1') -Manifest $Manifest -SignedGate $gatePath -EntryMode ANALYSIS_ONLY
