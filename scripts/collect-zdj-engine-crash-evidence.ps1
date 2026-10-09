[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$IncidentId,
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ProcessId,
  [Parameter(Mandatory=$true)][string]$InstanceId,
  [Parameter(Mandatory=$true)][string]$BuildId,
  [Parameter(Mandatory=$true)][string]$SourceCommit,
  [Parameter(Mandatory=$true)][string]$ExpectedStartUtc,
  [Parameter(Mandatory=$true)][string]$WindowStartUtc,
  [Parameter(Mandatory=$true)][string]$WindowEndUtc,
  [Parameter(Mandatory=$true)][string]$RepositoryRoot,
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$FirstHttpFailureUtc,
  [string]$LastKnownHealthReadyUtc,
  [Parameter(Mandatory=$true)][string]$EngineLogPath,
  [Parameter(Mandatory=$true)][string]$LauncherLogPath,
  [Parameter(Mandatory=$true)][string]$ProcessLifecycleLogPath,
  [string]$StdoutPath,
  [string]$StderrPath,
  [ValidateRange(1,1000)][int]$MaxEventCount=500,
  [ValidateRange(1024,67108864)][long]$MaxLogBytes=16777216
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'engine-crash-diagnostics.psm1') -Force

function Parse-Utc([string]$Value,[string]$Name){
  $parsed=[DateTimeOffset]::Parse($Value,[Globalization.CultureInfo]::InvariantCulture)
  if($parsed.Offset -ne [TimeSpan]::Zero){throw "$Name must include UTC offset +00:00 or Z"}
  return $parsed.ToUniversalTime()
}
function Read-BoundedEventLog([string]$LogName,[DateTimeOffset]$From,[DateTimeOffset]$To,[int]$Maximum){
  try{
    $records=@(Get-WinEvent -FilterHashtable @{LogName=$LogName;StartTime=$From.LocalDateTime;EndTime=$To.LocalDateTime} -MaxEvents $Maximum -ErrorAction Stop)
    return [pscustomobject]@{records=$records;coverage=[pscustomobject]@{logName=$LogName;status=if($records.Count -ge $Maximum){'LIMIT_REACHED'}else{'COLLECTED'};recordsReturned=$records.Count;limit=$Maximum;error=$null}}
  }catch{
    $errorId=[string]$_.FullyQualifiedErrorId
    $message=[string]$_.Exception.Message
    if($errorId -match 'NoMatchingEventsFound' -or $message -match 'No events were found'){
      return [pscustomobject]@{records=@();coverage=[pscustomobject]@{logName=$LogName;status='COLLECTED_EMPTY';recordsReturned=0;limit=$Maximum;error=$null}}
    }
    return [pscustomobject]@{records=@();coverage=[pscustomobject]@{logName=$LogName;status='UNAVAILABLE';recordsReturned=0;limit=$Maximum;errorType=$_.Exception.GetType().Name}}
  }
}
function Is-IncidentEvent([object]$Event,[string]$LogName,[int]$TargetPid,[string]$TargetInstance){
  $message=[string]$Event.Message
  if($LogName -eq 'System' -and $Event.Id -eq 2004 -and $Event.ProviderName -eq 'Microsoft-Windows-Resource-Exhaustion-Detector'){return $true}
  if($message -match ('(^|[^0-9])'+$TargetPid+'([^0-9]|$)') -or $message.Contains($TargetInstance) -or $message -match '(?i)node\.exe'){return $true}
  if($LogName -eq 'System' -and $Event.Id -in @(41,1074,6005,6006,6008) -and $Event.ProviderName -match 'Kernel-Power|User32|EventLog|Kernel-General'){return $true}
  return $false
}
function Get-OptionalFileFact([string]$Path,[long]$Maximum){
  if([string]::IsNullOrWhiteSpace($Path) -or -not(Test-Path -LiteralPath $Path -PathType Leaf)){return [pscustomobject]@{status='NOT_FOUND'}}
  $i=Get-Item -LiteralPath $Path
  if($i.Length -gt $Maximum){return [pscustomobject]@{status='SKIPPED_SIZE_LIMIT';bytes=$i.Length;lastWriteTimeUtc=$i.LastWriteTimeUtc.ToString('o')}}
  return [pscustomobject]@{status='HASHED_LOCAL_ONLY';bytes=$i.Length;lastWriteTimeUtc=$i.LastWriteTimeUtc.ToString('o');sha256=(Get-LocalFileSha256 $Path)}
}

if($env:OS -ne 'Windows_NT'){throw 'WINDOWS_ONLY_COLLECTOR'}
if(-not(Test-OutputDirectoryOutsideLiveData -OutputDirectory $OutputDirectory -RepositoryRoot $RepositoryRoot -DataDirectory $DataDirectory)){throw 'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY_AND_DATA_DIRECTORY'}
$localRoot=[IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\','/')
$fullOutput=[IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\','/')
if(-not($fullOutput.StartsWith($localRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))){throw 'OUTPUT_MUST_BE_UNDER_LOCALAPPDATA'}
if(Test-Path -LiteralPath $OutputDirectory){throw 'OUTPUT_DIRECTORY_ALREADY_EXISTS_REFUSING_OVERWRITE'}
$start=Parse-Utc $WindowStartUtc 'WindowStartUtc';$end=Parse-Utc $WindowEndUtc 'WindowEndUtc';$expectedStart=Parse-Utc $ExpectedStartUtc 'ExpectedStartUtc'
if($end -le $start){throw 'INVALID_WINDOW_ORDER'}
if(($end-$start).TotalHours -gt 24){throw 'WINDOW_EXCEEDS_24_HOUR_BOUND'}
$firstFailure=[DateTimeOffset]::MinValue;if($FirstHttpFailureUtc){$firstFailure=Parse-Utc $FirstHttpFailureUtc 'FirstHttpFailureUtc'}
$lastReady=$null;if($LastKnownHealthReadyUtc){$lastReady=Parse-Utc $LastKnownHealthReadyUtc 'LastKnownHealthReadyUtc'}
New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
$startMs=$start.ToUnixTimeMilliseconds();$endMs=$end.ToUnixTimeMilliseconds()
$engine=Read-BoundedEngineJsonLines -Path $EngineLogPath -MaximumBytes $MaxLogBytes -Kind 'engine-jsonl' -Predicate {param($row) $row.instanceId -eq $InstanceId -and $row.buildId -eq $BuildId -and $row.timestamp -ge $startMs -and $row.timestamp -le $endMs} -MaxRows 100
$launcher=Read-BoundedEngineJsonLines -Path $LauncherLogPath -MaximumBytes $MaxLogBytes -Kind 'launcher-jsonl' -Predicate {param($row) $row.event -eq 'CHILD_EXITED' -and [int]$row.payload.pid -eq $ProcessId -and $row.ts -ge $startMs -and $row.ts -le $endMs} -MaxRows 100
$process=Read-BoundedEngineJsonLines -Path $ProcessLifecycleLogPath -MaximumBytes $MaxLogBytes -Kind 'process-lifecycle-jsonl' -Predicate {param($row) $row.pid -eq $ProcessId -and $row.ts -ge $startMs -and $row.ts -le $endMs} -MaxRows 100
$engineRows=@($engine.events|ForEach-Object {Get-PublicRuntimeEventSummary $_})
$launcherRows=@($launcher.events|ForEach-Object {[pscustomobject]@{event=$_.event;ts=$_.ts;hostPid=$_.hostPid;pid=[int]$_.payload.pid;exitCode=[long]$_.payload.exitCode;exitedAt=$_.payload.exitedAt}})
$processRows=@($process.events|ForEach-Object {[pscustomobject]@{event=$_.event;ts=$_.ts;pid=$_.pid;ppid=$_.ppid;code=$_.payload.code;exitCode=$_.payload.exitCode}})
$observedProcess=$null;$procCoverage='NOT_RUNNING_OR_NOT_VISIBLE';try{$cim=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop;if($cim){$observedProcess=[pscustomobject]@{processId=[int]$cim.ProcessId;parentProcessId=[int]$cim.ParentProcessId;creationTimeUtc=([DateTimeOffset]$cim.CreationDate).ToUniversalTime().ToString('o')};$procCoverage='OBSERVED'}}catch{$procCoverage='UNAVAILABLE'}
$aliveFacts=@();if($observedProcess){$aliveFacts=@($observedProcess)}
$classification=Get-EngineCrashClassification -ProcessId $ProcessId -LauncherEvents $launcherRows -ProcessEvents $processRows -ObservedProcess $(if($aliveFacts.Count){$aliveFacts[0]}else{$null}) -ExpectedStartUtc $expectedStart -FirstHttpFailureUtc $firstFailure
$app=Read-BoundedEventLog 'Application' $start $end $MaxEventCount;$sys=Read-BoundedEventLog 'System' $start $end $MaxEventCount
$allEvents=@();foreach($pair in @(@{name='Application';value=$app},@{name='System';value=$sys})){foreach($e in $pair.value.records){if(Is-IncidentEvent $e $pair.name $ProcessId $InstanceId){$allEvents += [pscustomobject]@{log=$pair.name;timeUtc=$e.TimeCreated.ToUniversalTime().ToString('o');recordId=$e.RecordId;id=$e.Id;provider=$e.ProviderName;level=$e.LevelDisplayName;message=$e.Message}}}}
$pressure=Get-ResourcePressureSummary -ProcessId $ProcessId -Events @($sys.records)
$listeners=@();try{$listeners=@(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction Stop|Select-Object LocalAddress,LocalPort,OwningProcess)}catch{}
$sourceFacts=@($engine.coverage,$launcher.coverage,$process.coverage,(Get-OptionalFileFact $StdoutPath $MaxLogBytes),(Get-OptionalFileFact $StderrPath $MaxLogBytes))
$publicSourceFacts=@($sourceFacts|ForEach-Object {[pscustomobject]@{kind=$_.kind;status=$_.status;bytes=$_.bytes;sha256=$_.sha256;validLines=$_.validLines;matchingRowsRetained=$_.matchingRowsRetained;malformedLines=$_.malformedLines;oversizedLines=$_.oversizedLines;lastWriteTimeUtc=$_.lastWriteTimeUtc}})
$private=[ordered]@{incidentId=$IncidentId;privateOnly=$true;identity=[ordered]@{processId=$ProcessId;instanceId=$InstanceId;buildId=$BuildId;sourceCommit=$SourceCommit};windowUtc=[ordered]@{start=$start.ToString('o');end=$end.ToString('o')};eventLogs=$allEvents}
$privatePath=Join-Path $OutputDirectory 'private-event-details.json';[IO.File]::WriteAllText($privatePath,($private|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$summary=[ordered]@{incidentId=$IncidentId;classification=$classification;identity=[ordered]@{processId=$ProcessId;parentProcessId=if($observedProcess){$observedProcess.parentProcessId}else{($launcherRows|Select-Object -Last 1).hostPid};instanceId=$InstanceId;buildId=$BuildId;sourceCommit=$SourceCommit};windowUtc=[ordered]@{start=$start.ToString('o');end=$end.ToString('o')};observations=[ordered]@{latestKnownHealthReadyUtc=if($lastReady){$lastReady.ToString('o')}else{$null};firstHttpFailureUtc=if($firstFailure -ne [DateTimeOffset]::MinValue){$firstFailure.ToString('o')}else{$null};processObservation=$procCoverage;listeners=$listeners;lastRuntimeEvents=$engineRows;matchingChildExits=$launcherRows;processLifecycle=$processRows};resourcePressure=$pressure;eventLogCoverage=@($app.coverage,$sys.coverage);sourceCoverage=$publicSourceFacts;privateEventFile='private-event-details.json';collectionBoundary='READ_ONLY_NO_HTTP_NO_SQLITE_NO_EXCHANGE_NO_REGISTRY_NO_LIFECYCLE'}
$summaryPath=Join-Path $OutputDirectory 'summary.json';[IO.File]::WriteAllText($summaryPath,($summary|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
$hashes=@(Get-ChildItem -LiteralPath $OutputDirectory -File|ForEach-Object {[pscustomobject]@{name=$_.Name;bytes=$_.Length;sha256=(Get-LocalFileSha256 $_.FullName)}})
$manifest=[ordered]@{incidentId=$IncidentId;createdAtUtc=[DateTimeOffset]::UtcNow.ToString('o');identity=[ordered]@{processId=$ProcessId;instanceId=$InstanceId;buildId=$BuildId;sourceCommit=$SourceCommit};sourceCoverage=$sourceFacts;artifactHashes=$hashes}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'manifest.json'),($manifest|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
Write-Output ($summary|ConvertTo-Json -Depth 5 -Compress)
