# ZDJMITS / Vulkan memory and handle verification (read-only, no HTTP, no OS settings).
# Writes local JSON to %LOCALAPPDATA%\ZDJMITS\diagnostics; never upload raw host data to public GitHub.
[CmdletBinding()]
param([ValidateRange(1,8)][int]$Samples=3,[ValidateRange(1,30)][int]$IntervalSeconds=3)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$dir=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
[IO.Directory]::CreateDirectory($dir)|Out-Null
$timestamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$out=Join-Path $dir "vulkan-memory-handles-$timestamp.json"
$collection=New-Object 'System.Collections.Generic.List[object]'
for($i=0;$i -lt $Samples;$i++){
    $memory=Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
    $pf=@(Get-CimInstance -ClassName Win32_PageFileUsage -ErrorAction SilentlyContinue | ForEach-Object {
        [pscustomobject]@{path=[IO.Path]::GetPathRoot($_.Name);allocatedMiB=$_.AllocatedBaseSize;currentMiB=$_.CurrentUsage;peakMiB=$_.PeakUsage}
    })
    $rawPerf=@(Get-CimInstance -ClassName Win32_PerfRawData_PerfProc_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'llama-server*' } |
        Select-Object Name,IDProcess,HandleCount,PrivateBytes,WorkingSet)
    $pids=@(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)
    $items=@(foreach($proc in $pids){
        $independent=@($rawPerf | Where-Object { [int]$_.IDProcess -eq [int]$proc.Id } | Select-Object -First 1)
        [pscustomobject]@{
            pid=$proc.Id
            startedUtc=$(try{$proc.StartTime.ToUniversalTime().ToString('o')}catch{$null})
            processHandleCount=$proc.HandleCount
            perfHandleCount=if($independent.Count){[long]$independent[0].HandleCount}else{$null}
            privateGiB=[Math]::Round($proc.PrivateMemorySize64/1GB,3)
            workingSetGiB=[Math]::Round($proc.WorkingSet64/1GB,3)
            handleAlert=($proc.HandleCount -ge 100000 -or ($independent.Count -and [long]$independent[0].HandleCount -ge 100000))
        }
    })
    $sample=[pscustomobject]@{
        utc=[DateTimeOffset]::UtcNow.ToString('o')
        commitGiB=[Math]::Round([double]$memory.CommittedBytes/1GB,3)
        commitLimitGiB=[Math]::Round([double]$memory.CommitLimit/1GB,3)
        commitFreeGiB=[Math]::Round(([double]$memory.CommitLimit-[double]$memory.CommittedBytes)/1GB,3)
        availablePhysicalGiB=[Math]::Round([double]$memory.AvailableMBytes/1024,3)
        pagedPoolGiB=[Math]::Round([double]$memory.PoolPagedBytes/1GB,3)
        nonpagedPoolGiB=[Math]::Round([double]$memory.PoolNonpagedBytes/1GB,3)
        pagefiles=$pf
        llama=$items
    }
    $collection.Add($sample)
    Write-Host ("[{0}/{1}] commit free {2:N2} GiB; pool P={3:N2} GiB NP={4:N2} GiB" -f ($i+1),$Samples,$sample.commitFreeGiB,$sample.pagedPoolGiB,$sample.nonpagedPoolGiB)
    foreach($p in $items){Write-Host (" PID={0} handles Get-Process={1} PerfCIM={2} PrivateGiB={3}" -f $p.pid,$p.processHandleCount,$p.perfHandleCount,$p.privateGiB)}
    if($i+1 -lt $Samples){Start-Sleep -Seconds $IntervalSeconds}
}
$report=[ordered]@{purpose='READ_ONLY_HANDLE_RECHECK';samples=@($collection.ToArray());actions='NO_TERMINATION_NO_RESTART_NO_REGISTRY_NO_PAGEFILE_CHANGE_NO_SQLITE_NO_EXCHANGE'}
[IO.File]::WriteAllText($out,($report|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
Write-Host "LOCAL_ONLY_REPORT: $out"
Write-Host "Do not upload unredacted raw report to public GitHub."
