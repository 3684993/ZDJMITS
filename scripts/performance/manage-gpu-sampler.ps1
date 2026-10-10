param([ValidateSet('Install','Start','Run','Status','Stop')][string]$Mode='Status',
 [Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
if(![IO.Path]::IsPathFullyQualified($OutputDirectory)){throw 'ABSOLUTE_OUTPUT_REQUIRED'}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$taskName='ZDJ-MITS-GPU-Sampler'
$taskPath='\ZDJMITS\'
$collector=Join-Path $PSScriptRoot 'collect-windows-gpu.ps1'
$ownerFile=Join-Path $OutputDirectory 'owner.json'
$pwsh=(Get-Process -Id $PID).Path
function Owner {
 if(!(Test-Path $ownerFile)){return $null}
 $o=Get-Content $ownerFile -Raw | ConvertFrom-Json
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($o.pid)"
 if(!$p){return $null}
 if($p.ExecutablePath -ne $o.executable -or [Math]::Abs(($p.CreationDate.ToUniversalTime()-([DateTimeOffset]$o.startedAt).UtcDateTime).TotalMilliseconds) -gt 1 -or !$p.CommandLine.Replace('/','\').Contains($collector.Replace('/','\'))){throw 'SAMPLER_PROCESS_IDENTITY_MISMATCH'}
 return $o
}
if($Mode -eq 'Status'){Owner | ConvertTo-Json;exit}
if($Mode -eq 'Start'){
 $task=Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath
 $launcher=Join-Path $OutputDirectory 'gpu-sampler-launcher.vbs'
 if($task.Description -notlike 'Read-only WDDM sampler*' -or $task.Actions.Execute -ne "$env:WINDIR/System32/wscript.exe" -or $task.Actions.Arguments -ne "`"$launcher`""){throw 'OWN_TASK_IDENTITY_MISMATCH'}
 $existing=Owner
 if($existing){
  if(Test-Path (Join-Path $OutputDirectory ('stop-'+$existing.instanceId))){throw 'OWNER_STOP_STILL_PENDING'}
  @{at=[DateTimeOffset]::UtcNow.ToString('o');action='Start';result='ALREADY_RUNNING';pid=$existing.pid;actor=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress | Add-Content (Join-Path $OutputDirectory 'operator-audit.jsonl')
  Write-Output 'ALREADY_RUNNING';exit
 }
 [IO.File]::Delete((Join-Path $OutputDirectory 'supervisor-stop'))
 Enable-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Out-Null
 Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
 @{at=[DateTimeOffset]::UtcNow.ToString('o');action='Start';result='TASK_DISPATCHED';actor=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress | Add-Content (Join-Path $OutputDirectory 'operator-audit.jsonl')
 exit
}
if($Mode -eq 'Stop'){
 # Pause the supervisor first; never terminate a PID, model, or Engine.
 Disable-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Out-Null
 [IO.File]::WriteAllText((Join-Path $OutputDirectory 'supervisor-stop'),'operator stop')
 $o=Owner
 if($o){[IO.File]::WriteAllText((Join-Path $OutputDirectory ('stop-'+$o.instanceId)),'operator stop')}
 exit
}
if($Mode -eq 'Install'){
 if(Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue){throw 'TASK_EXISTS_REVIEW_BEFORE_CHANGE'}
 $arguments="-NoProfile -File `"$PSCommandPath`" -Mode Run -OutputDirectory `"$OutputDirectory`""
 [IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
 $launcher=Join-Path $OutputDirectory 'gpu-sampler-launcher.vbs'
 $command='"'+$pwsh+'" '+$arguments
 $vbs="Dim shell, result`r`nSet shell = CreateObject(`"WScript.Shell`")`r`nresult = shell.Run(`""+$command.Replace('"','""')+"`", 0, True)`r`nWScript.Quit result`r`n"
 [IO.File]::WriteAllText($launcher,$vbs,[Text.Encoding]::Unicode)
 $action=New-ScheduledTaskAction -Execute "$env:WINDIR/System32/wscript.exe" -Argument "`"$launcher`"" -WorkingDirectory $OutputDirectory
 $trigger=New-ScheduledTaskTrigger -AtStartup
 $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
 $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -Hidden -StartWhenAvailable
 Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read-only WDDM sampler; bounded supervisor; no trading or model lifecycle actions' | Out-Null
 Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
 exit
}
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$mutex=[Threading.Mutex]::new($false,'Global\ZDJMITS-GPU-SUPERVISOR')
if(!$mutex.WaitOne(0)){throw 'SUPERVISOR_ALREADY_RUNNING'}
try {
 $failures=0
 while(!(Test-Path (Join-Path $OutputDirectory 'supervisor-stop'))){
  $existing=Owner
  if($existing){Start-Sleep -Seconds 15;continue}
  $began=[DateTimeOffset]::UtcNow
  $child=Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile','-File',"`"$collector`"",'-Continuous','-OutputDirectory',"`"$OutputDirectory`"",'-IntervalSeconds','15') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'sampler-stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'sampler-stderr.log')
  $child.WaitForExit()
  @{at=[DateTimeOffset]::UtcNow.ToString('o');pid=$child.Id;exit=$child.ExitCode;startedAt=$began.ToString('o')} | ConvertTo-Json -Compress | Add-Content (Join-Path $OutputDirectory 'supervisor-audit.jsonl')
  if(Test-Path (Join-Path $OutputDirectory 'supervisor-stop')){break}
  $failures++
  if($failures -ge 3){throw 'RESTART_BUDGET_EXHAUSTED_OPERATOR_REQUIRED'}
  Start-Sleep -Seconds ([Math]::Pow(2,$failures)*15)
 }
} finally {$mutex.ReleaseMutex();$mutex.Dispose()}
