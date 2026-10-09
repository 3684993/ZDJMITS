$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'engine-crash-diagnostics.psm1') -Force
$passed=0
function Assert-Equal($Actual,$Expected,[string]$Name){if($Actual -ne $Expected){throw "TEST_FAILED:$Name expected=$Expected actual=$Actual"};$script:passed++}
function Assert-True($Actual,[string]$Name){if(-not $Actual){throw "TEST_FAILED:$Name"};$script:passed++}

Assert-Equal (ConvertTo-WindowsExitCodeHex -ExitCode -1073740791) '0xC0000409' 'fastfail-status-hex'
$crashEvent=@([pscustomobject]@{event='CHILD_EXITED';payload=[pscustomobject]@{pid=8524;exitCode=-1073740791}})
$classified=Get-EngineCrashClassification -ProcessId 8524 -LauncherEvents $crashEvent
Assert-Equal $classified.classification 'PROCESS_EXIT_CRASH' 'matched-fastfail-is-crash'
Assert-Equal $classified.confidence 'PROVEN' 'matched-fastfail-proof'
$wrongPid=@([pscustomobject]@{event='CHILD_EXITED';payload=[pscustomobject]@{pid=9999;exitCode=-1073740791}})
Assert-Equal (Get-EngineCrashClassification -ProcessId 8524 -LauncherEvents $wrongPid).classification 'UNKNOWN' 'different-pid-exit-not-attributed'

$unknownExit=@([pscustomobject]@{event='CHILD_EXITED';payload=[pscustomobject]@{pid=8524;exitCode=-1}})
Assert-Equal (Get-EngineCrashClassification -ProcessId 8524 -LauncherEvents $unknownExit).classification 'UNKNOWN' 'unknown-nonzero-is-not-guessed'

$shutdownRows=@([pscustomobject]@{pid=8524;event='SHUTDOWN_REQUESTED'},[pscustomobject]@{pid=8524;event='PROCESS_EXIT';code=0})
$normalExit=@([pscustomobject]@{event='CHILD_EXITED';payload=[pscustomobject]@{pid=8524;exitCode=0}})
Assert-Equal (Get-EngineCrashClassification -ProcessId 8524 -LauncherEvents $normalExit -ProcessEvents $shutdownRows).classification 'PROCESS_EXIT_NORMAL_OR_EXTERNAL' 'matched-graceful-shutdown'

$start=[DateTimeOffset]::Parse('2026-10-09T00:00:00Z')
$alive=[pscustomobject]@{processId=8524;creationTimeUtc='2026-10-09T00:00:00Z'}
$httpFailure=[DateTimeOffset]::Parse('2026-10-09T00:01:00Z')
Assert-Equal (Get-EngineCrashClassification -ProcessId 8524 -ObservedProcess $alive -ExpectedStartUtc $start -FirstHttpFailureUtc $httpFailure).classification 'PROCESS_ALIVE_HTTP_UNAVAILABLE' 'verified-live-pid-and-http-failure'
$reused=[pscustomobject]@{processId=8524;creationTimeUtc='2026-10-09T01:00:00Z'}
Assert-Equal (Get-EngineCrashClassification -ProcessId 8524 -ObservedProcess $reused -ExpectedStartUtc $start -FirstHttpFailureUtc $httpFailure).classification 'UNKNOWN' 'pid-reuse-does-not-match'
Assert-Equal (Get-EngineCrashClassification -ProcessId 8524).classification 'UNKNOWN' 'missing-evidence-remains-unknown'

$pressureEvents=@(
  [pscustomobject]@{Id=2004;ProviderName='Microsoft-Windows-Resource-Exhaustion-Detector';TimeCreated=[datetime]'2026-10-09T07:12:08';Message='low virtual memory: llama-server.exe (51124)'},
  [pscustomobject]@{Id=2004;ProviderName='Microsoft-Windows-Resource-Exhaustion-Detector';TimeCreated=[datetime]'2026-10-09T07:13:00';Message='low virtual memory: node.exe (8524)'},
  [pscustomobject]@{Id=1000;ProviderName='Application Error';TimeCreated=[datetime]'2026-10-09T07:14:00';Message='node.exe (8524)'}
)
$pressure=Get-ResourcePressureSummary -ProcessId 8524 -Events $pressureEvents
Assert-Equal $pressure.eventCount 2 'only-event-2004-counted'
Assert-True $pressure.processIdListed 'pid-match-in-event-2004'
$unlinked=Get-ResourcePressureSummary -ProcessId 8524 -Events @($pressureEvents[0])
Assert-Equal $unlinked.processIdListed $false 'other-process-pressure-not-attributed-to-engine'

$private=[pscustomobject]@{timestamp=1791501417109;level='info';event='BINANCE_USER_DATA';env='TESTNET';buildId='build';symbol='PRIVATE_SYMBOL';traceId='PRIVATE_TRACE';payload=[pscustomobject]@{secret='PRIVATE_SECRET';order='PRIVATE_ORDER'}}
$public=Get-PublicRuntimeEventSummary $private
Assert-Equal $public.event 'BINANCE_USER_DATA' 'public-event-name-retained'
Assert-Equal ($public.PSObject.Properties.Name -join ',') 'timestampUtc,event,level,environment,buildId' 'private-fields-omitted'
Assert-True ((ConvertTo-Json $public -Compress) -notmatch 'PRIVATE_SYMBOL|PRIVATE_TRACE|PRIVATE_SECRET|PRIVATE_ORDER') 'private-payload-redacted'

$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('zdj-crash-jsonl-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot -Force|Out-Null
$fixture=Join-Path $fixtureRoot 'events.jsonl'
$fixtureLines=@('{"sequence":1,"event":"wanted"}','{"sequence":2,"event":"wanted"}','not-json','{"sequence":3,"event":"other"}','{"sequence":4,"event":"wanted"}','this-line-is-deliberately-over-the-configured-size-bound')
[IO.File]::WriteAllLines($fixture,$fixtureLines,[Text.UTF8Encoding]::new($false))
$read=Read-BoundedEngineJsonLines -Path $fixture -MaximumBytes 1024 -Kind 'fixture' -Predicate {param($row) $row.event -eq 'wanted'} -MaxRows 2 -MaxLineChars 40
Assert-Equal $read.coverage.validLines 4 'bounded-reader-valid-line-count'
Assert-Equal $read.coverage.malformedLines 1 'bounded-reader-records-malformed-line'
Assert-Equal $read.coverage.oversizedLines 1 'bounded-reader-skips-overlong-line'
Assert-Equal $read.coverage.status 'PARTIAL_INVALID_OR_OVERSIZED_LINES' 'bounded-reader-marks-coverage-gap'
Assert-Equal $read.coverage.matchingRowsRetained 2 'bounded-reader-retains-only-row-bound'
Assert-Equal $read.events[0].sequence 2 'bounded-reader-keeps-last-matching-rows'
Assert-Equal (Read-BoundedEngineJsonLines -Path $fixture -MaximumBytes 1 -Kind 'fixture').coverage.status 'SKIPPED_SIZE_LIMIT' 'oversize-log-is-not-parsed'
Remove-Item -LiteralPath $fixtureRoot -Recurse -Force

$temp=Join-Path ([IO.Path]::GetTempPath()) ('zdj-crash-collector-test-'+[guid]::NewGuid().ToString('N'))
$outside=Test-OutputDirectoryOutsideLiveData -OutputDirectory $temp -RepositoryRoot 'C:\repo' -DataDirectory 'C:\repo\data'
Assert-True $outside 'output-outside-repository-allowed'
Assert-Equal (Test-OutputDirectoryOutsideLiveData -OutputDirectory 'C:\repo\data\audit' -RepositoryRoot 'C:\repo' -DataDirectory 'C:\repo\data') $false 'data-output-refused'
Assert-Equal (Test-OutputDirectoryOutsideLiveData -OutputDirectory 'C:\repo\new-output' -RepositoryRoot 'C:\repo' -DataDirectory 'C:\repo\data') $false 'repo-output-refused'

Write-Output "collect-zdj-engine-crash-evidence.test.ps1 PASS ($passed assertions)"
