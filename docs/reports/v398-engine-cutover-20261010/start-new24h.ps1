$ErrorActionPreference='Stop'
$proof=Get-Content (Join-Path $PSScriptRoot 'post-start-identity.json') -Raw | ConvertFrom-Json
if($proof.verdict -ne 'IDENTITY_CLOSED_6_OF_6' -or @($proof.checks.PSObject.Properties | Where-Object Value -ne $true).Count -or @($proof.safety.PSObject.Properties | Where-Object Value -ne $true).Count){throw 'ALL_IDENTITY_SAFETY_GATES_NOT_CLOSED'}
$delay=([DateTime]::UtcNow-[DateTime]::Parse($proof.observedAt).ToUniversalTime()).TotalMilliseconds
if($proof.signed.signedAgeMs+$delay -ge 60000 -or $proof.signed.permissionAgeMs+$delay -ge 60000){throw 'FINAL_SIGNED_SAFETY_SAMPLE_EXPIRED'}
$reboot=Get-Content (Join-Path $PSScriptRoot 'reboot-task-readback.json') -Raw | ConvertFrom-Json
if($reboot.hiddenWscript -ne $true -or $reboot.newStableRoot -ne 'D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd'){throw 'NEW_REBOOT_IDENTITY_NOT_BOUND'}
$observer=@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match '-File\s+"[^"\r\n]*observe-zdj-engine-readonly\.ps1".*issue22-cutover-20261010' })
if($observer.Count -ne 1){throw 'NEW_OBSERVER_NOT_PROVEN_RUNNING'}
$out=Join-Path $PSScriptRoot 'acceptance'
if(Test-Path (Join-Path $out 'baseline.json')){throw 'ACCEPTANCE_BASELINE_EXISTS_NEVER_REUSE_T0'}
$now=[DateTimeOffset]::UtcNow;$deadline=$now.AddHours(24)
$baseline=[ordered]@{t0=$now.ToString('o');t0China=$now.ToOffset([TimeSpan]::FromHours(8)).ToString('o');t0Ms=$now.ToUnixTimeMilliseconds();deadline=$deadline.ToString('o');deadlineChina=$deadline.ToOffset([TimeSpan]::FromHours(8)).ToString('o');deadlineMs=$deadline.ToUnixTimeMilliseconds();pid=$proof.identity.pid;hostPid=$proof.identity.hostPid;instanceId=$proof.identity.instanceId;buildId=$proof.identity.buildId;sourceHash=$proof.identity.sourceHash;artifactHash=$proof.identity.artifactHash;frozenSourceCommit=$proof.frozenSourceCommit;mainAtStart=$proof.currentMain;settingsVersion=$proof.settings.version;settingsHash=$proof.settings.payloadSha256;signedBaselinePositions=$proof.signed.positions;signedBaselineProtected=$proof.signed.protected;canTrade=$proof.signed.canTrade;qualificationBasis=$proof.qualificationBasis;observerPid=$observer[0].ProcessId;auxiliaryPids=@{'8081'=3400;'8083'=14020;'8084'=22336;'20091'=18300};intervalSeconds=60;noForcedAnalysisOrOrders=$true;restartRule='Any abort/fix/redeploy requires a complete new24h after all gates'}
$baseline | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $out 'baseline.json') -Encoding utf8
[ordered]@{status='RUNNING';t0=$baseline.t0;deadline=$baseline.deadline;acceptanceVerdict='IN_PROGRESS_NOT_PASS';lastCheckpoint=$null} | ConvertTo-Json | Set-Content (Join-Path $out 'state.json') -Encoding utf8
$taskName='ZDJ-V398-24h-20261010';$taskPath='\ZDJMITS\'
$trigger=New-ScheduledTaskTrigger -Once -At ((Get-Date).AddSeconds(10)) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Hours 25)
Set-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Trigger $trigger | Out-Null
Enable-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Out-Null
Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
[ordered]@{startedAt=$baseline.t0;deadline=$baseline.deadline;taskName=$taskName;taskPath=$taskPath;hiddenWscript=$true;newObserverPid=$observer[0].ProcessId;collectorIntervalSeconds=60;engineStartsThisAction=0;taskExchangeWrites=0} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'acceptance-started.json') -Encoding utf8
