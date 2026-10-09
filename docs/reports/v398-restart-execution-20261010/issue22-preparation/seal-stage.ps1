$ErrorActionPreference='Stop'
$stage='D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd'
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'staged-release.json') -Raw | ConvertFrom-Json
$sealed=0
foreach($property in $manifest.files.PSObject.Properties){
 $file=[IO.Path]::GetFullPath((Join-Path $stage $property.Name))
 if(-not $file.StartsWith($stage+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'SEAL_TARGET_OUTSIDE_STAGE'}
 if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $property.Value){throw ('STAGE_FILE_CHANGED:'+ $property.Name)}
 $item=Get-Item -LiteralPath $file;$item.IsReadOnly=$true;$sealed++
}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$tracked=@(git -C $stage -c core.quotepath=false ls-files)
if($LASTEXITCODE -ne 0){throw 'TRACKED_FILE_LIST_FAILED'}
foreach($relative in $tracked){$item=Get-Item -LiteralPath (Join-Path $stage $relative);if(-not $item.IsReadOnly){$item.IsReadOnly=$true;$sealed++}}
$privateDir=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\issue22-staged-6f228cd-20261010'
$oldApproval=Join-Path $env:LOCALAPPDATA 'ZDJMITS\entry-authorization\v398-testnet-entry.json'
$oldApprovalBefore=(Get-FileHash -LiteralPath $oldApproval -Algorithm SHA256).Hash
$evidenceFiles=@{
 'old-entry-approval.json'=$oldApproval
 'old-engine-instance.json'='D:\MITS\data\runtime\engine-instance.json'
 'old-engine-host-receipt.json'=(Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\testnet-entry-cutover-20261009\new-engine-receipt.json')
}
$privateHashes=@{}
foreach($name in $evidenceFiles.Keys){$to=Join-Path $privateDir $name;if(Test-Path -LiteralPath $to){if((Get-FileHash -LiteralPath $to).Hash -ne (Get-FileHash -LiteralPath $evidenceFiles[$name]).Hash){throw 'EXISTING_ROLLBACK_SNAPSHOT_CHANGED_REFUSE_OVERWRITE'}}else{Copy-Item -LiteralPath $evidenceFiles[$name] -Destination $to};$privateHashes[$name]=(Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash}
$userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
foreach($item in Get-ChildItem -LiteralPath $privateDir -File){
 $acl=New-Object Security.AccessControl.FileSecurity
 $acl.SetAccessRuleProtection($true,$false)
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($userSid,'FullControl','Allow')))
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($systemSid,'FullControl','Allow')))
 Set-Acl -LiteralPath $item.FullName -AclObject $acl
 $readback=Get-Acl -LiteralPath $item.FullName
 $rules=@($readback.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if(-not $readback.AreAccessRulesProtected -or $rules.Count -ne 2 -or @($rules | Where-Object { $_.IdentityReference.Value -notin @($userSid.Value,$systemSid.Value) -or $_.AccessControlType -ne 'Allow' }).Count){throw 'PRIVATE_ACL_READBACK_FAILED'}
}
if((Get-FileHash -LiteralPath $oldApproval -Algorithm SHA256).Hash -ne $oldApprovalBefore){throw 'LIVE_APPROVAL_CHANGED'}
[ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');stagePath=$stage;manifestVerifiedFiles=@($manifest.files.PSObject.Properties).Count;sealedReadOnlyFiles=$sealed;sealMechanism='ReadOnly file attributes plus exact per-file SHA256 and pinned clean Git source; reverify before activation';stageGitStatus=(git -C $stage status --porcelain | Out-String).Trim();privateEvidenceAcl='Current user and SYSTEM only';privateRollbackSnapshotHashes=$privateHashes;oldLiveApprovalSha256=$oldApprovalBefore;oldLiveApprovalUnmodified=$true;runtimeDataJunctionCreated=$false;lifecycleChanges=0} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'stage-seal-proof.json') -Encoding utf8
