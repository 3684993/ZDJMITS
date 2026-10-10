[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Manifest,[Parameter(Mandatory=$true)][string]$SignedGate,[switch]$LaunchChild,[ValidateSet('ANALYSIS_ONLY','TESTNET_ENTRY_ENABLED')][string]$EntryMode='ANALYSIS_ONLY')
$ErrorActionPreference='Stop'
$release=Get-Content -LiteralPath $Manifest -Raw|ConvertFrom-Json
$gate=Get-Content -LiteralPath $SignedGate -Raw|ConvertFrom-Json
$now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if($gate.gate -ne 'SIGNED_ALL_POSITION_TP_PASS' -or $gate.productionWrites -ne 0 -or $gate.exchangeWrites -ne 0 -or $gate.riskIncreasingOrders -ne 0 -or $now-[int64]$gate.requests[1].completedAt -gt 30000 -or $now-[int64]$gate.requests[1].completedAt -lt 0){throw 'FRESH_SIGNED_ALL_POSITION_TP_REQUIRED'}
if($gate.settingsVersion -ne $release.settingsVersion -or $gate.settingsPayloadSha256 -ne $release.settingsPayloadSha256 -or $gate.environment -ne 'TESTNET' -or $gate.host -ne 'demo-fapi.binance.com' -or $gate.canTrade -ne $true -or $gate.stablecoinFactsComplete -ne $true -or $gate.modeAgrees -ne $true -or @($gate.protection).Count -ne $gate.positions -or @($gate.protection|Where-Object {$_.result -ne 'PASS'}).Count){throw 'SIGNED_GATE_IDENTITY_OR_COVERAGE_INCOMPLETE'}
if(@(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue).Count){throw 'ENGINE_ALREADY_OWNED_NO_SIGNAL_OR_RETRY'}
if((& git -C $release.stage rev-parse HEAD).Trim() -ne $release.sourceCommit -or (Get-FileHash -LiteralPath (Join-Path $release.stage 'apps/engine/dist/main.js') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $release.entrypointSha256){throw 'SEALED_ENTRYPOINT_CHANGED'}
if(-not $LaunchChild){
 $startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
 $powershell=(Get-Command powershell.exe).Source
 $arguments='"'+$powershell+'" -NoProfile -NonInteractive -File "'+$PSCommandPath+'" -Manifest "'+$Manifest+'" -SignedGate "'+$SignedGate+'" -EntryMode '+$EntryMode+' -LaunchChild'
 $result=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$arguments;CurrentDirectory=$release.stage;ProcessStartupInformation=$startup}
 if($result.ReturnValue -ne 0){throw 'DETACHED_REVIEWED_HOST_FAILED'}
 [ordered]@{at=[DateTime]::UtcNow.ToString('o');hostPid=$result.ProcessId;sourceCommit=$release.sourceCommit;entryMode=$EntryMode;startAttempts=1;autoRestart=$false}|ConvertTo-Json|Set-Content (Join-Path $release.privateRoot 'launch-dispatch.json') -Encoding utf8
 return
}
$env:ZDJ_CONFIG_DIR=Join-Path $release.stage 'config';$env:ZDJ_DATA_DIR='D:\MITS\data';$env:ZDJ_START_REASON='MANUAL_START'
$env:ZDJ_ENTRY_EXECUTION_POLICY=$EntryMode;$env:ZDJ_ENTRY_ADMISSION_DISABLED='1'
$env:ZDJ_ENTRY_APPROVAL_FILE='';$env:ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256=''
Remove-Item Env:ZDJ_EXIT_AFTER_MS -ErrorAction SilentlyContinue
if($EntryMode -eq 'TESTNET_ENTRY_ENABLED'){
 $approvalPath=Join-Path $release.privateRoot 'entry-approval.json'
 $approval=[ordered]@{version=1;mode=$EntryMode;operatorApproval='ONE_TESTNET_ENGINE_SWITCH';revoked=$false;expiresAt=$now+10800000;settingsVersion=$release.settingsVersion;artifactSha256=$release.artifactHash;sourceSha256=$release.sourceHash;entrypointSha256=$release.entrypointSha256;dataRoot=$env:ZDJ_DATA_DIR;qualificationBasis='OPERATOR_ATTESTED_USER_AUTHORIZED_NETWORK_RECOVERY';signedGate='SIGNED_ALL_POSITION_TP_PASS'}
 [IO.File]::WriteAllText($approvalPath,($approval|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 $env:ZDJ_ENTRY_APPROVAL_FILE=$approvalPath;$env:ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256=$release.artifactHash;$env:ZDJ_ENTRY_ADMISSION_DISABLED='0'
}
& (Join-Path $release.stage 'scripts/start-zdj-engine-host.ps1') -NodePath (Get-Command node.exe).Source -EnginePath (Join-Path $release.stage 'apps/engine/dist/main.js') -WorkingDirectory $release.stage -StdoutPath (Join-Path $release.privateRoot 'engine.stdout.log') -StderrPath (Join-Path $release.privateRoot 'engine.stderr.log') -LifecyclePath (Join-Path $release.privateRoot 'engine-lifecycle.jsonl') -ReceiptPath (Join-Path $release.privateRoot 'engine-receipt.json') -LaunchId ([guid]::NewGuid().ToString('N'))
