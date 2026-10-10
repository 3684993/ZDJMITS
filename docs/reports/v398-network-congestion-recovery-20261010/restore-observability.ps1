[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference='Stop'
$release=Get-Content -LiteralPath $Manifest -Raw|ConvertFrom-Json
$gpuRoot='D:\MITS-OPERATIONS\v398-cockpit-gpu-20261010\gpu'
$pwsh=(Get-Command pwsh.exe -ErrorAction Stop).Source
$launcher=Join-Path $gpuRoot 'gpu-sampler-launcher.vbs'
Copy-Item -LiteralPath $launcher -Destination (Join-Path $release.privateRoot 'gpu-launcher-before.vbs')
$command='"'+$pwsh+'" -NoProfile -File "'+(Join-Path $release.stage 'scripts/performance/manage-gpu-sampler.ps1')+'" -Mode Run -OutputDirectory "'+$gpuRoot+'"'
$vbs="Dim shell, result`r`nSet shell = CreateObject(`"WScript.Shell`")`r`nresult = shell.Run(`""+$command.Replace('"','""')+"`", 0, True)`r`nWScript.Quit result`r`n"
[IO.File]::WriteAllText($launcher,$vbs,[Text.Encoding]::Unicode)
& $pwsh -NoProfile -File (Join-Path $release.stage 'scripts/performance/manage-gpu-sampler.ps1') -Mode Start -OutputDirectory $gpuRoot
if($LASTEXITCODE -ne 0){throw 'GPU_SAMPLER_RESTORE_FAILED'}
$bindings=@()
foreach($name in @('ZDJ-MITS Manual Engine','ZDJ-MITS-AfterReboot-TESTNET','ZDJ-MITS-Engine-Crash-Observer')){
 $taskPath=if($name -eq 'ZDJ-MITS-Engine-Crash-Observer'){'\ZDJMITS\'}else{'\'}
 $before=Get-ScheduledTask -TaskName $name -TaskPath $taskPath
 if($before.State -eq 'Running'){throw 'EXISTING_TASK_RUNNING_DO_NOT_OVERWRITE'}
 Export-ScheduledTask -TaskName $name -TaskPath $taskPath|Set-Content (Join-Path $release.privateRoot ($name.Replace(' ','_')+'-before.xml')) -Encoding utf8
 if($name -eq 'ZDJ-MITS-Engine-Crash-Observer'){
  $script=Join-Path $env:LOCALAPPDATA 'ZDJMITS/scripts/observe-zdj-engine-readonly.ps1'
  $arguments='-NoProfile -File "'+$script+'" -FollowCurrentReceipt -HostReceiptPath "'+(Join-Path $release.privateRoot 'engine-receipt.json')+'" -HostLifecyclePath "'+(Join-Path $release.privateRoot 'engine-lifecycle.jsonl')+'" -RepositoryRoot "'+$release.stage+'" -SourceCommit "'+$release.sourceCommit+'" -IntervalSeconds 45 -MaxBytes 25165824'
 }else{
  $script=Join-Path $release.stage 'docs/reports/v398-network-congestion-recovery-20261010/launch-current-reviewed-task.ps1'
  $arguments='-NoProfile -File "'+$script+'" -Manifest "'+[IO.Path]::GetFullPath($Manifest)+'"'
 }
 $action=New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument $arguments -WorkingDirectory $release.stage
 Set-ScheduledTask -TaskName $name -TaskPath $taskPath -Action $action|Out-Null
 & (Join-Path $release.stage 'scripts/set-zdj-scheduled-task-silent.ps1') -TaskName $name -TaskPath $taskPath -OutputDirectory (Join-Path $env:LOCALAPPDATA 'ZDJMITS/task-launchers') -Apply|Out-Null
 $after=Get-ScheduledTask -TaskName $name -TaskPath $taskPath
 if($after.Principal.UserId -ne $before.Principal.UserId -or $after.Settings.RestartCount -ne $before.Settings.RestartCount -or $after.Actions[0].Execute -notmatch 'wscript\.exe$'){throw 'TASK_BINDING_READBACK_FAILED'}
 $bindings+=@{name=$name;path=$taskPath;workingDirectory=$after.Actions[0].WorkingDirectory;hidden=$true;principalPreserved=$true;restartSettingsPreserved=$true;sourceCommit=$release.sourceCommit;engineAutoRestart=$false}
 if($name -eq 'ZDJ-MITS-Engine-Crash-Observer'){Start-ScheduledTask -TaskName $name -TaskPath $taskPath}
}
[IO.File]::WriteAllText((Join-Path $release.privateRoot 'observability-bindings.json'),(@{at=[DateTime]::UtcNow.ToString('o');bindings=$bindings;gpuSampler='DISPATCHED';engineGuardian='MANUAL_START_ONLY_DISABLED_BY_DESIGN';futureTaskEntryMode='ANALYSIS_ONLY_FRESH_TP_REQUIRED'}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
