[CmdletBinding()]
param(
  [switch]$FollowCurrentReceipt,
  [int]$EnginePid,
  [string]$InstanceId,
  [string]$BuildId,
  [int]$HostPid,
  [long]$StartedAtUnixMs,
  [string]$IdentityPath='D:\MITS\data\runtime\engine-instance.json',
  [string]$HostReceiptPath=(Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\reboot-orchestration\engine\current-receipt.json'),
  [string]$HostLifecyclePath=(Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\reboot-orchestration\engine\lifecycle.jsonl'),
  [string]$ProcessLifecyclePath='D:\MITS\data\runtime-logs\engine-process-lifecycle.jsonl',
  [string]$RuntimeLogDirectory='D:\MITS\data\runtime-logs',
  [string]$DataDirectory='D:\MITS\data',
  [string]$RepositoryRoot='',
  [string]$SourceCommit='',
  [string]$StdoutPath='',
  [string]$StderrPath='',
  [string]$OutputRoot=(Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\engine-observer'),
  [ValidateRange(15,300)][int]$IntervalSeconds=45,
  [ValidateRange(1,60)][int]$WaitForLaunchMinutes=30,
  [ValidateRange(1048576,268435456)][long]$MaxBytes=25165824,
  [switch]$Once
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Read-Json([string]$Path){if(Test-Path -LiteralPath $Path){try{return Get-Content -LiteralPath $Path -Raw|ConvertFrom-Json}catch{return $null}};return $null}
function Get-EngineRepositoryRoot([string]$Path){$root=Split-Path -Path $Path -Parent;for($i=0;$i -lt 4;$i++){$root=Split-Path -Path $root -Parent};return $root}
function Get-ProcessFact([int]$Id){
  if($Id -le 0){return $null}
  $p=Get-Process -Id $Id -ErrorAction SilentlyContinue
  if(-not $p){return $null}
  $c=Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction SilentlyContinue
  return [pscustomobject]@{pid=$Id;startTime=$p.StartTime.ToUniversalTime().ToString('o');privateBytes=[long]$p.PrivateMemorySize64;workingSet=[long]$p.WorkingSet64;handles=[int]$p.HandleCount;path=[string]$p.Path;parentPid=if($c){[int]$c.ParentProcessId}else{$null}}
}
function Get-ListenerOwner([int]$Port){
  $rows=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique)
  return @($rows|ForEach-Object{Get-ProcessFact ([int]$_)})
}
function Get-NewEventFacts([string]$LogName,[int[]]$Ids,[long]$AfterRecordId){
  try{
    $events=@(Get-WinEvent -FilterHashtable @{LogName=$LogName;Id=$Ids} -MaxEvents 20 -ErrorAction Stop|Where-Object {[long]$_.RecordId -gt $AfterRecordId}|Sort-Object RecordId)
    return [pscustomobject]@{status='READ';items=@($events|ForEach-Object{[pscustomobject]@{recordId=[long]$_.RecordId;timeUtc=$_.TimeCreated.ToUniversalTime().ToString('o');id=[int]$_.Id;provider=[string]$_.ProviderName;level=[string]$_.LevelDisplayName}});lastRecordId=if($events.Count){[long]$events[-1].RecordId}else{$AfterRecordId}}
  }catch{return [pscustomobject]@{status='UNAVAILABLE';items=@();lastRecordId=$AfterRecordId;errorType=$_.Exception.GetType().Name}}
}
function Write-Jsonl([IO.StreamWriter]$Writer,[object]$Value){
  $line=ConvertTo-Json -InputObject $Value -Depth 8 -Compress
  $Writer.WriteLine($line);$Writer.Flush();$Writer.BaseStream.Flush($true)
}
function Read-TailLifecycle([string]$Path,[int]$TargetPid,[string]$TargetInstance){
  if(-not(Test-Path -LiteralPath $Path)){return [pscustomobject]@{status='NOT_FOUND';matched=@()}}
  $items=@(Get-Content -LiteralPath $Path -Tail 5000|ForEach-Object{try{$x=$_|ConvertFrom-Json;if(([int]$x.pid -eq $TargetPid)-or([int]$x.payload.pid -eq $TargetPid)-or([string]$x.instanceId -eq $TargetInstance)){[pscustomobject]@{ts=$x.ts;timestamp=$x.timestamp;event=$x.event;pid=$x.pid;exitCode=$x.code;payloadPid=$x.payload.pid}}}catch{}}|Where-Object{$_})
  return [pscustomobject]@{status='READ';matched=@($items|Select-Object -Last 20)}
}
function Pin-Target{
  if($FollowCurrentReceipt){
    $receipt=Read-Json $HostReceiptPath;$identity=Read-Json $IdentityPath
    if(-not $receipt -or -not $identity){return $null}
    $pidValue=[int]$receipt.pid;$hostValue=[int]$receipt.hostPid
    if($pidValue -le 0 -or [int]$identity.pid -ne $pidValue){return $null}
    $live=Get-ProcessFact $pidValue
    if(-not $live -or [IO.Path]::GetFileName($live.path) -ine 'node.exe'){return $null}
    $receiptStart=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$receipt.startedAt).UtcDateTime
    $liveStart=[DateTimeOffset]::Parse($live.startTime).UtcDateTime
    $startDelta=[Math]::Abs(($liveStart-$receiptStart).TotalSeconds)
    if($startDelta -gt 5){return $null}
    if([int]$live.parentPid -ne $hostValue -or ($BuildId -and [string]$identity.buildId -ne [string]$BuildId)){return $null}
    $root=$RepositoryRoot
    if([string]::IsNullOrWhiteSpace($root)){$root=Get-EngineRepositoryRoot ([string]$receipt.enginePath)}
    $commitProperty=$identity.PSObject.Properties['sourceCommit']
    $commit=if($commitProperty -and $commitProperty.Value){[string]$commitProperty.Value}elseif($SourceCommit){$SourceCommit}elseif(Test-Path (Join-Path $root '.git')){(& git -C $root rev-parse HEAD 2>$null|Select-Object -First 1)}else{'SOURCE_COMMIT_NOT_RECORDED'}
    $hostDir=Split-Path -Path $HostReceiptPath -Parent
    return [pscustomobject]@{pid=$pidValue;hostPid=$hostValue;instanceId=[string]$identity.instanceId;buildId=[string]$identity.buildId;startedAtUnixMs=[long]$identity.startedAt;creationTimeUtc=$live.startTime;enginePath=[string]$receipt.enginePath;launchId=[string]$receipt.launchId;sourceCommit=$commit;repositoryRoot=$root;stdoutPath=(Join-Path $hostDir ($receipt.launchId+'.stdout.log'));stderrPath=(Join-Path $hostDir ($receipt.launchId+'.stderr.log'))}
  }
  $live=Get-ProcessFact $EnginePid
  if(-not $live -or [int]$live.parentPid -ne $HostPid){return $null}
  $identity=Read-Json $IdentityPath
  if(-not $identity -or [int]$identity.pid -ne $EnginePid -or [string]$identity.instanceId -ne $InstanceId -or [string]$identity.buildId -ne $BuildId -or [long]$identity.startedAt -ne $StartedAtUnixMs){return $null}
  $receipt=Read-Json $HostReceiptPath
  $commitProperty=$identity.PSObject.Properties['sourceCommit']
  $commit=if($commitProperty -and $commitProperty.Value){[string]$commitProperty.Value}elseif($SourceCommit){$SourceCommit}else{'SOURCE_COMMIT_NOT_RECORDED'}
  $hostDir=Split-Path -Path $HostReceiptPath -Parent
  return [pscustomobject]@{pid=$EnginePid;hostPid=$HostPid;instanceId=$InstanceId;buildId=$BuildId;startedAtUnixMs=$StartedAtUnixMs;creationTimeUtc=$live.startTime;enginePath=[string]$receipt.enginePath;launchId=[string]$receipt.launchId;sourceCommit=$commit;repositoryRoot=$RepositoryRoot;stdoutPath=(Join-Path $hostDir ($receipt.launchId+'.stdout.log'));stderrPath=(Join-Path $hostDir ($receipt.launchId+'.stderr.log'))}
}

if(-not $FollowCurrentReceipt -and ($EnginePid -le 0 -or [string]::IsNullOrWhiteSpace($InstanceId) -or [string]::IsNullOrWhiteSpace($BuildId) -or $HostPid -le 0 -or $StartedAtUnixMs -le 0)){throw 'EXACT_ENGINE_IDENTITY_REQUIRED'}
$identity=Read-Json $IdentityPath
$sourceCommitProperty=if($identity){$identity.PSObject.Properties['sourceCommit']}else{$null}
$SourceCommit=if($sourceCommitProperty -and $sourceCommitProperty.Value){[string]$sourceCommitProperty.Value}else{'SOURCE_COMMIT_NOT_RECORDED'}
if(-not(Test-Path -LiteralPath $OutputRoot)){New-Item -ItemType Directory -Path $OutputRoot -Force|Out-Null}
$mutex=[Threading.Mutex]::new($false,'Local\ZDJMITS-Engine-ReadOnly-Observer')
if(-not $mutex.WaitOne(0)){throw 'OBSERVER_ALREADY_RUNNING'}
try{
  $deadline=(Get-Date).AddMinutes($WaitForLaunchMinutes)
  $target=$null
  do{$target=Pin-Target;if($target){break};if(-not $FollowCurrentReceipt){throw 'TARGET_IDENTITY_NOT_LIVE'};Start-Sleep -Seconds 5}while((Get-Date)-lt $deadline)
  if(-not $target){$noTarget=[ordered]@{type='OBSERVER_TARGET_NOT_FOUND';observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');waitMinutes=$WaitForLaunchMinutes;identityPath=$IdentityPath;hostReceiptPath=$HostReceiptPath};$path=Join-Path $OutputRoot ('no-target-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json');[IO.File]::WriteAllText($path,($noTarget|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false));exit 2}
  $started=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$target.startedAtUnixMs).UtcDateTime
  $file=Join-Path $OutputRoot ("engine-$($target.instanceId)-pid$($target.pid)-$($target.startedAtUnixMs)-observer$((Get-Date).ToString('yyyyMMdd-HHmmss')).jsonl")
  $stream=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  $writer=[IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false));$writer.AutoFlush=$true
  $eventSys=[long]0;$eventApp=[long]0;$lastHealth=$null;$sampleNumber=0;$sealed=$false
  try{
    do{
      $now=[DateTimeOffset]::UtcNow;$process=Get-ProcessFact $target.pid;$hostProcessFact=Get-ProcessFact $target.hostPid
      $identityNow=Read-Json $IdentityPath;$receiptNow=Read-Json $HostReceiptPath
      $health=$null;$healthState='UNAVAILABLE';$healthStatusCode=$null
      try{$health=Invoke-RestMethod 'http://127.0.0.1:8080/health' -TimeoutSec 5;$healthState=[string]$health.status;$healthStatusCode=200;$lastHealth=[pscustomobject]@{atUtc=$now.ToString('o');status=$healthState;ready=[bool]$health.ready;pid=[int]$health.pid;buildId=[string]$health.runtime.buildId}}catch{$healthStatusCode=if($_.Exception.Response){[int]$_.Exception.Response.StatusCode}else{$null}}
      $memory=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction SilentlyContinue
      $systemEvents=Get-NewEventFacts 'System' @(2004) $eventSys;$eventSys=[long]$systemEvents.lastRecordId
      $appEvents=Get-NewEventFacts 'Application' @(1000,1001) $eventApp;$eventApp=[long]$appEvents.lastRecordId
      $sampleNumber++
      $row=[ordered]@{
        type='SAMPLE';sample=$sampleNumber;observedAtUtc=$now.ToString('o');elapsedSeconds=[Math]::Round(($now.UtcDateTime-$started).TotalSeconds,1)
        identity=[ordered]@{pid=$target.pid;creationTimeUtc=$started.ToString('o');instanceId=$target.instanceId;buildId=$target.buildId;sourceCommit=$target.sourceCommit;hostPid=$target.hostPid;launchId=$target.launchId;enginePath=$target.enginePath;identityFileMatches=([int]$identityNow.pid -eq $target.pid -and [string]$identityNow.instanceId -eq $target.instanceId -and [string]$identityNow.buildId -eq $target.buildId);receiptMatches=([int]$receiptNow.pid -eq $target.pid -and [string]$receiptNow.launchId -eq $target.launchId)}
        process=$process;hostProcess=$hostProcessFact;http=[ordered]@{status=$healthState;statusCode=$healthStatusCode;ready=if($health){[bool]$health.ready}else{$false};pid=if($health){[int]$health.pid}else{$null};uptimeMs=if($health){[long]$health.runtime.uptimeMs}else{$null};buildId=if($health){[string]$health.runtime.buildId}else{$null}}
        system=[ordered]@{commitBytes=[long]$memory.CommittedBytes;commitLimitBytes=[long]$memory.CommitLimit;pagedPoolBytes=[long]$memory.PoolPagedBytes;nonPagedPoolBytes=[long]$memory.PoolNonpagedBytes;freePhysicalPages=[long]$memory.AvailableBytes}
        modelListeners=@(8081,8083,8084|ForEach-Object{[pscustomobject]@{port=$_;owners=Get-ListenerOwner $_}});proxyListener=[pscustomobject]@{port=20091;owners=Get-ListenerOwner 20091}
        windowsEvents=[ordered]@{system2004=$systemEvents;application1000_1001=$appEvents};processLifecycle=Read-TailLifecycle $ProcessLifecyclePath $target.pid $target.instanceId
        hostLifecycle=Read-TailLifecycle $HostLifecyclePath $target.pid $target.instanceId;lastKnownHealth=$lastHealth
      }
      $line=ConvertTo-Json -InputObject $row -Depth 10 -Compress
      $bytes=[Text.Encoding]::UTF8.GetByteCount($line)+2
      if($stream.Length+$bytes -gt $MaxBytes){Write-Jsonl $writer ([ordered]@{type='RETENTION_LIMIT';observedAtUtc=$now.ToString('o');maxBytes=$MaxBytes;sampleCount=$sampleNumber-1});$sealed=$true;break}
      Write-Jsonl $writer $row
      if($Once){break}
      if(-not $process -or [string]$process.startTime -ne [string]$target.creationTimeUtc){
        $exitRow=[ordered]@{type='ENGINE_PROCESS_DISAPPEARED';observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');identity=$target;lastKnownHealth=$lastHealth;processLifecycle=Read-TailLifecycle $ProcessLifecyclePath $target.pid $target.instanceId;hostLifecycle=Read-TailLifecycle $HostLifecyclePath $target.pid $target.instanceId;httpLastStatus=$healthStatusCode}
        Write-Jsonl $writer $exitRow;$sealed=$true
        $crashOutput=Join-Path $OutputRoot ('crash-evidence-'+$target.instanceId+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
        $engineLog=@(Get-ChildItem -LiteralPath $RuntimeLogDirectory -Filter "engine-*$($target.instanceId)*.jsonl" -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1)
        $collectorStatus='COLLECTOR_NOT_RUN'
        if(-not(Test-Path -LiteralPath $target.repositoryRoot)){$target.repositoryRoot=Get-EngineRepositoryRoot ([string]$target.enginePath)}
        if($engineLog.Count -and (Test-Path -LiteralPath $target.repositoryRoot)){
          $windowEnd=[DateTimeOffset]::UtcNow;$windowStart=if($windowEnd.AddMinutes(-30)-lt $started){$started}else{$windowEnd.AddMinutes(-30)}
          $collector=Join-Path $target.repositoryRoot 'scripts\collect-zdj-engine-crash-evidence.ps1'
          if(Test-Path -LiteralPath $collector){
            $stdout=if($StdoutPath){$StdoutPath}else{$target.stdoutPath};$stderr=if($StderrPath){$StderrPath}else{$target.stderrPath}
            try{& $collector -IncidentId ("engine-$($target.instanceId)-$($target.pid)-$($windowEnd.ToUnixTimeSeconds())") -ProcessId $target.pid -InstanceId $target.instanceId -BuildId $target.buildId -SourceCommit $target.sourceCommit -ExpectedStartUtc $started.ToString('o') -WindowStartUtc $windowStart.ToString('o') -WindowEndUtc $windowEnd.ToString('o') -RepositoryRoot $target.repositoryRoot -DataDirectory $DataDirectory -OutputDirectory $crashOutput -EngineLogPath $engineLog[0].FullName -LauncherLogPath $HostLifecyclePath -ProcessLifecycleLogPath $ProcessLifecyclePath -StdoutPath $stdout -StderrPath $stderr -MaxEventCount 500 -MaxLogBytes 16777216 | Out-Null;$collectorStatus='COLLECTOR_COMPLETED'}catch{$collectorStatus='COLLECTOR_FAILED_'+$_.Exception.GetType().Name}
          }
        }
        $dumpRoot=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\engine-wer';$dumps=@(Get-ChildItem -LiteralPath $dumpRoot -Filter "node.exe.$($target.pid)*.dmp" -File -ErrorAction SilentlyContinue)
        $dumpFacts=@($dumps|ForEach-Object{[pscustomobject]@{name=$_.Name;bytes=$_.Length;lastWriteTimeUtc=$_.LastWriteTimeUtc.ToString('o');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower();localPath=$_.FullName}})
        [IO.File]::WriteAllText(($file+'.seal.json'),([ordered]@{type='LOCAL_CRASH_EVIDENCE_SEAL';sealedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');identity=$target;observerJsonlPath=$file;observerJsonlSha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower();dumpStatus=if($dumpFacts.Count){'DUMP_PRESENT'}else{'DUMP_NOT_CAPTURED'};dumps=$dumpFacts;collectorStatus=$collectorStatus;collectorPath=if(Test-Path -LiteralPath $crashOutput){$crashOutput}else{$null};classification='PROCESS_DISAPPEARED_EXIT_CODE_REQUIRES_MATCHED_HOST_RECEIPT'}|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
        break
      }
      Start-Sleep -Seconds $IntervalSeconds
    }while(-not $sealed)
  }finally{$writer.Dispose();$stream.Dispose()}
  [pscustomobject]@{status=if($sealed){'EVIDENCE_SEALED_OR_RETENTION_LIMIT'}elseif($Once){'ONE_SAMPLE_COMPLETE'}else{'OBSERVER_STOPPED'};path=$file;sampleCount=$sampleNumber;pid=$target.pid;instanceId=$target.instanceId;buildId=$target.buildId;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()}|ConvertTo-Json -Compress
}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
