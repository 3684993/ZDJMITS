param([int]$Samples=241,[int]$IntervalSeconds=15)
$snapshotOutputRoot='D:/MITS-RELEASES/ZDJMITS-v398-trade24h-6533e4d/apps/engine/scripts/performance'
$ErrorActionPreference='Stop'
if($Samples -lt 1 -or $Samples -gt 241 -or $IntervalSeconds -lt 10){throw 'Invalid bounded sampling window'}
# Restrict the local sidecar directory to the current operator and SYSTEM.
$acl=[System.Security.AccessControl.DirectorySecurity]::new()
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
foreach($identity in @($sid,[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)}
Set-Acl -LiteralPath $snapshotOutputRoot -AclObject $acl
# Only local OS counters and existing Engine projections. Never generates model work.
$records=[Collections.Generic.List[object]]::new()
$instanceId=[guid]::NewGuid().ToString()
Add-Type -AssemblyName System.Net.Http
$handler=[System.Net.Http.HttpClientHandler]::new();$handler.UseProxy=$false
$http=[System.Net.Http.HttpClient]::new($handler);$http.Timeout=[TimeSpan]::FromSeconds(4)
$listeners=@()
for($i=0;$i -lt $Samples;$i++){
  $started=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $startedCpuMs=[Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime.TotalMilliseconds
  $services=@(); $errors=@()
  try {
    if($i%4 -eq 0){$listeners=Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 8081,8083,8084}
    $counterPaths=@($listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      '\GPU Engine(pid_'+$_+'_*)\Utilization Percentage';'\GPU Process Memory(pid_'+$_+'_*)\Dedicated Usage';'\GPU Process Memory(pid_'+$_+'_*)\Shared Usage'
    })
    if(!$counterPaths.Count){throw 'NO_MODEL_LISTENERS'}
    $counters=(Get-Counter $counterPaths -ErrorAction Stop).CounterSamples
    foreach($port in @(8081,8083,8084)){
      $listener=$listeners | Where-Object LocalPort -eq $port | Select-Object -First 1
      $servicePid=if($listener){[int]$listener.OwningProcess}else{$null}
      $process=if($servicePid){Get-Process -Id $servicePid -ErrorAction SilentlyContinue}else{$null}
      $engines=@($counters | Where-Object { $_.InstanceName -like "pid_${servicePid}_*" -and $_.Path -like '*utilization percentage' })
      $memory=@($counters | Where-Object { $_.InstanceName -like "pid_${servicePid}_*" -and $_.Path -like '*dedicated usage' })
      $shared=@($counters | Where-Object { $_.InstanceName -like "pid_${servicePid}_*" -and $_.Path -like '*shared usage' })
      $luids=@($engines | ForEach-Object { if($_.InstanceName -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)'){ $Matches[1] } } | Sort-Object -Unique)
      $rawUtil=if($engines.Count){[math]::Round(($engines | Measure-Object CookedValue -Maximum).Maximum,3)}else{$null}
      $validUtil=$null -ne $rawUtil -and !([double]::IsNaN([double]$rawUtil)) -and !([double]::IsInfinity([double]$rawUtil)) -and $rawUtil -ge 0 -and $rawUtil -le 100
      $services+=@{resourceId="llama:$port";port=$port;pid=$servicePid;processStartedAt=if($process){([DateTimeOffset]$process.StartTime).ToUnixTimeMilliseconds()}else{$null};duty=if($port -eq 8081){'SCOUT'}elseif($port -eq 8083){'REVIEW_BRAIN'}else{'PRIMARY_BRAIN'};physicalDeviceIdVerified=$false;physicalDeviceId=$null;luid=$luids;measureStatus=if($validUtil){'MEASURED'}else{'UNKNOWN'};utilizationPct=if($validUtil){$rawUtil}else{$null};rawCounterUtilizationPct=$rawUtil;dedicatedBytes=if($memory.Count){($memory | Measure-Object CookedValue -Sum).Sum}else{$null};sharedBytes=if($shared.Count){($shared | Measure-Object CookedValue -Sum).Sum}else{$null}}
    }
  } catch { $errors+=@('OS_COUNTER_UNAVAILABLE') }
  $resources=@()
  try {
    $response=$http.GetStringAsync('http://127.0.0.1:8080/api/v3/brain/resources').GetAwaiter().GetResult() | ConvertFrom-Json
    $resources=@($response | ForEach-Object { @{id=$_.id;role=$_.role;active=$_.active;queueDepth=$_.queueDepth;totalRuns=$_.totalRuns;failures=$_.failures;lastLatencyMs=$_.lastLatencyMs;healthCheckedAt=$_.healthCheckedAt;currentStatus=$_.currentStatus;idleReason=$_.idleReason} })
  } catch { $errors+=@('ENGINE_PROJECTION_UNAVAILABLE') }
  $snapshot=@{schemaVersion=1;asOf=$started;instanceId=$instanceId;sampleSource='WINDOWS_WDDM_PROCESS_COUNTERS';ttlMs=45000;services=$services;resources=$resources;errors=$errors;collectionMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$started;collectionCpuMs=[Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime.TotalMilliseconds-$startedCpuMs}
  $records.Add($snapshot)
  # Same-directory ordinary logs; atomic swap avoids torn reads. Bounded <=241 samples.
  $snapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$snapshotOutputRoot/gpu-snapshot.tmp" -Encoding UTF8
  if(Test-Path -LiteralPath "$snapshotOutputRoot/gpu-snapshot.json"){[IO.File]::Replace("$snapshotOutputRoot/gpu-snapshot.tmp","$snapshotOutputRoot/gpu-snapshot.json",[NullString]::Value)}else{[IO.File]::Move("$snapshotOutputRoot/gpu-snapshot.tmp","$snapshotOutputRoot/gpu-snapshot.json")}
  $records.ToArray() | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$snapshotOutputRoot/gpu-baseline.json" -Encoding UTF8
  if($i+1 -lt $Samples){$remaining=$IntervalSeconds*1000-([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$started);if($remaining -gt 0){Start-Sleep -Milliseconds $remaining}}
}
$http.Dispose();$handler.Dispose()
