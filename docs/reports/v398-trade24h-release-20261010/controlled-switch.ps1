$ErrorActionPreference='Stop'
$privateRoot='D:/MITS-OPERATIONS/trade24h-private-20261010'
$repo='D:/MITS-WORKTREES/v398-trade24h'
$candidate='6533e4d5bbedfe758336f3dd40c188bad37413cd'
$prep=Get-Content (Join-Path $privateRoot 'staged-release.json') -Raw | ConvertFrom-Json
$ci=Get-Content (Join-Path $repo 'docs/reports/v398-trade24h-release-20261010/github-actions-integration.json') -Raw | ConvertFrom-Json
if($ci.requestedHead -ne $candidate -or @($ci.runs | Where-Object {$_.head_sha -eq $candidate -and $_.status -eq 'completed' -and $_.conclusion -eq 'success' -and @($_.jobs | Where-Object {$_.conclusion -ne 'success'}).Count -eq 0}).Count -lt 1){throw 'EXACT_COMBINED_CI_NOT_SUCCESS'}
if(Test-Path (Join-Path $privateRoot 'one-lifecycle-attempt.json')){throw 'LIFECYCLE_ALREADY_ATTEMPTED_NO_RETRY'}
node (Join-Path $privateRoot 'verify-seal.mjs') *> (Join-Path $privateRoot 'seal-before-action.log')
if($LASTEXITCODE -ne 0){throw 'SEALED_SOURCE_OR_SETTINGS_CHANGED'}
$stage=$prep.stagePath.Replace('/','\')
if((Get-FileHash 'D:/MITS/scripts/stop-zdj-lan.ps1').Hash -ne (Get-FileHash (Join-Path $stage 'scripts/stop-zdj-lan.ps1')).Hash){throw 'FORMAL_STOP_SCRIPT_DIFFERS_REVIEW_REQUIRED'}
node (Join-Path $privateRoot 'signed-current-audit.mjs') --out-dir $privateRoot *> (Join-Path $privateRoot 'signed-before-action.log')
if($LASTEXITCODE -ne 0){throw 'SIGNED_READ_FAILED'}
node (Join-Path $privateRoot 'signed-current-audit.mjs') --out-dir $privateRoot --permission-only *> (Join-Path $privateRoot 'permission-before-action.log')
if($LASTEXITCODE -ne 0){throw 'SIGNED_PERMISSION_READ_FAILED'}
$signed=Get-Content (Join-Path $privateRoot 'testnet-start-gate.json') -Raw | ConvertFrom-Json
$permission=Get-Content (Join-Path $privateRoot 'account-permission.json') -Raw | ConvertFrom-Json
if($signed.protectionAssessment -ne 'SIGNED_EXACT_DUAL_ID_SIDE_QTY_PRICE_MATCH' -or @($signed.requests).Count -ne 6 -or @($signed.requests | Where-Object {$_.dispatch.status -ne 200}).Count -or @($signed.exactProtection | Where-Object {$_.result -ne 'PASS'}).Count -or @($signed.exactProtection).Count -ne $signed.nonzeroPositions -or $permission.account.canTrade -ne $true -or @($permission.requests | Where-Object {$_.dispatch.status -ne 200}).Count){throw 'SIGNED_TP_PERMISSION_GATE_FAILED'}
foreach($sample in @($signed,$permission)){if(([DateTime]::UtcNow-([DateTimeOffset]((@($sample.requests) | Select-Object -Last 1).completedAt)).UtcDateTime).TotalSeconds -ge 60){throw 'SIGNED_SAMPLE_EXPIRED'}}
$health=Invoke-RestMethod http://127.0.0.1:8080/health -TimeoutSec 10
$close=Invoke-RestMethod http://127.0.0.1:8080/api/v3/diagnostics/closeout -TimeoutSec 15
$sync=Invoke-RestMethod http://127.0.0.1:8080/api/v3/diagnostics/private-sync -TimeoutSec 10
$instance=Get-Content D:/MITS/data/runtime/engine-instance.json -Raw | ConvertFrom-Json
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$($health.pid)"
$oldEnv=(Get-Content (Join-Path $privateRoot 'old-child-environment.json') -Raw | ConvertFrom-Json).actualChildEnvironment
if($health.status -ne 'READY' -or $health.pid -ne 23688 -or $instance.pid -ne $health.pid -or $instance.instanceId -ne '07230a28-51ac-4dda-9c95-20a789b382b4' -or $process.ParentProcessId -ne 26576 -or $process.CommandLine -notmatch 'ZDJMITS-v398-main-6f228cd[\\/]apps[\\/]engine[\\/]dist[\\/]main\.js' -or $sync.sync.snapshotAgeMs -ge 60000 -or $sync.sync.consecutiveFailures -ne 0 -or $close.productionWriteBoundary.productionWrites -ne 0 -or $close.productionWriteBoundary.blockedProductionWriteAttempts -ne 0 -or -not $close.productionWriteBoundary.lockedToTestnet -or $close.productionWriteBoundary.environment -ne 'TESTNET' -or $close.productionWriteBoundary.executionMode -ne 'TESTNET_ENABLED' -or $close.pipeline.takeProfit.missing -ne 0 -or $close.pipeline.takeProfit.unverifiedTp -ne 0 -or $close.pipeline.takeProfit.required -ne $signed.nonzeroPositions -or $close.pipeline.takeProfit.protected -ne $signed.nonzeroPositions -or $null -eq $sync.sync.snapshotAgeMs -or $sync.sync.snapshotAgeMs -lt 0 -or $close.pipeline.takeProfit.positionFactUnresolved -ne 0 -or $close.pipeline.takeProfit.duplicateTp -ne 0 -or $close.pipeline.takeProfit.qtyMismatch -ne 0 -or $close.pipeline.takeProfit.wrongSide -ne 0){throw 'CURRENT_RUNTIME_SAFETY_FAILED'}
$aux=@{};foreach($port in @(8081,8083,8084,20091)){$aux[$port]=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)[0]}
if($aux[8081] -ne 3400 -or $aux[8083] -ne 14020 -or $aux[8084] -ne 22336 -or $aux[20091] -ne 18300){throw 'AUXILIARY_IDENTITY_CHANGED'}
$approval=Get-Content (Join-Path $privateRoot 'new-entry-approval.prepared.json') -Raw | ConvertFrom-Json
if($approval.revoked -ne $true -or $approval.sourceSha256 -ne $prep.sourceHash -or $approval.artifactSha256 -ne $prep.artifactHash -or $approval.entrypointSha256 -ne $prep.entrypointSha256 -or $approval.settingsVersion -ne $prep.settings.version -or $approval.accountScopeHash -ne $signed.accountScopeHash -or $approval.accountScopeHash -ne $permission.accountScopeHash -or $approval.expiresAt -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()){throw 'CANDIDATE_APPROVAL_BINDING_INVALID'}
$oldHash=(Get-FileHash -LiteralPath $oldEnv.ZDJ_ENTRY_APPROVAL_FILE).Hash
$dest=Join-Path $env:LOCALAPPDATA 'ZDJMITS/entry-authorization/v398-testnet-entry-trade24h-6533e4d-20261010.json'
$alreadyActivated=Test-Path -LiteralPath $dest
if($alreadyActivated){$active=Get-Content -LiteralPath $dest -Raw | ConvertFrom-Json;if($active.revoked -ne $false -or $active.sourceSha256 -ne $prep.sourceHash -or $active.artifactSha256 -ne $prep.artifactHash -or $active.settingsVersion -ne $prep.settings.version -or $active.accountScopeHash -ne $signed.accountScopeHash -or $active.operatorApproval -ne 'ONE_TESTNET_ENGINE_SWITCH' -or $active.preparationState -ne 'ACTIVATED_LATEST_DIRECT_USER_ONE_ENGINE_ONLY_RELEASE' -or $active.expiresAt -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()){throw 'EXISTING_THIS_CANDIDATE_ACTIVATION_INVALID'}}
git -C $repo fetch origin
if($LASTEXITCODE -ne 0){throw 'FETCH_FAILED'}
git -C $repo merge-base --is-ancestor origin/main $candidate
if($LASTEXITCODE -ne 0){throw 'MAIN_NOT_FAST_FORWARD'}
git -C $repo push origin ($candidate+':refs/heads/main')
if($LASTEXITCODE -ne 0){throw 'MAIN_FAST_FORWARD_FAILED'}
$approval.revoked=$false;$approval.preparationState='ACTIVATED_LATEST_DIRECT_USER_ONE_ENGINE_ONLY_RELEASE';$approval.approvedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if(-not $alreadyActivated){[IO.File]::WriteAllText($dest,($approval | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}
$acl=[Security.AccessControl.FileSecurity]::new();$acl.SetAccessRuleProtection($true,$false);foreach($id in @([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','Allow'))};Set-Acl -LiteralPath $dest -AclObject $acl
if((Get-FileHash -LiteralPath $oldEnv.ZDJ_ENTRY_APPROVAL_FILE).Hash -ne $oldHash){throw 'OLD_APPROVAL_CHANGED'}
$receipt=[ordered]@{at=[DateTime]::UtcNow.ToString('o');sourceCommit=$candidate;oldPid=$health.pid;oldHostPid=$process.ParentProcessId;oldInstance=$instance.instanceId;oldBuild=$instance.buildId;newBuild=$prep.buildId;newApprovalFile=$dest;oldApprovalUnchanged=$true;privateAgeMs=$sync.sync.snapshotAgeMs;signedPositions=$signed.nonzeroPositions;signedProtected=@($signed.exactProtection).Count;canTrade=$true;productionWrites=0;blockedProductionAttempts=0;modelProxyPids=@{port8081=$aux[8081];port8083=$aux[8083];port8084=$aux[8084];port20091=$aux[20091]};restartAuthorization='LATEST_USER_ONE_ENGINE_ONLY';long24h='HELD_UNTIL_USER_INSTRUCTION';automaticRetries=0}
$receipt | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $privateRoot 'one-lifecycle-attempt.json') -Encoding utf8
& D:/MITS/scripts/stop-zdj-lan.ps1 -Port 8080 *> (Join-Path $privateRoot 'formal-stop.log')
if($LASTEXITCODE -ne 0){throw 'FORMAL_STOP_FAILED_NO_RETRY'}
if(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue){throw '8080_NOT_FREE'}
$env:ZDJ_HOST='0.0.0.0';$env:ZDJ_PORT='8080';$env:ZDJ_DATA_DIR=$oldEnv.ZDJ_DATA_DIR;$env:ZDJ_CONFIG_DIR=Join-Path $stage 'config';$env:ZDJ_START_REASON='MANUAL_START';$env:ZDJ_ENTRY_ADMISSION_DISABLED='0';$env:ZDJ_ENTRY_EXECUTION_POLICY='TESTNET_ENTRY_ENABLED';$env:ZDJ_ENTRY_APPROVAL_FILE=$dest;$env:ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256=$prep.artifactHash
$hostScript=Join-Path $stage 'scripts/start-zdj-engine-host.ps1';$node=(Get-Command node.exe).Source;$launchId='v398-trade24h-6533e4d-20261010-one'
$args=@('-NoProfile','-File',$hostScript,'-NodePath',$node,'-EnginePath',(Join-Path $stage 'apps/engine/dist/main.js'),'-WorkingDirectory',(Join-Path $stage 'apps/engine'),'-StdoutPath',(Join-Path $privateRoot 'new-engine.stdout.log'),'-StderrPath',(Join-Path $privateRoot 'new-engine.stderr.log'),'-LifecyclePath',(Join-Path $privateRoot 'new-engine-lifecycle.jsonl'),'-ReceiptPath',(Join-Path $privateRoot 'new-engine-receipt.json'),'-LaunchId',$launchId)
$encoded=($args | ForEach-Object {'"'+$_+'"'}) -join ' '
$hostProcess=Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList $encoded -WorkingDirectory $stage -WindowStyle Hidden -PassThru
[ordered]@{at=[DateTime]::UtcNow.ToString('o');hostPid=$hostProcess.Id;launchId=$launchId;stage=$stage;enginePath=(Join-Path $stage 'apps/engine/dist/main.js');automaticRetries=0} | ConvertTo-Json | Set-Content (Join-Path $privateRoot 'new-host-launch.json') -Encoding utf8
Write-Output 'FORMAL_ENGINE_ONLY_SWITCH_DISPATCHED_ONCE'
