$ErrorActionPreference='Stop'
$prep=Get-Content (Join-Path $PSScriptRoot 'immediate-preparation.json') -Raw | ConvertFrom-Json
$activation=Get-Content (Join-Path $PSScriptRoot 'new-approval-activation.json') -Raw | ConvertFrom-Json
if(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue){throw '8080_NOT_FREE_NO_HOT_SWITCH'}
$stage=$prep.stage.Replace('/','\')
$record=Get-Content -LiteralPath $activation.approvalFile -Raw | ConvertFrom-Json
if($record.revoked -ne $false -or $record.artifactSha256 -ne $prep.artifactHash -or $record.sourceSha256 -ne $prep.sourceHash -or $record.expiresAt -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()){throw 'ACTIVATED_IDENTITY_APPROVAL_INVALID'}
$env:ZDJ_HOST='0.0.0.0';$env:ZDJ_PORT='8080';$env:ZDJ_DATA_DIR='D:\MITS\data';$env:ZDJ_CONFIG_DIR=Join-Path $stage 'config';$env:ZDJ_START_REASON='MANUAL_START'
$env:ZDJ_ENTRY_ADMISSION_DISABLED='0';$env:ZDJ_ENTRY_EXECUTION_POLICY='TESTNET_ENTRY_ENABLED';$env:ZDJ_ENTRY_APPROVAL_FILE=$activation.approvalFile;$env:ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256=$prep.artifactHash
$privateRoot=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\issue22-cutover-20261010'
$launchId='v398-approved-bb45c11-20261010-one'
$hostScript=Join-Path $stage 'scripts\start-zdj-engine-host.ps1'
$node=(Get-Command node.exe).Source
$args=@('-NoProfile','-File',$hostScript,'-NodePath',$node,'-EnginePath',(Join-Path $stage 'apps\engine\dist\main.js'),'-WorkingDirectory',(Join-Path $stage 'apps\engine'),'-StdoutPath',(Join-Path $privateRoot ($launchId+'.stdout.log')),'-StderrPath',(Join-Path $privateRoot ($launchId+'.stderr.log')),'-LifecyclePath',(Join-Path $privateRoot 'new-engine-lifecycle.jsonl'),'-ReceiptPath',(Join-Path $privateRoot 'new-engine-receipt.json'),'-LaunchId',$launchId)
$encoded=($args | ForEach-Object {'"'+$_+'"'}) -join ' '
$hostProcess=Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList $encoded -WorkingDirectory $stage -WindowStyle Hidden -PassThru
[ordered]@{attemptedAt=[DateTime]::UtcNow.ToString('o');hostPid=$hostProcess.Id;launchId=$launchId;formalHostScript=$hostScript;enginePath=(Join-Path $stage 'apps\engine\dist\main.js');receiptPath=(Join-Path $privateRoot 'new-engine-receipt.json');lifecyclePath=(Join-Path $privateRoot 'new-engine-lifecycle.jsonl');automaticRetries=0} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'formal-launch-attempt.json') -Encoding utf8
