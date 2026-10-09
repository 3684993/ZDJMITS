Set-StrictMode -Version Latest

function Get-LocalFileSha256([string]$Path){
  $stream=[IO.File]::OpenRead($Path)
  try{$algorithm=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','')}finally{$algorithm.Dispose()}}finally{$stream.Dispose()}
}

function ConvertTo-WindowsExitCodeHex {
  [CmdletBinding()]
  param([Parameter(Mandatory=$true)][long]$ExitCode)
  $signed=[int32]$ExitCode
  $unsigned=[BitConverter]::ToUInt32([BitConverter]::GetBytes($signed),0)
  return ('0x{0:X8}' -f $unsigned)
}

function Get-EngineCrashClassification {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][int]$ProcessId,
    [object[]]$LauncherEvents=@(),
    [object[]]$ProcessEvents=@(),
    [object]$ObservedProcess=$null,
    [DateTimeOffset]$ExpectedStartUtc=[DateTimeOffset]::MinValue,
    [DateTimeOffset]$FirstHttpFailureUtc=[DateTimeOffset]::MinValue
  )
  $exit=@($LauncherEvents | Where-Object {
    $payloadProperty=$_.PSObject.Properties['payload']
    $pidProperty=$_.PSObject.Properties['pid']
    $childPid=if($payloadProperty){[int]$payloadProperty.Value.pid}elseif($pidProperty){[int]$pidProperty.Value}else{-1}
    $_.event -eq 'CHILD_EXITED' -and $childPid -eq $ProcessId
  } | Select-Object -Last 1)
  if($exit.Count){
    $payloadProperty=$exit[0].PSObject.Properties['payload']
    $exitCodeProperty=$exit[0].PSObject.Properties['exitCode']
    $codeValue=if($payloadProperty){$payloadProperty.Value.exitCode}else{$exitCodeProperty.Value}
    $code=[long]$codeValue
    $hex=ConvertTo-WindowsExitCodeHex $code
    $knownFatal=@('0xC0000409','0xC0000005','0xC0000374','0xC000001D','0xC00000FD')
    if($knownFatal -contains $hex){return [pscustomobject]@{classification='PROCESS_EXIT_CRASH';confidence='PROVEN';exitCode=$code;exitCodeHex=$hex;reason='MATCHED_WINDOWS_FATAL_STATUS'}}
    $shutdown=@($ProcessEvents | Where-Object {$_.pid -eq $ProcessId -and $_.event -eq 'SHUTDOWN_REQUESTED'} | Select-Object -Last 1)
    $cleanExit=@($ProcessEvents | Where-Object {$_.pid -eq $ProcessId -and $_.event -eq 'PROCESS_EXIT' -and [int]$_.code -eq 0} | Select-Object -Last 1)
    if($code -eq 0 -and $shutdown.Count -and $cleanExit.Count){return [pscustomobject]@{classification='PROCESS_EXIT_NORMAL_OR_EXTERNAL';confidence='PROVEN_NORMAL_SHUTDOWN_RECORDS';exitCode=$code;exitCodeHex=$hex;reason='MATCHED_SHUTDOWN_AND_PROCESS_EXIT'}}
    return [pscustomobject]@{classification='UNKNOWN';confidence='INSUFFICIENT_EVIDENCE';exitCode=$code;exitCodeHex=$hex;reason='EXIT_STATUS_NOT_SUFFICIENT_TO_CLASSIFY'}
  }
  if($ObservedProcess -and $FirstHttpFailureUtc -ne [DateTimeOffset]::MinValue -and $ExpectedStartUtc -ne [DateTimeOffset]::MinValue){
    $observedPid=[int]$ObservedProcess.processId
    $created=[DateTimeOffset]::Parse([string]$ObservedProcess.creationTimeUtc).ToUniversalTime()
    $delta=[Math]::Abs(($created-$ExpectedStartUtc.ToUniversalTime()).TotalSeconds)
    if($observedPid -eq $ProcessId -and $delta -le 2){return [pscustomobject]@{classification='PROCESS_ALIVE_HTTP_UNAVAILABLE';confidence='PROVEN_PROCESS_IDENTITY_AND_HTTP_FAILURE';exitCode=$null;exitCodeHex=$null;reason='MATCHED_LIVE_PID_AND_CREATION_TIME'}}
    return [pscustomobject]@{classification='UNKNOWN';confidence='INSUFFICIENT_EVIDENCE';exitCode=$null;exitCodeHex=$null;reason='PID_REUSE_OR_IDENTITY_MISMATCH'}
  }
  return [pscustomobject]@{classification='UNKNOWN';confidence='INSUFFICIENT_EVIDENCE';exitCode=$null;exitCodeHex=$null;reason='NO_MATCHING_EXIT_OR_VERIFIED_LIVE_PROCESS'}
}

function Get-ResourcePressureSummary {
  [CmdletBinding()]
  param([Parameter(Mandatory=$true)][int]$ProcessId,[object[]]$Events=@())
  $matched=@($Events | Where-Object {$_.Id -eq 2004 -and $_.ProviderName -eq 'Microsoft-Windows-Resource-Exhaustion-Detector'})
  $rows=@($matched | ForEach-Object {
    $text=[string]$_.Message
    [pscustomobject]@{
      timeUtc=([DateTimeOffset]$_.TimeCreated).ToUniversalTime().ToString('o')
      processIdListed=($text -match ('\('+$ProcessId+'\)'))
    }
  })
  return [pscustomobject]@{eventCount=$rows.Count;processIdListed=(@($rows | Where-Object {$_.processIdListed}).Count -gt 0);events=$rows}
}

function Get-PublicRuntimeEventSummary {
  [CmdletBinding()]
  param([Parameter(Mandatory=$true)][object]$Event)
  return [pscustomobject]@{
    timestampUtc=if($Event.timestamp){[DateTimeOffset]::FromUnixTimeMilliseconds([long]$Event.timestamp).UtcDateTime.ToString('o')}elseif($Event.ts){[DateTimeOffset]::FromUnixTimeMilliseconds([long]$Event.ts).UtcDateTime.ToString('o')}else{$null}
    event=[string]$Event.event
    level=[string]$Event.level
    environment=[string]$Event.env
    buildId=[string]$Event.buildId
  }
}

function Read-BoundedEngineJsonLines {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][long]$MaximumBytes,
    [Parameter(Mandatory=$true)][string]$Kind,
    [scriptblock]$Predicate,
    [ValidateRange(1,10000)][int]$MaxRows=100,
    [ValidateRange(1,1048576)][int]$MaxLineChars=1048576
  )
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return [pscustomobject]@{events=@();coverage=[pscustomobject]@{kind=$Kind;status='NOT_FOUND';path=$Path;bytes=$null;sha256=$null;validLines=0;matchingRowsRetained=0;malformedLines=0}}}
  $info=Get-Item -LiteralPath $Path
  if($info.Length -gt $MaximumBytes){return [pscustomobject]@{events=@();coverage=[pscustomobject]@{kind=$Kind;status='SKIPPED_SIZE_LIMIT';path=$Path;bytes=$info.Length;sha256=(Get-LocalFileSha256 $Path);validLines=0;matchingRowsRetained=0;malformedLines=0}}}
  $rows=[Collections.Generic.List[object]]::new();$malformed=0;$oversized=0;$valid=0
  foreach($line in [IO.File]::ReadLines($Path)){
    if($line.Length -gt $MaxLineChars){$oversized++;continue}
    try{$row=$line|ConvertFrom-Json -ErrorAction Stop;$valid++;if(-not $Predicate -or (& $Predicate $row)){if($rows.Count -ge $MaxRows){$rows.RemoveAt(0)};$rows.Add($row)}}catch{$malformed++}
  }
  return [pscustomobject]@{events=@($rows.ToArray());coverage=[pscustomobject]@{kind=$Kind;status=if($malformed -or $oversized){'PARTIAL_INVALID_OR_OVERSIZED_LINES'}else{'COLLECTED'};path=$Path;bytes=$info.Length;sha256=(Get-LocalFileSha256 $Path);validLines=$valid;matchingRowsRetained=$rows.Count;malformedLines=$malformed;oversizedLines=$oversized;lastWriteTimeUtc=$info.LastWriteTimeUtc.ToString('o')}}
}

function Test-OutputDirectoryOutsideLiveData {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [Parameter(Mandatory=$true)][string]$RepositoryRoot,
    [Parameter(Mandatory=$true)][string]$DataDirectory
  )
  $out=[IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\','/')
  foreach($rootPath in @($RepositoryRoot,$DataDirectory)){
    $root=[IO.Path]::GetFullPath($rootPath).TrimEnd('\','/')
    if($out.Equals($root,[StringComparison]::OrdinalIgnoreCase) -or $out.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){
      return $false
    }
  }
  return $true
}

Export-ModuleMember -Function ConvertTo-WindowsExitCodeHex,Get-EngineCrashClassification,Get-ResourcePressureSummary,Get-PublicRuntimeEventSummary,Read-BoundedEngineJsonLines,Test-OutputDirectoryOutsideLiveData,Get-LocalFileSha256
