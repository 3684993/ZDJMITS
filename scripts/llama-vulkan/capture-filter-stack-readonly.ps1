# ZDJMITS host file system Filter Manager topology. READ ONLY. No WDK required.
# Allowed commands: fltmc.exe filters, fltmc.exe instances, fltmc.exe volumes.
# Never fltmc unload/load/attach/detach; no registry write, driver stop, Engine/model action.
[CmdletBinding()]
param(
    [switch]$ShowRawConsole,
    [ValidateRange(1,100)][int]$TopFilters = 50
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$exe=Join-Path $env:SystemRoot 'System32\fltmc.exe'
if(-not (Test-Path -LiteralPath $exe -PathType Leaf)){throw 'FLTMC_NOT_FOUND: system fltmc.exe unavailable'}
function Invoke-ReadOnlyFltmc {
    param([ValidateSet('filters','instances','volumes')][string]$QueryName)
    # The executable is a built-in Windows utility; only non-mutating subcommands allowed.
    $output = (& $exe $QueryName 2>&1 | Out-String)
    $code=$LASTEXITCODE
    [pscustomobject]@{
        command="fltmc $QueryName"
        exitCode=$code
        output=[string]$output
    }
}
$queries=@(
    Invoke-ReadOnlyFltmc -QueryName 'filters'
    Invoke-ReadOnlyFltmc -QueryName 'instances'
    Invoke-ReadOnlyFltmc -QueryName 'volumes'
)
$failed=@($queries|Where-Object {$_.exitCode -ne 0})
if($failed.Count){
    foreach($item in $failed){
        Write-Warning ("FILTER_STACK_QUERY_FAILED command={0} exit={1}. Try an elevated PowerShell only if local policy permits, without changing system settings." -f $item.command,$item.exitCode)
    }
}
$filterRows=New-Object 'System.Collections.Generic.List[object]'
foreach($line in ($queries[0].output -split "[\r\n]+")){
    if($line -match '^\s*(?<Name>[A-Za-z0-9_.-]+)\s+(?<Instances>\d+)\s+(?<Altitude>\d+(?:\.\d+)?)\s+(?<Frame>\S+)\s*$'){
        $filterRows.Add([pscustomobject]@{
            name=$Matches.Name
            instances=[int]$Matches.Instances
            altitude=$Matches.Altitude
            frame=$Matches.Frame
        })
    }
}
if(-not $filterRows.Count -and $queries[0].exitCode -eq 0){
    Write-Warning 'FILTER_LIST_PARSE_UNAVAILABLE: raw fltmc filter stdout retained locally; no filter claim inferred.'
}
$drivers=@()
if($filterRows.Count){
    $allDrivers=@(Get-CimInstance Win32_SystemDriver -ErrorAction SilentlyContinue)
    foreach($flt in @($filterRows | Select-Object -First $TopFilters)){
        $matched=@($allDrivers | Where-Object {$_.Name -ieq $flt.name} | Select-Object -First 1)
        $drivers+= [pscustomobject]@{
            filter=$flt.name
            driverServiceFound=($matched.Count -eq 1)
            driverServiceName=$(if($matched.Count){$matched[0].Name}else{$null})
            driverDisplayName=$(if($matched.Count){$matched[0].DisplayName}else{$null})
            driverState=$(if($matched.Count){$matched[0].State}else{$null})
            driverStartMode=$(if($matched.Count){$matched[0].StartMode}else{$null})
            mappingAssurance='HEURISTIC_SERVICE_NAME_MATCH_ONLY'
        }
    }
}
$os=Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
$buildProperty=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
$mem=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
$roles=@(foreach($p in @(8080,8081,8083,8084)){
    $listeners=@(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
    [pscustomobject]@{port=$p;listenerCount=$listeners.Count;owningPids=@($listeners|Select-Object -ExpandProperty OwningProcess -Unique)}
})
$report=[ordered]@{
    purpose='READ_ONLY_FILTER_MANAGER_TOPOLOGY'
    utc=[DateTimeOffset]::UtcNow.ToString('o')
    osCaption=[string]$os.Caption
    currentBuild=[string]$buildProperty.CurrentBuild
    ubr=$buildProperty.UBR
    displayVersion=$buildProperty.DisplayVersion
    pagedPoolGiB=[Math]::Round([double]$mem.PoolPagedBytes/1GB,3)
    nonpagedPoolGiB=[Math]::Round([double]$mem.PoolNonpagedBytes/1GB,3)
    commitGiB=[Math]::Round([double]$mem.CommittedBytes/1GB,3)
    modelAndEnginePorts=$roles
    filterRows=@($filterRows.ToArray())
    serviceNameMatches=@($drivers)
    fltmcCommandResults=@($queries)
    safety='NO_DRIVER_CHANGES_NO_VERIFIER_NO_REGISTRY_WRITE_NO_MODEL_OR_ENGINE_LIFECYCLE'
}
$folder=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
[IO.Directory]::CreateDirectory($folder)|Out-Null
$path=Join-Path $folder ('filter-stack-readonly-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
[IO.File]::WriteAllText($path,($report|ConvertTo-Json -Depth 9),[Text.UTF8Encoding]::new($false))
Write-Host ("Windows build: {0}.{1} / {2}" -f $buildProperty.CurrentBuild,$buildProperty.UBR,$buildProperty.DisplayVersion)
Write-Host ("Pools GiB: paged={0:N3} nonpaged={1:N3}" -f $report.pagedPoolGiB,$report.nonpagedPoolGiB)
Write-Host 'FILTERS:'
if($filterRows.Count){$filterRows|Format-Table name,instances,altitude,frame -AutoSize|Out-Host}
else{Write-Host 'FILTERS NOT PARSED: inspect local report'}
Write-Host 'DRIVER SERVICE NAME MATCHES (heuristic only):'
if($drivers.Count){$drivers|Format-Table filter,driverState,driverStartMode,driverDisplayName -AutoSize|Out-Host}
Write-Host 'MODEL/ENGINE PORT LISTENERS:'
$roles|Format-Table port,listenerCount -AutoSize|Out-Host
foreach($item in $queries){
    Write-Host ("{0} exitCode={1}" -f $item.command,$item.exitCode)
    if($ShowRawConsole){Write-Host $item.output}
}
Write-Host "LOCAL_ONLY_FILTER_STACK_REPORT: $path"
Write-Host 'The raw output may include volume/device names. Review before sharing; never push it unredacted to public GitHub.'
Write-Host 'NO_FILTER_WAS_LOADED_UNLOADED_ATTACHED_DETACHED'
