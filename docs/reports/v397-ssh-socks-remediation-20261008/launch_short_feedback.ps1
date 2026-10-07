[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$RepositoryRoot,[ValidatePattern('^[a-z0-9-]+$')][string]$Label='post-reactivity',[ValidateRange(10,30)][int]$Minutes=15)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $RepositoryRoot).Path
$report=Join-Path $root 'docs\reports\v397-ssh-socks-remediation-20261008'
$target=Join-Path $report $Label
if(Test-Path -LiteralPath $target){throw 'Refusing to overwrite a prior independent window'}
New-Item -ItemType Directory -Path $target|Out-Null
foreach($name in @('collect_stability.py','analyze_stability.py')){Copy-Item -LiteralPath (Join-Path $report $name) -Destination (Join-Path $target $name)}
$python=(Get-Command python.exe).Source
$hours=([double]$Minutes/60).ToString([Globalization.CultureInfo]::InvariantCulture)
$script=Join-Path $target 'collect_stability.py'
$startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
$created=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=('"'+$python+'" "'+$script+'" --hours '+$hours+' --interval 30');CurrentDirectory=$root;ProcessStartupInformation=$startup}
if($created.ReturnValue -ne 0){throw "COLLECTOR_CREATE_FAILED $($created.ReturnValue)"}
$receipt=@{at=(Get-Date).ToUniversalTime().ToString('o');mode='READ_ONLY_LOCALHOST_INDEPENDENT_WINDOW';label=$Label;minutes=$Minutes;pid=$created.ProcessId;intervalSeconds=30;script=$script}
$receipt|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $target 'launch.json') -Encoding utf8
$receipt|ConvertTo-Json
