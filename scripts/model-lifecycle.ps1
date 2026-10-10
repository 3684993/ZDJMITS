param([Parameter(Mandatory)][string]$Manifest,[Parameter(Mandatory)][string]$ResourceId,[ValidateSet('status','start','stop','restart')][string]$Action='status',[int]$ExpectedPid=0,[string]$ExpectedStartUtc='',[int]$ExpectedEnginePid=0)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not [IO.Path]::IsPathRooted($Manifest)){throw 'MANIFEST_ABSOLUTE_PATH_REQUIRED'}
$config=Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$entries=@($config.models | Where-Object { $_.id -ceq $ResourceId })
if($entries.Count -ne 1){throw 'MODEL_NOT_MANAGED'}
$entry=$entries[0]
foreach($file in @($entry.launcher,$entry.executable,$entry.stateFile,$entry.logRoot,$entry.modelPath)){if(-not [IO.Path]::IsPathRooted($file)){throw 'CONFIG_PATH_NOT_ABSOLUTE'}}
if((Get-FileHash -LiteralPath $entry.launcher -Algorithm SHA256).Hash -ine $entry.launcherSha256){throw 'LAUNCHER_HASH_MISMATCH'}
if((Get-FileHash -LiteralPath $entry.executable -Algorithm SHA256).Hash -ine $entry.executableSha256){throw 'EXECUTABLE_HASH_MISMATCH'}
if(-not (Test-Path -LiteralPath $entry.modelPath -PathType Leaf)){throw 'MODEL_FILE_MISSING'}
function Read-Status {
  $state=if(Test-Path -LiteralPath $entry.stateFile){Get-Content -LiteralPath $entry.stateFile -Raw | ConvertFrom-Json}else{$null}
  $owners=@(Get-NetTCPConnection -State Listen -LocalPort $entry.port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  $matches=@(Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.CommandLine -match ('(?:^|\s)--port(?:\s+|=)'+$entry.port+'(?:\s|$)') })
  $proc=if($matches.Count -eq 1){$matches[0]}else{$null}
  $verified=$null -ne $proc -and $proc.ExecutablePath -ieq $entry.executable -and $proc.CommandLine -match [regex]::Escape($entry.modelPath) -and $null -ne $state -and $state.pid -eq $proc.ProcessId -and $state.port -eq $entry.port -and $state.physicalDevice -ceq $entry.physicalDevice
  if($verified){$created=(Get-Process -Id $proc.ProcessId).StartTime.ToUniversalTime();$recorded=([DateTimeOffset]$state.startedAt).UtcDateTime;$verified=[math]::Abs(($recorded-$created).TotalSeconds) -le 2 -and $state.modelPath -ieq $entry.modelPath}
  $logs=@()
  if($state){foreach($name in @('stdout','stderr')){ $file=[IO.Path]::GetFullPath([string]$state.$name); if($file.StartsWith([IO.Path]::GetFullPath($entry.logRoot).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file)){ $logs+=@(Get-Content -LiteralPath $file -Tail 40 | Where-Object { $_ -match 'load_tensors|buffer size|Vulkan|listening|error|fatal|memory|context' } | Select-Object -Last 12 | ForEach-Object { ($_ -replace '(?i)(api[_-]?key|secret|authorization|signature)[=: ]+\S+','$1=[REDACTED]') }) }}}
  $processStarted=if($proc){(Get-Process -Id $proc.ProcessId).StartTime.ToUniversalTime().ToString('o')}else{$null}
  $health='UNKNOWN';if($owners.Count -eq 1 -and $verified -and $owners[0] -eq $proc.ProcessId){try{$h=Invoke-RestMethod "http://127.0.0.1:$($entry.port)/health" -TimeoutSec 3;$health=if($h.status -eq 'ok'){'READY'}else{'DEGRADED'}}catch{$health='PROBE_FAILED'}}
  return [ordered]@{id=$ResourceId;model=$entry.model;port=$entry.port;pid=if($proc){[int]$proc.ProcessId}else{$null};processStartedAt=$processStarted;identityVerified=$verified;status=if(-not $proc -and -not $owners.Count){'STOPPED'}elseif(-not $verified){'IDENTITY_MISMATCH'}else{$health};gpu=if($state){$state.gpu}else{$null};physicalDevice=$entry.physicalDevice;startupLog=$logs;dedicatedBytes=$null;memorySource='USE_FRESH_WDDM_SNAPSHOT';}
}
$before=Read-Status
if($Action -eq 'status'){$before | ConvertTo-Json -Depth 6 -Compress;exit 0}
if($ExpectedEnginePid -le 0 -or -not @(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $ExpectedEnginePid).Count){throw 'MODEL_ENGINE_COORDINATION_UNKNOWN'}
$watchers=@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | Where-Object { $_.CommandLine -match '(?i)-Mode\s+Watch' -and $_.CommandLine -match [regex]::Escape([IO.Path]::GetFileNameWithoutExtension($entry.launcher)) })
if($watchers.Count){throw 'MODEL_WATCHDOG_REQUIRES_COORDINATION'}
if($before.status -eq 'IDENTITY_MISMATCH'){throw 'MODEL_PROCESS_IDENTITY_UNVERIFIED'}
if($Action -eq 'start' -and $before.pid){throw 'MODEL_ALREADY_RUNNING'}
if($Action -in @('stop','restart') -and $before.pid){
  if(-not $before.identityVerified -or $ExpectedPid -ne $before.pid -or $ExpectedStartUtc -cne $before.processStartedAt){throw 'MODEL_PROCESS_IDENTITY_CHANGED'}
  # No forceful interruption of work observed outside the Engine scheduler.
  $slots=Invoke-RestMethod "http://127.0.0.1:$($entry.port)/slots" -TimeoutSec 3
  if(-not @($slots).Count -or @($slots | Where-Object { $_.is_processing -ne $false }).Count){throw 'MODEL_SLOT_BUSY_OR_UNKNOWN'}
  $otherClients=@(Get-NetTCPConnection -State Established -RemotePort $entry.port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne $ExpectedEnginePid -and $_.OwningProcess -ne $PID })
  if($otherClients.Count){throw 'MODEL_UNCOORDINATED_CLIENT_PRESENT'}
  $last=Read-Status
  if($last.pid -ne $ExpectedPid -or $last.processStartedAt -cne $ExpectedStartUtc -or -not $last.identityVerified){throw 'MODEL_IDENTITY_RACE'}
  Stop-Process -Id $ExpectedPid -ErrorAction Stop
  $deadline=(Get-Date).AddSeconds(15)
  while((Get-Process -Id $ExpectedPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 250}
  if(Get-Process -Id $ExpectedPid -ErrorAction SilentlyContinue){throw 'MODEL_STOP_UNCONFIRMED'}
}
if($Action -in @('start','restart')){
  if((Read-Status).pid){throw 'MODEL_START_PORT_RACE'}
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $logDir=Split-Path -Parent $Manifest
  $stdout=Join-Path $logDir "model-$($entry.port)-$stamp.stdout.log"
  $stderr=Join-Path $logDir "model-$($entry.port)-$stamp.stderr.log"
  # Only a sealed operator launcher receives fixed arguments. No browser command or path is accepted.
  $launcher=Start-Process (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile','-NonInteractive','-File',('"'+$entry.launcher+'"'),'-Mode','Start','-NoWatchdog') -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  if(-not $launcher.WaitForExit(300000)){throw 'MODEL_START_TIMEOUT_OUTCOME_UNKNOWN'}
  if($launcher.ExitCode -ne 0){throw 'MODEL_LAUNCH_FAILED_INSPECT_PRIVATE_LOG'}
}
$after=Read-Status
if($Action -eq 'stop' -and $after.status -ne 'STOPPED'){throw 'MODEL_STOP_UNCONFIRMED'}
if($Action -ne 'stop' -and $after.status -ne 'READY'){throw 'MODEL_START_NOT_READY'}
$after | ConvertTo-Json -Depth 6 -Compress
