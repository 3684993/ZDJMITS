# PoolMon per-tag kernel pool snapshot collector. READ ONLY.
# Uses an EXISTING Microsoft WDK poolmon.exe. Never installs tools or changes Windows settings.
# Never terminates models/Engine or touches Windows pagefile. Raw snapshots remain LOCAL.
[CmdletBinding()]
param(
    [ValidateSet('Discover','Capture')][string]$Mode='Capture',
    [string]$PoolMonPath='',
    [ValidateRange(5,120)][int]$TimeoutSeconds=30,
    [ValidateRange(5,100)][int]$TopRows=25
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Get-PoolMonExecutable {
    param([string]$Specified)
    if(-not [string]::IsNullOrWhiteSpace($Specified)){
        if(-not (Test-Path -LiteralPath $Specified -PathType Leaf)){
            throw "POOLMON_EXPLICIT_PATH_MISSING: $Specified"
        }
        return (Resolve-Path -LiteralPath $Specified).ProviderPath
    }
    $candidates=New-Object 'System.Collections.Generic.List[string]'
    foreach($root in @('C:\Program Files (x86)\Windows Kits','C:\Program Files\Windows Kits')){
        foreach($kit in @('10','11')){
            foreach($relative in @(
                'Tools\Other\x64\poolmon.exe',
                'Tools\Other\poolmon.exe',
                'Tools\x64\poolmon.exe',
                'Debuggers\x64\poolmon.exe',
                'Tools\Other\amd64\poolmon.exe'
            )){
                $candidate=Join-Path (Join-Path $root $kit) $relative
                if(Test-Path -LiteralPath $candidate -PathType Leaf){$candidates.Add($candidate)}
            }
        }
    }
    $cmd=Get-Command -Name 'poolmon.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if($cmd -and $cmd.Source){$candidates.Add([string]$cmd.Source)}
    foreach($candidate in @($candidates)){
        if([string]::IsNullOrWhiteSpace($candidate)){continue}
        $resolved=(Resolve-Path -LiteralPath $candidate -ErrorAction SilentlyContinue)
        if(-not $resolved){continue}
        # Don't execute a same-named arbitrary executable found through PATH.
        if($resolved.ProviderPath -notmatch '(?i)\\Windows Kits\\'){continue}
        return [string]$resolved.ProviderPath
    }
    return $null
}
function Read-HostSnapshot {
    $m=Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
    [pscustomobject]@{
        timestampUtc=[DateTimeOffset]::UtcNow.ToString('o')
        commitGiB=[Math]::Round([double]$m.CommittedBytes / 1GB,3)
        commitLimitGiB=[Math]::Round([double]$m.CommitLimit / 1GB,3)
        pagedPoolGiB=[Math]::Round([double]$m.PoolPagedBytes / 1GB,3)
        nonpagedPoolGiB=[Math]::Round([double]$m.PoolNonpagedBytes / 1GB,3)
    }
}
function Run-PoolMonSnapshot {
    param([string]$Exe,[string[]]$Options,[string]$Destination,[int]$DeadlineSec)
    # Microsoft WDK PoolMon: /b sort by bytes, /p nonpaged, /p /p paged, /e totals, /n file snapshot.
    $argsList=@(@($Options) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })+@('/b','/e','/n',('"' + $Destination + '"'))
    $child=Start-Process -FilePath $Exe -ArgumentList $argsList -PassThru -WindowStyle Hidden -ErrorAction Stop
    try{
        if(-not $child.WaitForExit($DeadlineSec*1000)){
            # Only our own PoolMon snapshot child is terminated on timeout.
            try{$child.Kill();$child.WaitForExit()}catch{}
            throw "POOLMON_SNAPSHOT_TIMEOUT: $Destination"
        }
        if($child.ExitCode -ne 0){
            throw "POOLMON_EXIT_NONZERO: code=$($child.ExitCode) path=$Destination"
        }
    } finally {$child.Dispose()}
    if(-not(Test-Path -LiteralPath $Destination -PathType Leaf)){
        throw "POOLMON_SNAPSHOT_MISSING: $Destination"
    }
    if((Get-Item -LiteralPath $Destination).Length -le 0){
        throw "POOLMON_SNAPSHOT_EMPTY: $Destination"
    }
}
$tool=Get-PoolMonExecutable -Specified $PoolMonPath
if(-not $tool){
    Write-Warning 'POOLMON_NOT_FOUND: Existing Microsoft WDK PoolMon not detected in standard Windows Kits paths or trusted PATH entry.'
    Write-Host 'NO_INSTALL_PERFORMED. If PoolMon is installed elsewhere, rerun with -PoolMonPath "C:\actual\path\poolmon.exe".'
    Write-Host 'Official docs: https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/poolmon'
    return
}
Write-Host "POOLMON_TOOL: $tool"
$signature=Get-AuthenticodeSignature -LiteralPath $tool -ErrorAction SilentlyContinue
Write-Host "POOLMON_SIGNATURE: $($signature.Status)"
if($Mode -eq 'Discover'){
    Write-Host 'POOLMON_DISCOVERY_OK: no snapshot taken.'
    return
}
# Confirm current model/Engine state, WITHOUT modifying it.
$hostBefore=Read-HostSnapshot
$runningModels=@(Get-Process -Name llama-server -ErrorAction SilentlyContinue | Select-Object Id,HandleCount,PrivateMemorySize64)
$ports=@(Get-NetTCPConnection -State Listen -LocalPort 8080,8081,8083,8084 -ErrorAction SilentlyContinue |
    Select-Object LocalPort,OwningProcess)
if(@($ports | Where-Object {$_.LocalPort -in @(8083,8084)}).Count){
    Write-Warning '27B port listening again. Snapshot still read-only, but do not compare against the previous two-model-off baseline.'
}
$dir=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
[IO.Directory]::CreateDirectory($dir)|Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$rawPaths=@()
$summaryLines=New-Object 'System.Collections.Generic.List[string]'
$summaryLines.Add("READ_ONLY_POOLMON_TOPTAGS UTC=$([DateTimeOffset]::UtcNow.ToString('o'))")
$summaryLines.Add("POOLMON_SIGNATURE_STATUS=$($signature.Status)")
$summaryLines.Add("COMMIT_GIB=$($hostBefore.commitGiB) COMMIT_LIMIT_GIB=$($hostBefore.commitLimitGiB) PAGED_GIB=$($hostBefore.pagedPoolGiB) NONPAGED_GIB=$($hostBefore.nonpagedPoolGiB)")
$summaryLines.Add("LLAMA_PIDS_AND_HANDLES="+(($runningModels | ForEach-Object {"$($_.Id):$($_.HandleCount)"}) -join ','))
$summaryLines.Add("LISTENERS="+(($ports | ForEach-Object {"$($_.LocalPort):$($_.OwningProcess)"}) -join ','))
foreach($spec in @(
    [pscustomobject]@{name='all';args=@()},
    [pscustomobject]@{name='paged';args=@('/p','/p')},
    [pscustomobject]@{name='nonpaged';args=@('/p')}
)){
    $destination=Join-Path $dir ("poolmon-$($spec.name)-$stamp.txt")
    Run-PoolMonSnapshot -Exe $tool -Options $spec.args -Destination $destination -DeadlineSec $TimeoutSeconds
    $rawPaths+= $destination
    $summaryLines.Add("===== $($spec.name.ToUpperInvariant()) TOP BY BYTES =====")
    # PoolMon's /n snapshot is sorted by /b; retain only compact tag rows, no driver names or user details.
    $rows=@(Get-Content -LiteralPath $destination -ErrorAction Stop |
        Where-Object { $_ -match '^\s*\S{1,8}\s+(?:Paged|Nonp|Nonpaged)\s+\d' } |
        Select-Object -First $TopRows)
    if($rows.Count -eq 0){
        $summaryLines.Add('TAG_PARSE_UNAVAILABLE: retain raw snapshot locally for format inspection')
    }else{foreach($line in $rows){$summaryLines.Add($line)}}
    $summaryLines.Add("RAW_LOCAL_ONLY: $destination")
}
$hostAfter=Read-HostSnapshot
$summaryLines.Add("HOST_AFTER: COMMIT_GIB=$($hostAfter.commitGiB) PAGED_GIB=$($hostAfter.pagedPoolGiB) NONPAGED_GIB=$($hostAfter.nonpagedPoolGiB)")
$summaryLines.Add('No model/Engine stopped, started or restarted. No pagefile, registry, driver, verifier or tracing changes.')
$summary=Join-Path $dir "poolmon-summary-$stamp.txt"
[IO.File]::WriteAllLines($summary,$summaryLines,[Text.UTF8Encoding]::new($false))
Write-Host "POOLMON_SUMMARY_LOCAL: $summary"
foreach($item in @($rawPaths)){Write-Host "POOLMON_RAW_LOCAL: $item"}
Write-Host ''
$summaryLines | Where-Object { $_ -notmatch '^RAW_LOCAL_ONLY:' } | ForEach-Object { Write-Host $_ }
Write-Host 'POOLMON_CAPTURE_DONE_READ_ONLY. Inspect text for host identifiers before sharing; do not commit raw snapshots to public GitHub.'
