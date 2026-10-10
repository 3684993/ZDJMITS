$ErrorActionPreference='Stop'
$prep=Get-Content (Join-Path $PSScriptRoot 'immediate-preparation.json') -Raw | ConvertFrom-Json
$signed=Get-Content (Join-Path $PSScriptRoot 'testnet-start-gate.json') -Raw | ConvertFrom-Json
if(@($signed.requests).Count -ne 6 -or @($signed.requests | Where-Object { $_.dispatch.status -ne 200 }).Count -or $signed.protectionAssessment -ne 'SIGNED_EXACT_DUAL_ID_SIDE_QTY_PRICE_MATCH' -or -not $signed.account.walletFactFinite -or -not $signed.account.availableFactFinite -or -not $signed.account.availablePositive){throw 'FRESH_SIGNED_PROTECTION_ACCOUNT_GATE_FAILED'}
$sampleEnd=(@($signed.requests) | Select-Object -Last 1).completedAt
if(([DateTime]::UtcNow-[DateTime]::Parse($sampleEnd).ToUniversalTime()).TotalSeconds -ge 60){throw 'SIGNED_SAMPLE_EXPIRED'}
$health=Invoke-RestMethod http://127.0.0.1:8080/health -TimeoutSec 10
$close=Invoke-RestMethod http://127.0.0.1:8080/api/v3/diagnostics/closeout -TimeoutSec 15
$private=Invoke-RestMethod http://127.0.0.1:8080/api/v3/diagnostics/private-sync -TimeoutSec 10
$instance=Get-Content D:\MITS\data\runtime\engine-instance.json -Raw | ConvertFrom-Json
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$($health.pid)"
if($health.status -ne 'READY' -or $health.pid -ne $instance.pid -or $process.ParentProcessId -ne 23056 -or $process.CommandLine -notmatch 'ZDJMITS-v398-ai-entry-cb0de7b[\\/]apps[\\/]engine[\\/]dist[\\/]main\.js' -or $private.sync.snapshotAgeMs -ge 60000 -or $close.productionWriteBoundary.productionWrites -ne 0 -or -not $close.productionWriteBoundary.lockedToTestnet){throw 'CURRENT_OLD_RUNTIME_SAFETY_GATE_FAILED'}
$prepared=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\issue22-staged-6f228cd-20261010\new-entry-approval.prepared.json'
$record=Get-Content -LiteralPath $prepared -Raw | ConvertFrom-Json
if($record.sourceSha256 -ne $prep.sourceHash -or $record.artifactSha256 -ne $prep.artifactHash -or $record.entrypointSha256 -ne $prep.entrypointSha256 -or $record.settingsVersion -ne $prep.settings.version -or $record.accountScopeHash -ne $signed.accountScopeHash -or $record.expiresAt -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()){throw 'NEW_IDENTITY_APPROVAL_BINDING_INVALID'}
$destination=Join-Path $env:LOCALAPPDATA 'ZDJMITS\entry-authorization\v398-testnet-entry-bb45c11-20261010.json'
if(Test-Path -LiteralPath $destination){throw 'NEW_ACTIVATED_APPROVAL_ALREADY_EXISTS'}
$record.revoked=$false
$record.preparationState='ACTIVATED_BY_LATEST_DIRECT_USER_CONTROLLED_RELEASE_AUTHORIZATION'
$record.approvedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$record | Add-Member qualificationBasis 'OPERATOR_ATTESTED_EXISTING_SINGAPORE_ROUTE; NOT_INDEPENDENT_OFFICIAL_CONFIRMATION' -Force
[IO.File]::WriteAllText($destination,($record | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$privateRoot=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\issue22-cutover-20261010'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
foreach($path in @($destination)+@(Get-ChildItem -LiteralPath $privateRoot -File | Select-Object -ExpandProperty FullName)){
 $acl=[Security.AccessControl.FileSecurity]::new();$acl.SetAccessRuleProtection($true,$false)
 foreach($identity in @($sid,$system)){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','Allow'))}
 Set-Acl -LiteralPath $path -AclObject $acl
}
$result=[ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');approvalFile=$destination;approvalSha256=(Get-FileHash -LiteralPath $destination).Hash;sourceHash=$record.sourceSha256;artifactHash=$record.artifactSha256;settingsVersion=$record.settingsVersion;qualificationBasis=$record.qualificationBasis;oldPid=$health.pid;oldHostPid=$process.ParentProcessId;oldBuild=$health.runtime.buildId;privateAgeMs=$private.sync.snapshotAgeMs;signedPositions=$signed.nonzeroPositions;signedProtected=$signed.exactProtection.Count;productionWrites=$close.productionWriteBoundary.productionWrites;oldApprovalUnmodified=((Get-FileHash (Join-Path $env:LOCALAPPDATA 'ZDJMITS\entry-authorization\v398-testnet-entry.json')).Hash.ToLowerInvariant() -eq $prep.oldApprovalSha256);lifecycleAttempts=0;exchangeWrites=0}
$result | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $PSScriptRoot 'new-approval-activation.json') -Encoding utf8
if(-not $result.oldApprovalUnmodified){throw 'OLD_LIVE_APPROVAL_CHANGED'}
