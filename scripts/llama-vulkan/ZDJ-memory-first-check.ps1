# ZDJMITS / llama-server first-pass memory inspection
# READ ONLY: No process stop/start, no pagefile/registry/driver/Engine changes.
# Compatible with Windows PowerShell 5.1 and PowerShell 7.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Continue'
$root = Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $root ("memory-first-check-$stamp.txt")
$lines = New-Object System.Collections.Generic.List[string]
function Say([string]$msg) {
    $script:lines.Add($msg)
    Write-Host $msg
}
function GiB([object]$bytes) {
    if ($null -eq $bytes) { return 'UNKNOWN' }
    try { return ('{0:N2}' -f ([double]$bytes / 1GB)) }
    catch { return 'UNKNOWN' }
}
function Section([string]$s) { Say ''; Say ('=== ' + $s + ' ===') }
function SafeRun([string]$name, [scriptblock]$action) {
    try { & $action }
    catch { Say ("$name FAILED: " + $_.Exception.GetType().Name) }
}
try {
    Say 'ZDJMITS memory first-check | READ-ONLY | NO SETTINGS CHANGES'
    Say ('Time (local): ' + (Get-Date).ToString('o'))
    Say ('Machine: ' + $env:COMPUTERNAME + '; OS: ' + [Environment]::OSVersion.VersionString)
    Section 'Memory: system commit / pools (GiB)'
    SafeRun 'Memory counters' {
        $m = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
        $committed = [double]$m.CommittedBytes
        $limit = [double]$m.CommitLimit
        Say ('Committed: ' + (GiB $committed) + ' GiB')
        Say ('Commit limit: ' + (GiB $limit) + ' GiB')
        Say ('Commit free: ' + (GiB ($limit - $committed)) + ' GiB')
        if ($limit -gt 0) { Say ('Commit use: ' + ('{0:N1}' -f (100*$committed/$limit)) + '%') }
        Say ('Available physical: ' + ('{0:N2}' -f ([double]$m.AvailableMBytes/1024)) + ' GiB')
        Say ('Paged pool: ' + (GiB $m.PoolPagedBytes) + ' GiB')
        Say ('Nonpaged pool: ' + (GiB $m.PoolNonpagedBytes) + ' GiB')
        Say ('Pages output/sec: ' + $m.PagesOutputPersec)
    }
    Section 'Pagefile (MiB) / management'
    SafeRun 'Pagefile' {
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
        Say ('AutomaticManagedPagefile: ' + $cs.AutomaticManagedPagefile)
        $pf = @(Get-CimInstance Win32_PageFileUsage -ErrorAction Stop)
        if ($pf.Count -eq 0) { Say 'No pagefile reported' }
        foreach ($p in $pf) {
            Say ('File: ' + $p.Name + ' | allocated=' + $p.AllocatedBaseSize + ' MiB | used=' + $p.CurrentUsage + ' MiB | peak=' + $p.PeakUsage + ' MiB')
        }
    }
    Section 'Drives (available GiB)'
    SafeRun 'Disk space' {
        Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction Stop | ForEach-Object {
            Say ($_.DeviceID + ' free=' + (GiB $_.FreeSpace) + ' GiB; total=' + (GiB $_.Size) + ' GiB')
        }
    }
    Section 'Top 18 processes by Private Bytes / committed private memory'
    SafeRun 'Top process list' {
        Get-Process -ErrorAction Stop | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 18 | ForEach-Object {
            Say ('PID=' + $_.Id + ' name=' + $_.ProcessName + ' private=' + (GiB $_.PrivateMemorySize64) + ' GiB; workingSet=' + (GiB $_.WorkingSet64) + ' GiB; handles=' + $_.HandleCount)
        }
    }
    Section 'llama-server / node exact process memory'
    SafeRun 'Target processes' {
        $target = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'llama-server' -or $_.ProcessName -eq 'node' })
        if ($target.Count -eq 0) { Say 'No llama-server.exe or node.exe found' }
        foreach ($p in $target) {
            Say ('PID=' + $p.Id + ' name=' + $p.ProcessName + ' private=' + (GiB $p.PrivateMemorySize64) + ' GiB; WS=' + (GiB $p.WorkingSet64) + ' GiB')
        }
    }
    Section 'llama-server model name and SAFE parameter presence (no full command line)'
    SafeRun 'llama command line' {
        $llamas = @(Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" -ErrorAction Stop)
        foreach ($p in $llamas) {
            $cmd = [string]$p.CommandLine
            $model = 'UNAVAILABLE'
            if ($cmd -match '(?i)(?:--model|-m)\s+"?([^"\r\n]+?\.gguf)') {
                $model = [IO.Path]::GetFileName($matches[1])
            }
            $flags = @('no-mmap','mlock','kv-offload','no-kv-offload','flash-attn','kv-unified')
            $active = @()
            foreach ($flag in $flags) {
                if ($cmd -match ('(?i)(?:^|\s)--' + [regex]::Escape($flag) + '(?:\s|=|$)')) { $active += $flag }
            }
            Say ('PID=' + $p.ProcessId + ' modelFile=' + $model + ' flagsPresent=' + (($active -join ',') -replace '^$','none observed'))
        }
    }
    Section 'Listening TCP: Engine 8080, models 8081/8083/8084'
    SafeRun 'Ports' {
        $targetPorts = @(8080,8081,8083,8084)
        $sockets = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $targetPorts -contains $_.LocalPort })
        foreach ($x in ($sockets | Sort-Object LocalPort,OwningProcess)) {
            Say ('listen ' + $x.LocalAddress + ':' + $x.LocalPort + ' PID=' + $x.OwningProcess)
        }
        if ($sockets.Count -eq 0) { Say 'No requested listeners returned' }
    }
    Section 'Windows system low-virtual-memory events (Event 2004, recent 24h)'
    SafeRun 'Event 2004' {
        $startTime = (Get-Date).AddHours(-24)
        $ev = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=2004; StartTime=$startTime} -MaxEvents 12 -ErrorAction Stop)
        foreach ($e in $ev) { Say ('event2004 ' + $e.TimeCreated.ToString('o') + ' recordId=' + $e.RecordId) }
        if ($ev.Count -eq 0) { Say 'No Event 2004 returned' }
    }
    Section 'Summary end'
    Say 'Read-only only: no programs, services, Windows settings, or model parameters changed.'
} finally {
    [IO.File]::WriteAllLines($logPath, $lines.ToArray(), [Text.UTF8Encoding]::new($true))
    Write-Host ''
    Write-Host ('DIAGNOSTIC LOG: ' + $logPath)
    Write-Host 'Keep this raw TXT locally; share a privacy-reviewed or sanitized summary only.'
}