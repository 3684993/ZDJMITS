param([int]$Samples=121,[int]$IntervalSeconds=15,[Parameter(Mandatory)][string]$OutputDirectory,[switch]$Continuous)
if(![IO.Path]::IsPathFullyQualified($OutputDirectory)){throw 'ABSOLUTE_OPERATIONAL_DIRECTORY_REQUIRED'}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if($OutputDirectory.StartsWith([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')),[StringComparison]::OrdinalIgnoreCase)){throw 'OUTPUT_MUST_NOT_BE_SOURCE_DIRECTORY'}
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$lock=[Threading.Mutex]::new($false,'Global\ZDJMITS-GPU-SAMPLER')
if(!$lock.WaitOne(0)){throw 'SAMPLER_ALREADY_RUNNING'}
try {
$ErrorActionPreference='Stop'
if($Samples -lt 1 -or $Samples -gt 241 -or $IntervalSeconds -lt 10){throw 'Invalid bounded sampling window'}
# Restrict the local sidecar directory to the current operator and SYSTEM.
$acl=[System.Security.AccessControl.DirectorySecurity]::new()
$sid=(Get-Acl -LiteralPath $OutputDirectory).GetOwner([Security.Principal.SecurityIdentifier])
$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
foreach($identity in @($sid,[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)}
Set-Acl -LiteralPath $OutputDirectory -AclObject $acl
# Only local OS counters and existing Engine projections. Never generates model work.
$records=[Collections.Generic.List[object]]::new()
$instanceId=[guid]::NewGuid().ToString()
$self=Get-Process -Id $PID
@{pid=$PID;startedAt=$self.StartTime.ToUniversalTime().ToString('o');executable=$self.Path;script=$PSCommandPath;scriptSha256=(Get-FileHash $PSCommandPath -Algorithm SHA256).Hash;instanceId=$instanceId} | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'owner.json') -Encoding utf8
$stopFile=Join-Path $OutputDirectory ('stop-'+$instanceId)
Add-Type -AssemblyName System.Net.Http
$handler=[System.Net.Http.HttpClientHandler]::new();$handler.UseProxy=$false
$http=[System.Net.Http.HttpClient]::new($handler);$http.Timeout=[TimeSpan]::FromSeconds(4)
$listeners=@()
for($i=0;$Continuous -or $i -lt $Samples;$i++){
  if(Test-Path -LiteralPath $stopFile){break}
  $started=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $startedCpuMs=[Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime.TotalMilliseconds
  $services=@(); $errors=@()
  try {
    $listeners=Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 8081,8083,8084
    $identities=@{}
    foreach($listener in $listeners){$p=Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue;if($p -and [IO.Path]::GetFileName($p.Path) -eq 'llama-server.exe'){$identities[[int]$p.Id]=@{start=$p.StartTime.ToUniversalTime().Ticks;path=$p.Path}}}
    $counterPaths=@($listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      '\GPU Engine(pid_'+$_+'_*)\Utilization Percentage';'\GPU Process Memory(pid_'+$_+'_*)\Dedicated Usage';'\GPU Process Memory(pid_'+$_+'_*)\Shared Usage'
    })
    if(!$counterPaths.Count){throw 'NO_MODEL_LISTENERS'}
    $counters=(Get-Counter $counterPaths -ErrorAction Stop).CounterSamples
    foreach($port in @(8081,8083,8084)){
      $listener=$listeners | Where-Object LocalPort -eq $port | Select-Object -First 1
      $servicePid=if($listener){[int]$listener.OwningProcess}else{$null}
      $process=if($servicePid){Get-Process -Id $servicePid -ErrorAction SilentlyContinue}else{$null}
      $identityOk=$process -and $identities.ContainsKey($servicePid) -and $process.StartTime.ToUniversalTime().Ticks -eq $identities[$servicePid].start -and $process.Path -eq $identities[$servicePid].path
      $currentListener=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      $identityOk=$identityOk -and $currentListener -and [int]$currentListener.OwningProcess -eq $servicePid
      $engines=@($counters | Where-Object { $_.InstanceName -like "pid_${servicePid}_*" -and $_.Path -like '*utilization percentage' })
      $memory=@($counters | Where-Object { $_.InstanceName -like "pid_${servicePid}_*" -and $_.Path -like '*dedicated usage' })
      $shared=@($counters | Where-Object { $_.InstanceName -like "pid_${servicePid}_*" -and $_.Path -like '*shared usage' })
      $luids=@($engines | ForEach-Object { if($_.InstanceName -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)'){ $Matches[1] } } | Sort-Object -Unique)
      $rawUtil=if($engines.Count){[math]::Round(($engines | Measure-Object CookedValue -Maximum).Maximum,3)}else{$null}
      $validUtil=$identityOk -and $null -ne $rawUtil -and !([double]::IsNaN([double]$rawUtil)) -and !([double]::IsInfinity([double]$rawUtil)) -and $rawUtil -ge 0 -and $rawUtil -le 100
      $services+=@{resourceId="llama:$port";port=$port;pid=$servicePid;processStartedAt=if($process){([DateTimeOffset]$process.StartTime).ToUnixTimeMilliseconds()}else{$null};duty=if($port -eq 8081){'SCOUT'}elseif($port -eq 8083){'REVIEW_BRAIN'}else{'PRIMARY_BRAIN'};physicalDeviceIdVerified=$false;physicalDeviceId=$null;luid=$luids;measureStatus=if($validUtil){'MEASURED'}else{'UNKNOWN'};utilizationPct=if($validUtil){$rawUtil}else{$null};rawCounterUtilizationPct=$rawUtil;dedicatedBytes=if($identityOk -and $memory.Count){($memory | Measure-Object CookedValue -Sum).Sum}else{$null};sharedBytes=if($identityOk -and $shared.Count){($shared | Measure-Object CookedValue -Sum).Sum}else{$null}}
    }
  } catch { $errors+=@('OS_COUNTER_UNAVAILABLE') }
  $resources=@()
  try {
    $response=$http.GetStringAsync('http://127.0.0.1:8080/api/v3/brain/resources').GetAwaiter().GetResult() | ConvertFrom-Json
    $resources=@($response | ForEach-Object { @{id=$_.id;role=$_.role;active=$_.active;queueDepth=$_.queueDepth;totalRuns=$_.totalRuns;failures=$_.failures;lastLatencyMs=$_.lastLatencyMs;healthCheckedAt=$_.healthCheckedAt;currentStatus=$_.currentStatus;idleReason=$_.idleReason} })
  } catch { $errors+=@('ENGINE_PROJECTION_UNAVAILABLE') }
  $snapshot=@{schemaVersion=1;asOf=$started;instanceId=$instanceId;sampleSource='WINDOWS_WDDM_PROCESS_COUNTERS';ttlMs=45000;services=$services;resources=$resources;errors=$errors;collectionMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$started;collectionCpuMs=[Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime.TotalMilliseconds-$startedCpuMs}
  $records.Add($snapshot)
  if($records.Count -gt 361){$records.RemoveAt(0)}
  # Same-directory ordinary logs; atomic swap avoids torn reads. Bounded <=241 samples.
  $json=$snapshot | ConvertTo-Json -Depth 8
  if([Text.Encoding]::UTF8.GetByteCount($json) -gt 65536){throw 'SNAPSHOT_TOO_LARGE'}
  $json | Set-Content -LiteralPath "$OutputDirectory/gpu-snapshot.tmp" -Encoding UTF8
  if(Test-Path -LiteralPath "$OutputDirectory/gpu-snapshot.json"){[IO.File]::Replace("$OutputDirectory/gpu-snapshot.tmp","$OutputDirectory/gpu-snapshot.json",[NullString]::Value)}else{[IO.File]::Move("$OutputDirectory/gpu-snapshot.tmp","$OutputDirectory/gpu-snapshot.json")}
  $records.ToArray() | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$OutputDirectory/gpu-baseline.json" -Encoding UTF8
  if($Continuous -or $i+1 -lt $Samples){$remaining=$IntervalSeconds*1000-([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$started);if($remaining -gt 0){Start-Sleep -Milliseconds $remaining}}
}
$http.Dispose();$handler.Dispose()

} finally { $lock.ReleaseMutex();$lock.Dispose() }
