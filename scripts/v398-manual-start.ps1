[CmdletBinding()]
param([switch]$AuthorizedCurrentInstanceStart,[switch]$PreflightOnly)
$ErrorActionPreference='Stop'
if(-not $AuthorizedCurrentInstanceStart){throw 'EXPLICIT_CURRENT_INSTANCE_LIFECYCLE_AUTHORIZATION_REQUIRED'}
$releaseRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
Set-Location -LiteralPath $releaseRoot
$evidence='docs/reports/v398-entry-sizing-quality-review/evidence-20261008'
$head=(& git rev-parse HEAD).Trim();if($LASTEXITCODE -ne 0){throw 'GIT_HEAD_FAILED'}
$remote=(& git ls-remote origin refs/heads/main);if($LASTEXITCODE -ne 0){throw 'GIT_REMOTE_READ_FAILED'}
if(($remote -split '\s+')[0] -ne $head){throw 'REMOTE_MAIN_NOT_TARGET_HEAD'}
if((& git status --porcelain -- apps/engine/src apps/dashboard/src packages/core/src packages/contracts/src)){throw 'DIRTY_RELEASE_SOURCE'}
$verification=Get-Content -LiteralPath 'docs/reports/v398-entry-sizing-quality-review/v398-full-verify-result.json' -Raw|ConvertFrom-Json
if($verification.exitCode -ne 0){throw 'OFFLINE_VERIFY_NOT_PASSED'}
$readback=Get-Content -LiteralPath "$evidence/REMOTE_I2_READBACK.json" -Raw|ConvertFrom-Json
if(-not $readback.passed -or $readback.sha -ne $head){throw 'I2_REMOTE_HASHES_UNPROVEN'}
$facts=Get-Content -LiteralPath "$evidence/testnet-pre-start-readback.json" -Raw|ConvertFrom-Json
# PowerShell 7.5 JSON dates are UTC DateTime values; stringify+Parse would drop Kind and shift by 8h.
$captured=if($facts.capturedAt -is [DateTime]){[DateTimeOffset]$facts.capturedAt}else{[DateTimeOffset]::Parse([string]$facts.capturedAt)}
$ageMinutes=([DateTimeOffset]::UtcNow-$captured).TotalMinutes
if($facts.environment -ne 'TESTNET' -or $facts.host -ne 'demo-fapi.binance.com' -or $facts.taskExchangeWrites -ne 0 -or
  $facts.positions -isnot [array] -or $facts.openOrders -isnot [array] -or $ageMinutes -lt 0 -or $ageMinutes -gt 5){throw 'FRESH_TESTNET_READBACK_UNPROVEN'}
$increasing=@($facts.openOrders|Where-Object {($_.positionSide -eq 'LONG' -and $_.side -eq 'BUY') -or ($_.positionSide -eq 'SHORT' -and $_.side -eq 'SELL') -or ($_.positionSide -eq 'BOTH' -and $_.reduceOnly -ne $true)})
if($increasing.Count){throw 'EXISTING_RISK_INCREASING_ORDER_REQUIRES_MANUAL_REVIEW'}
$listeners=@(netstat -ano|Where-Object {$_ -match '^\s*TCP\s+\S+:8080\s+\S+\s+LISTENING\s+\d+'})
if($listeners.Count){throw 'CURRENT_ENGINE_NOT_STOPPED_NO_AUTOMATIC_RETRY'}
if($PreflightOnly){Write-Output 'PREFLIGHT_ONLY_PASS: no process start or data mutation';return}
$liveData=[IO.Path]::GetFullPath('D:\MITS\data');$releaseData=[IO.Path]::GetFullPath((Join-Path $releaseRoot 'data'))
if(-not $releaseData.StartsWith($releaseRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'DATA_PATH_OUTSIDE_RELEASE'}
if(Test-Path -LiteralPath $releaseData){
 $item=Get-Item -LiteralPath $releaseData -Force
 if($item.LinkType){if([IO.Path]::GetFullPath([string]$item.Target) -ne $liveData){throw 'FOREIGN_DATA_JUNCTION'}}
 else{
  # Preserve every offline artifact; do not delete/merge either data tree.
  $archive=[IO.Path]::GetFullPath((Join-Path $releaseRoot 'data-test\v398-preserved-offline-data'))
  if(-not $archive.StartsWith($releaseRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $archive)){throw 'OFFLINE_ARCHIVE_PATH_UNSAFE_OR_EXISTS'}
  New-Item -ItemType Directory -Path (Split-Path -Parent $archive) -Force|Out-Null
  Move-Item -LiteralPath $releaseData -Destination $archive
  New-Item -ItemType Junction -Path $releaseData -Target $liveData|Out-Null
 }
}else{New-Item -ItemType Junction -Path $releaseData -Target $liveData|Out-Null}
if((Get-Content -LiteralPath 'apps/engine/package.json' -Raw|ConvertFrom-Json).version -ne '3.9.8'){throw 'WRONG_RELEASE_VERSION'}
Remove-Item Env:ZDJ_EXIT_AFTER_MS -ErrorAction SilentlyContinue
Remove-Item Env:ZDJ_FOREGROUND_OBSERVE -ErrorAction SilentlyContinue
$preflight=[ordered]@{at=[DateTimeOffset]::UtcNow.ToString('o');head=$head;environment='TESTNET';positions=$facts.positions.Count;openOrders=$facts.openOrders.Count;riskIncreasingOpenOrders=$increasing.Count;enginePreviouslyStopped=$true;dataTarget=$liveData;exitTimerRemoved=$true;autoRestart=$false;auxiliaryServicesUntouched=$true;authorizedManualStartCalls=1}
$preflight|ConvertTo-Json -Depth 5|Set-Content -LiteralPath "$evidence/manual-start-preflight.json" -Encoding UTF8
& (Join-Path $PSScriptRoot 'start-zdj-lan.ps1') -StartReason MANUAL_START -SkipFirewall
