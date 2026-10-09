# P0 candidate 2026-10-09. No automatic takeover/watchdog. Keep original scripts untouched.
# ============================================================
# Qwen3.5-9B / Intel Arc B580 / llama.cpp Vulkan
#
# Default:
#   API  : http://127.0.0.1:8081/v1
#   GPU  : automatically finds Intel Arc B580
#   Model: Qwen3.5-9B Q4_K_M
#
# Safety features:
# - Cross-script GPU allocator/claim files.
# - Refuses to overlap another llama-server on the B580.
# - Child process sees ONLY the selected physical GPU through
#   GGML_VK_VISIBLE_DEVICES; inside the child it is Vulkan0.
# - Adds --ctx-checkpoints 0 when supported (Windows/Vulkan stability).
# - Health check + real inference smoke test + watchdog auto-restart.
#
# Put this file in:
#   <llama-vulkan>\scripts\start-qwen3.5-9b-vulkan.ps1
#
# One-click/default start:
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-qwen3.5-9b-vulkan.ps1
# ============================================================

param(
    [ValidateSet('Start','Watch','Stop','Status')]
    [string]$Mode = 'Start',

    [int]$Port = 8081,
    [string]$ModelPath = '',

    # Refuse a cold load if llama.cpp reports less free dedicated GPU memory.
    [int]$MinFreeMiB = 8500,

    [ValidateRange(4096,65536)][int]$MaxContextTokens = 16384,
    [ValidateRange(4,80)][int]$MinimumHostCommitFreeGiB = 8,
    [switch]$EnableWatchdog,
    [switch]$ConfirmStop,
    [ValidateRange(1,2147483647)][int]$ExpectedServerPid = 0,
    [string]$ExpectedStartUtc = '',
    [switch]$SkipSmokeTest,
    [switch]$NoWatchdog,
    [switch]$Debug
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-ServerOption {
    param([string]$HelpText, [string]$Option)
    return $HelpText -match ("(?m)(^|\s)" + [regex]::Escape($Option) + "([,=\s]|$)")
}

function Get-PidFromFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $value = (Get-Content -LiteralPath $Path -Raw).Trim()
        if ($value -match '^\d+$') { return [int]$value }
    } catch {}
    return $null
}

function Test-ProcessAlive {
    param([Nullable[int]]$ProcessId)
    if ($null -eq $ProcessId) { return $false }
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-PortOwnerPid {
    param([int]$ListenPort)

    $conn = Get-NetTCPConnection `
        -LocalAddress $HostAddress `
        -LocalPort $ListenPort `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($null -eq $conn) { return $null }
    return [int]$conn.OwningProcess
}

function Test-Health {
    param([int]$ListenPort)
    try {
        $health = Invoke-RestMethod `
            -Uri "http://${HostAddress}:$ListenPort/health" `
            -TimeoutSec 3

        return $health.status -eq 'ok'
    } catch {
        return $false
    }
}

function Test-LegacySameModelServer {
    param(
        [int]$ProcessId,
        [int]$ListenPort
    )

    try {
        $proc = Get-CimInstance Win32_Process `
            -Filter "ProcessId=$ProcessId" `
            -ErrorAction Stop

        if ($null -eq $proc) { return $false }
        if ([string]$proc.Name -ine 'llama-server.exe') { return $false }

        $cmd = [string]$proc.CommandLine
        if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }

        $hasPort = $cmd -match (
            '(?i)(?:^|\s)--port(?:\s+|=)' +
            [regex]::Escape([string]$ListenPort) +
            '(?:\s|$)'
        )

        if (-not $hasPort) { return $false }

        $hasModel = $cmd -match [regex]::Escape($Model)
        $hasAlias = $cmd -match [regex]::Escape($Alias)

        return ($hasModel -or $hasAlias)
    }
    catch {
        return $false
    }
}

function Write-WatchLog {
    param([string]$Message)

    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $WatchLog -Value $line -Encoding UTF8
}

function Cleanup-OldLogs {
    # P0: preserve historical model logs and failure evidence.
    return
}

function Enter-GpuAllocator {
    $mutex = [System.Threading.Mutex]::new(
        $false,
        'Local\LlamaCpp-Vulkan-GpuAllocator-v3'
    )

    $acquired = $false

    try {
        # Fast path first.  If another model is still cold-loading/warming up,
        # wait instead of starting several large allocations at the same time.
        $acquired = $mutex.WaitOne([TimeSpan]::Zero)

        if (-not $acquired) {
            Write-Host (
                'Another managed llama-server is allocating/loading a GPU. ' +
                'Waiting for the shared startup gate...'
            ) -ForegroundColor Yellow

            $acquired = $mutex.WaitOne([TimeSpan]::FromMinutes(10))
        }
    }
    catch [System.Threading.AbandonedMutexException] {
        # A previous launcher died while holding the mutex.
        # Windows transferred ownership to this process.
        $acquired = $true
    }

    if (-not $acquired) {
        $mutex.Dispose()
        throw 'Timed out waiting for the shared Vulkan GPU startup/allocator lock.'
    }

    return $mutex
}

function Exit-GpuAllocator {
    param([System.Threading.Mutex]$Mutex)

    if ($null -eq $Mutex) { return }

    try { $Mutex.ReleaseMutex() } catch {}
    try { $Mutex.Dispose() } catch {}
}

function Get-VulkanDeviceCatalog {
    # Always enumerate the full physical Vulkan list.  A parent shell may
    # already have GGML_VK_VISIBLE_DEVICES set, so temporarily remove it.
    $oldVisible = [Environment]::GetEnvironmentVariable(
        'GGML_VK_VISIBLE_DEVICES',
        'Process'
    )

    try {
        Remove-Item Env:GGML_VK_VISIBLE_DEVICES -ErrorAction SilentlyContinue
        $deviceText = (& $Server --list-devices 2>&1 | Out-String)
    }
    finally {
        if ($null -eq $oldVisible) {
            Remove-Item Env:GGML_VK_VISIBLE_DEVICES -ErrorAction SilentlyContinue
        }
        else {
            $env:GGML_VK_VISIBLE_DEVICES = $oldVisible
        }
    }

    $result = @()

    foreach ($line in ($deviceText -split "`r?`n")) {
        $m = [regex]::Match(
            $line,
            '^\s*(Vulkan(?<index>\d+))\s*:\s*(?<description>.+?)\s*$',
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )

        if (-not $m.Success) { continue }

        $description = $m.Groups['description'].Value.Trim()
        $memory = [regex]::Match(
            $description,
            '\((?<total>\d+)\s+MiB,\s*(?<free>\d+)\s+MiB\s+free\)',
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )

        $totalMiB = $null
        $freeMiB = $null

        if ($memory.Success) {
            $totalMiB = [int]$memory.Groups['total'].Value
            $freeMiB  = [int]$memory.Groups['free'].Value
        }

        $result += [pscustomobject]@{
            Device      = ('Vulkan{0}' -f $m.Groups['index'].Value)
            Index       = [int]$m.Groups['index'].Value
            Description = $description
            TotalMiB    = $totalMiB
            FreeMiB     = $freeMiB
        }
    }

    if ($result.Count -eq 0) {
        Write-Host $deviceText
        throw 'llama.cpp did not report any Vulkan devices.'
    }

    return @($result)
}

function Get-GpuClaimPath {
    param([string]$PhysicalDevice)
    return Join-Path $GpuClaimDir "$PhysicalDevice.json"
}

function Get-ValidGpuClaims {
    $claims = @{}

    Get-ChildItem -LiteralPath $GpuClaimDir -Filter 'Vulkan*.json' -File `
        -ErrorAction SilentlyContinue |
        ForEach-Object {
            $claimPath = $_.FullName

            try {
                $claim = Get-Content -LiteralPath $claimPath -Raw |
                    ConvertFrom-Json

                $claimPid = [int]$claim.pid
                $claimProcess = Get-Process -Id $claimPid -ErrorAction SilentlyContinue

                # Avoid stale claim files surviving a reboot and accidentally
                # matching a reused PID belonging to an unrelated process.
                if ($claimProcess -and $claimProcess.ProcessName -ieq 'llama-server') {
                    $claims[[string]$claim.physicalDevice] = $claim
                }
                else {
                    Remove-Item -LiteralPath $claimPath -Force `
                        -ErrorAction SilentlyContinue
                }
            }
            catch {
                Remove-Item -LiteralPath $claimPath -Force `
                    -ErrorAction SilentlyContinue
            }
        }

    return $claims
}

function Get-GpuUsageMap {
    param([object[]]$Devices)

    $used = @{}
    $claims = Get-ValidGpuClaims
    $claimedPids = @{}

    foreach ($physicalDevice in $claims.Keys) {
        $claim = $claims[$physicalDevice]
        $pidKey = [string]([int]$claim.pid)
        $claimedPids[$pidKey] = $true

        $used[$physicalDevice] = [pscustomobject]@{
            Pid    = [int]$claim.pid
            Role   = [string]$claim.role
            Source = 'claim'
            Detail = 'managed GPU claim'
        }
    }

    # Compatibility with old/manual llama-server launches that do not yet
    # have a claim file.  Explicit --device/-dev VulkanN is treated as a
    # physical device because these old launches are unfiltered.
    #
    # If an unknown llama-server has no Vulkan device argument at all,
    # conservatively reserve ALL Vulkan GPUs.  Such a process may be using
    # llama.cpp automatic multi-GPU selection.
    $processes = @(
        Get-CimInstance Win32_Process `
            -Filter "Name='llama-server.exe'" `
            -ErrorAction SilentlyContinue
    )

    foreach ($proc in $processes) {
        $procPid = [int]$proc.ProcessId
        if ($claimedPids.ContainsKey([string]$procPid)) { continue }

        $cmd = [string]$proc.CommandLine
        if ([string]::IsNullOrWhiteSpace($cmd)) {
            foreach ($dev in $Devices) {
                if (-not $used.ContainsKey($dev.Device)) {
                    $used[$dev.Device] = [pscustomobject]@{
                        Pid    = $procPid
                        Role   = 'UNKNOWN'
                        Source = 'process'
                        Detail = 'llama-server command line unavailable; reserved conservatively'
                    }
                }
            }
            continue
        }

        $deviceArgs = [regex]::Matches(
            $cmd,
            '(?i)(?:^|\s)(?:--device|-dev)(?:\s+|=)(?:"([^"]+)"|([^\s]+))'
        )

        $sawDeviceArgument = $deviceArgs.Count -gt 0
        $sawVulkanDevice = $false

        foreach ($argMatch in $deviceArgs) {
            $raw = if ($argMatch.Groups[1].Success) {
                $argMatch.Groups[1].Value
            } else {
                $argMatch.Groups[2].Value
            }

            foreach ($token in ($raw -split ',')) {
                $token = $token.Trim()
                $tokenMatch = [regex]::Match(
                    $token,
                    '^(?i:Vulkan)(\d+)$'
                )

                if (-not $tokenMatch.Success) { continue }

                $sawVulkanDevice = $true
                $physicalDevice = 'Vulkan{0}' -f $tokenMatch.Groups[1].Value

                if (-not $used.ContainsKey($physicalDevice)) {
                    $used[$physicalDevice] = [pscustomobject]@{
                        Pid    = $procPid
                        Role   = 'LEGACY_OR_MANUAL'
                        Source = 'process'
                        Detail = "command line explicitly uses $physicalDevice"
                    }
                }
            }
        }

        if (-not $sawDeviceArgument) {
            foreach ($dev in $Devices) {
                if (-not $used.ContainsKey($dev.Device)) {
                    $used[$dev.Device] = [pscustomobject]@{
                        Pid    = $procPid
                        Role   = 'UNKNOWN_AUTO_GPU'
                        Source = 'process'
                        Detail = 'no --device argument; all Vulkan GPUs reserved conservatively'
                    }
                }
            }
        }
        elseif (-not $sawVulkanDevice) {
            # Explicit --device none/CPU/non-Vulkan backend: do not reserve Vulkan.
        }
    }

    return $used
}

function Show-DeviceAllocationTable {
    param(
        [object[]]$Devices,
        [hashtable]$Usage,
        [string]$NameRegex
    )

    foreach ($dev in ($Devices | Where-Object {
        $_.Description -match $NameRegex
    } | Sort-Object Index)) {

        $memoryText = ''
        if ($null -ne $dev.FreeMiB) {
            $memoryText = " free=$($dev.FreeMiB)/$($dev.TotalMiB) MiB"
        }

        if ($Usage.ContainsKey($dev.Device)) {
            $owner = $Usage[$dev.Device]
            Write-Host (
                "  {0} : {1}{2} [USED by llama-server PID={3}; role={4}; {5}]" -f
                $dev.Device,
                $dev.Description,
                $memoryText,
                $owner.Pid,
                $owner.Role,
                $owner.Detail
            )
        }
        else {
            Write-Host (
                "  {0} : {1}{2} [FREE]" -f
                $dev.Device,
                $dev.Description,
                $memoryText
            )
        }
    }
}

function New-GpuClaim {
    param(
        [string]$PhysicalDevice,
        [int]$PhysicalIndex,
        [int]$ServerPid,
        [int]$ListenPort,
        [string]$GpuDescription
    )

    $claimPath = Get-GpuClaimPath -PhysicalDevice $PhysicalDevice
    $tempPath = "$claimPath.$PID.tmp"

    @{
        schema          = 3
        pid             = $ServerPid
        role            = $RoleName
        script          = $PSCommandPath
        port            = $ListenPort
        physicalDevice  = $PhysicalDevice
        physicalIndex   = $PhysicalIndex
        internalDevice  = 'Vulkan0'
        visibleDevices  = "$PhysicalIndex"
        gpu             = $GpuDescription
        startedAt       = (Get-Date).ToString('o')
    } |
        ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath $tempPath -Encoding UTF8

    Move-Item -LiteralPath $tempPath -Destination $claimPath -Force
}

function Remove-GpuClaimsForPid {
    param([Nullable[int]]$ServerPid)

    if ($null -eq $ServerPid) { return }

    Get-ChildItem -LiteralPath $GpuClaimDir -Filter 'Vulkan*.json' -File `
        -ErrorAction SilentlyContinue |
        ForEach-Object {
            try {
                $claim = Get-Content -LiteralPath $_.FullName -Raw |
                    ConvertFrom-Json

                if ([int]$claim.pid -eq [int]$ServerPid) {
                    Remove-Item -LiteralPath $_.FullName -Force `
                        -ErrorAction SilentlyContinue
                }
            }
            catch {}
        }
}

function Start-IsolatedLlamaProcess {
    param(
        [int]$PhysicalIndex,
        [object[]]$Arguments,
        [string]$StdoutPath,
        [string]$StderrPath
    )

    # GGML_VK_VISIBLE_DEVICES uses PHYSICAL Vulkan indexes from the full
    # unfiltered --list-devices list.  Once exactly one physical GPU is
    # visible to the child, llama.cpp renumbers that visible GPU as Vulkan0.
    $oldVisible = [Environment]::GetEnvironmentVariable(
        'GGML_VK_VISIBLE_DEVICES',
        'Process'
    )

    try {
        $env:GGML_VK_VISIBLE_DEVICES = "$PhysicalIndex"

        return Start-Process `
            -FilePath $Server `
            -ArgumentList $Arguments `
            -WorkingDirectory $LlamaDir `
            -RedirectStandardOutput $StdoutPath `
            -RedirectStandardError $StderrPath `
            -WindowStyle Hidden `
            -PassThru
    }
    finally {
        if ($null -eq $oldVisible) {
            Remove-Item Env:GGML_VK_VISIBLE_DEVICES -ErrorAction SilentlyContinue
        }
        else {
            $env:GGML_VK_VISIBLE_DEVICES = $oldVisible
        }
    }
}

function Capture-RecentLlamaCrashEvent {
    try {
        $event = Get-WinEvent `
            -FilterHashtable @{
                LogName   = 'Application'
                StartTime = (Get-Date).AddMinutes(-5)
            } `
            -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Message -match '(?i)llama-server\.exe'
            } |
            Select-Object -First 1

        if ($event) {
            $oneLine = ([string]$event.Message -replace '\s+', ' ').Trim()
            if ($oneLine.Length -gt 1200) {
                $oneLine = $oneLine.Substring(0,1200)
            }
            Write-WatchLog "windows-crash-event id=$($event.Id) $oneLine"
        }
    }
    catch {}
}

function Write-ResourceSnapshot {
    param([Nullable[int]]$ServerPid)

    if ($null -eq $ServerPid) { return }

    try {
        $p = Get-Process -Id $ServerPid -ErrorAction Stop
        $wsGiB = [math]::Round($p.WorkingSet64 / 1GB, 2)
        $privateGiB = [math]::Round($p.PrivateMemorySize64 / 1GB, 2)

        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        $freePhysGiB = [math]::Round(([double]$os.FreePhysicalMemory * 1KB) / 1GB, 2)
        $freeVirtGiB = [math]::Round(([double]$os.FreeVirtualMemory * 1KB) / 1GB, 2)

        Write-WatchLog (
            "resources pid=$ServerPid workingSetGiB=$wsGiB privateGiB=$privateGiB " +
            "systemFreePhysGiB=$freePhysGiB systemFreeVirtualGiB=$freeVirtGiB"
        )
    }
    catch {}
}

function Wait-ForHealthyServer {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$ListenPort,
        [string]$StderrPath,
        [int]$TimeoutSeconds = 300
    )

    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        $Process.Refresh()

        if ($Process.HasExited) {
            Write-Host "llama-server exited during startup. ExitCode=$($Process.ExitCode)" `
                -ForegroundColor Red

            if (Test-Path -LiteralPath $StderrPath) {
                Get-Content -LiteralPath $StderrPath -Tail 200 `
                    -ErrorAction SilentlyContinue
            }

            return $false
        }

        if (Test-Health -ListenPort $ListenPort) {
            return $true
        }

        Start-Sleep -Seconds 1
    }

    return $false
}

$RoleName = 'QWEN35_B580'
$HostAddress = '127.0.0.1'

$DetectedLlamaDir = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath (Join-Path $DetectedLlamaDir 'llama-server.exe')) {
    $LlamaDir = $DetectedLlamaDir
}
else {
    $LlamaDir = 'D:\llama-vulkan'
}

$Server = Join-Path $LlamaDir 'llama-server.exe'
$Alias = 'qwen3.5:9b'

$DefaultModel = 'D:\.lmstudio\models\lmstudio-community\Qwen3.5-9B-GGUF\Qwen3.5-9B-Q4_K_M.gguf'
$PartModel = 'D:\.lmstudio\models\lmstudio-community\Qwen3.5-9B-GGUF\downloading_Qwen3.5-9B-Q4_K_M.gguf.part'

if ([string]::IsNullOrWhiteSpace($ModelPath)) {
    $Model = $DefaultModel
}
else {
    $Model = $ModelPath
}

$ContextSize = $MaxContextTokens
$PredictMax = 4096
$ParallelSlots = 1

$RuntimeDir = Join-Path $LlamaDir 'runtime\qwen35-b580-vulkan'
$LogDir = Join-Path $LlamaDir 'logs\qwen35-b580-vulkan'
$GpuClaimDir = Join-Path $LlamaDir 'runtime\gpu-claims'

$ServerPidFile = Join-Path $RuntimeDir 'server.pid'
$WatchPidFile = Join-Path $RuntimeDir 'watchdog.pid'
$StopFlag = Join-Path $RuntimeDir 'stop.flag'
$StateFile = Join-Path $RuntimeDir 'state.json'
$WatchLog = Join-Path $LogDir 'watchdog.log'
$WatchHaltFile = Join-Path $RuntimeDir 'watchdog-halted.flag'

New-Item -ItemType Directory -Force `
    -Path $RuntimeDir,$LogDir,$GpuClaimDir | Out-Null

function Assert-Environment {
    if (-not (Test-Path -LiteralPath $Server)) {
        throw "llama-server.exe not found: $Server"
    }

    if (-not (Test-Path -LiteralPath $Model)) {
        if (Test-Path -LiteralPath $PartModel) {
            $sizeGiB = [math]::Round(
                (Get-Item -LiteralPath $PartModel).Length / 1GB,
                2
            )
            throw "Qwen3.5-9B is still downloading ($sizeGiB GiB): $PartModel"
        }

        throw "Model not found: $Model"
    }

    $script:ServerHelp = (& $Server --help 2>&1 | Out-String)

    foreach ($argName in @('--device','--reasoning','--metrics','--slots','--perf')) {
        if ($script:ServerHelp -notmatch [regex]::Escape($argName)) {
            throw "Current llama.cpp build does not support $argName. Update llama.cpp."
        }
    }
}

function Resolve-B580Selection {
    param([int]$MinimumFreeMiB)

    $devices = @(Get-VulkanDeviceCatalog)
    $usage = Get-GpuUsageMap -Devices $devices
    $nameRegex = '(?i)Intel.*Arc.*B580'

    Write-Host ''
    Write-Host 'Detected Intel Arc B580 Vulkan device(s):'
    Show-DeviceAllocationTable `
        -Devices $devices `
        -Usage $usage `
        -NameRegex $nameRegex

    $candidates = @(
        $devices |
        Where-Object { $_.Description -match $nameRegex } |
        Sort-Object Index
    )

    if ($candidates.Count -eq 0) {
        throw 'No Intel Arc B580 Vulkan device was found.'
    }

    if ($candidates.Count -gt 1) {
        Write-Warning 'More than one B580 was detected; the first safe free B580 will be used.'
    }

    foreach ($dev in $candidates) {
        if ($usage.ContainsKey($dev.Device)) { continue }

        if ($null -ne $dev.FreeMiB -and $dev.FreeMiB -lt $MinimumFreeMiB) {
            Write-Warning (
                "$($dev.Device) is not claimed by llama-server, but only " +
                "$($dev.FreeMiB) MiB is free; minimum is $MinimumFreeMiB MiB."
            )
            continue
        }

        return $dev
    }

    throw (
        'No safe/free Intel Arc B580 is available. ' +
        'The server was NOT started to avoid GPU overlap or low-VRAM loading.'
    )
}

function Get-ServerArgs {
    param([int]$ListenPort)

    $args = @(
        '-m',$Model,
        '--alias',$Alias,

        # The child sees exactly one GPU, therefore its internal name is Vulkan0.
        '--device','Vulkan0',
        '--split-mode','none',
        '-ngl','all',

        '-c',"$ContextSize",
        '-np',"$ParallelSlots",
        '-n',"$PredictMax",

        '-ctk','q8_0',
        '-ctv','q8_0',

        '-fa','on',
        '-b','512',
        '-ub','128',

        '--jinja',
        '--reasoning','off',
        '--no-reasoning-preserve',

        '--temp','0.70',
        '--top-p','0.80',
        '--top-k','20',
        '--min-p','0.00',
        '--presence-penalty','1.5',
        '--repeat-penalty','1.0',

        '--host',$HostAddress,
        '--port',"$ListenPort",

        '--metrics',
        '--slots',
        '--perf',
        '--no-ui'
    )

    if (Test-ServerOption -HelpText $script:ServerHelp -Option '-fit') {
        $args += @('-fit','off')
    }

    # Windows/Vulkan stability workaround.  Current llama.cpp calls this
    # --ctx-checkpoints; zero disables server context checkpoints.
    if (Test-ServerOption -HelpText $script:ServerHelp -Option '--ctx-checkpoints') {
        $args += @('--ctx-checkpoints','0')
    }

    if (Test-ServerOption -HelpText $script:ServerHelp -Option '--cache-ram') {
        $args += @('--cache-ram','0')
    }

    if ($Debug) {
        if (Test-ServerOption -HelpText $script:ServerHelp -Option '--log-verbosity') {
            $args += @('--log-verbosity','4')
        }
        if (Test-ServerOption -HelpText $script:ServerHelp -Option '--log-timestamps') {
            $args += '--log-timestamps'
        }
    }

    return $args
}

function Invoke-B580SmokeTest {
    param([int]$ListenPort)

    $body = @{
        model = $Alias
        messages = @(
            @{
                role = 'user'
                content = 'Reply only: OK'
            }
        )
        max_tokens = 8
        temperature = 0
        reasoning_effort = 'none'
        stream = $false
    } | ConvertTo-Json -Depth 10 -Compress

    $response = Invoke-RestMethod `
        -Uri "http://${HostAddress}:$ListenPort/v1/chat/completions" `
        -Method Post `
        -ContentType 'application/json; charset=utf-8' `
        -Body $body `
        -TimeoutSec 180

    if ($null -eq $response.choices -or $response.choices.Count -lt 1) {
        throw 'B580 smoke test returned no completion choice.'
    }
}

function Assert-HostMemoryForColdStart {
    param([int]$MinimumFreeGiB)
    # Commit headroom is not free physical RAM or GPU VRAM.
    $m = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
    $freeGiB = ([double]$m.CommitLimit - [double]$m.CommittedBytes) / 1GB
    $usedRatio = if ([double]$m.CommitLimit -gt 0) { [double]$m.CommittedBytes / [double]$m.CommitLimit } else { 1.0 }
    if ($freeGiB -lt $MinimumFreeGiB -or $usedRatio -ge 0.90) {
        throw ('HOST_COMMIT_PREFLIGHT_BLOCKED free={0:N2}GiB required={1}GiB used={2:P1}; no model started' -f $freeGiB,$MinimumFreeGiB,$usedRatio)
    }
    foreach ($p in @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)) {
        if ($p.HandleCount -ge 100000) {
            throw ('HOST_HANDLE_PREFLIGHT_BLOCKED pid={0} handles={1}; independently verify before cold load' -f $p.Id,$p.HandleCount)
        }
    }
    Write-Host ('Host commit preflight OK: free={0:N2}GiB, used={1:P1}' -f $freeGiB,$usedRatio)
}

function Start-ModelServer {
    param(
        [int]$ListenPort,
        [bool]$RunSmokeTest
    )

    Assert-Environment
    Cleanup-OldLogs

    $existingOwner = Get-PortOwnerPid -ListenPort $ListenPort

    if ($null -ne $existingOwner) {
        $knownPid = Get-PidFromFile -Path $ServerPidFile

        if ($existingOwner -eq $knownPid) {
            if (Test-Health -ListenPort $ListenPort) {
                Write-Host "B580 model server is already healthy. PID=$existingOwner Port=$ListenPort"
                return $existingOwner
            }

            throw "SERVER_RUNNING_UNHEALTHY_REQUIRES_MANUAL_DIAGNOSIS port=$ListenPort pid=$existingOwner"
        }
        else {
            if (Test-LegacySameModelServer -ProcessId $existingOwner -ListenPort $ListenPort) {
                throw "LEGACY_SERVER_OCCUPIES_PORT port=$ListenPort pid=$existingOwner; no forced takeover"
            }
            else {
                $proc = Get-Process -Id $existingOwner -ErrorAction SilentlyContinue
                $procName = if ($proc) { $proc.ProcessName } else { 'unknown' }
                throw "Port $ListenPort is used by PID $existingOwner ($procName). Unknown processes are never killed."
            }
        }
    }

    Assert-HostMemoryForColdStart -MinimumFreeGiB $MinimumHostCommitFreeGiB

    $allocator = Enter-GpuAllocator

    try {
        $selection = Resolve-B580Selection -MinimumFreeMiB $MinFreeMiB
        $physicalDevice = [string]$selection.Device
        $physicalIndex = [int]$selection.Index
        $gpuDescription = [string]$selection.Description

        $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
        $stdout = Join-Path $LogDir "qwen3.5-b580-$stamp.out.log"
        $stderr = Join-Path $LogDir "qwen3.5-b580-$stamp.err.log"
        $args = Get-ServerArgs -ListenPort $ListenPort

        Write-Host ''
        Write-Host '============================================================'
        Write-Host ' Qwen3.5-9B / Intel Arc B580 / llama.cpp Vulkan SAFE'
        Write-Host '============================================================'
        Write-Host "Physical GPU    : $physicalDevice - $gpuDescription"
        Write-Host "GPU isolation   : GGML_VK_VISIBLE_DEVICES=$physicalIndex"
        Write-Host 'Child device    : Vulkan0'
        Write-Host "Model           : $Model"
        Write-Host "Context         : $ContextSize"
        Write-Host 'KV              : q8_0 / q8_0'
        Write-Host 'Ctx checkpoints : 0 (when supported)'
        Write-Host "API             : http://${HostAddress}:$ListenPort/v1"
        Write-Host ''

        $p = Start-IsolatedLlamaProcess `
            -PhysicalIndex $physicalIndex `
            -Arguments $args `
            -StdoutPath $stdout `
            -StderrPath $stderr

        New-GpuClaim `
            -PhysicalDevice $physicalDevice `
            -PhysicalIndex $physicalIndex `
            -ServerPid $p.Id `
            -ListenPort $ListenPort `
            -GpuDescription $gpuDescription

        $p.Id | Set-Content -LiteralPath $ServerPidFile -Encoding ascii

        @{
            pid = $p.Id
            role = $RoleName
            port = $ListenPort
            physicalDevice = $physicalDevice
            physicalIndex = $physicalIndex
            internalDevice = 'Vulkan0'
            visibleDevices = "$physicalIndex"
            gpu = $gpuDescription
            model = $Alias
            modelPath = $Model
            context = $ContextSize
            kvCacheK = 'q8_0'
            kvCacheV = 'q8_0'
            ctxCheckpoints = 0
            startedAt = (Get-Date).ToString('o')
            stdout = $stdout
            stderr = $stderr
        } |
            ConvertTo-Json -Depth 6 |
            Set-Content -LiteralPath $StateFile -Encoding UTF8
 
    if (-not (Wait-ForHealthyServer `
        -Process $p `
        -ListenPort $ListenPort `
        -StderrPath $stderr `
        -TimeoutSeconds 300)) {

        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        Remove-GpuClaimsForPid -ServerPid $p.Id
        Remove-Item -LiteralPath $ServerPidFile -Force -ErrorAction SilentlyContinue
        throw "B580 model failed to become healthy. See: $stderr"
    }

    if ($RunSmokeTest) {
        try {
            Invoke-B580SmokeTest -ListenPort $ListenPort
        }
        catch {
            Get-Content -LiteralPath $stderr -Tail 200 -ErrorAction SilentlyContinue
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            Remove-GpuClaimsForPid -ServerPid $p.Id
            Remove-Item -LiteralPath $ServerPidFile -Force -ErrorAction SilentlyContinue
            throw "B580 smoke test failed; server stopped: $($_.Exception.Message)"
        }
    }

    }
    finally {
        Exit-GpuAllocator -Mutex $allocator
    }

    Write-WatchLog (
        "server-ready pid=$($p.Id) port=$ListenPort " +
        "physical=$physicalDevice visible=$physicalIndex internal=Vulkan0 smoke=$RunSmokeTest"
    )

    Write-Host "READY. PID=$($p.Id) PhysicalGPU=$physicalDevice API=http://${HostAddress}:$ListenPort/v1" `
        -ForegroundColor Green

    return $p.Id
}

function Start-WatchdogProcess {
    param([int]$ListenPort)

    $existingWatchPid = Get-PidFromFile -Path $WatchPidFile
    if (Test-ProcessAlive -ProcessId $existingWatchPid) {
        Write-Host "Watchdog already running. PID=$existingWatchPid"
        return
    }

    Remove-Item -LiteralPath $StopFlag,$WatchHaltFile -Force `
        -ErrorAction SilentlyContinue

    $hostExe = (Get-Process -Id $PID).Path
    if (-not $hostExe) {
        throw 'Unable to resolve current PowerShell executable.'
    }

    $quotedScript = '"' + $PSCommandPath + '"'
    $quotedModel = '"' + $Model + '"'

    $watchArgs = @(
        '-NoProfile',
        '-ExecutionPolicy','Bypass',
        '-File',$quotedScript,
        '-Mode','Watch',
        '-Port',"$ListenPort",
        '-ModelPath',$quotedModel,
        '-MinFreeMiB',"$MinFreeMiB",
        '-MinimumHostCommitFreeGiB',"$MinimumHostCommitFreeGiB",
        '-MaxContextTokens',"$MaxContextTokens",
        '-SkipSmokeTest'
    )

    if ($Debug) { $watchArgs += '-Debug' }

    $watch = Start-Process `
        -FilePath $hostExe `
        -ArgumentList $watchArgs `
        -WindowStyle Hidden `
        -PassThru

    $watch.Id | Set-Content -LiteralPath $WatchPidFile -Encoding ascii
    Write-WatchLog "watchdog-started pid=$($watch.Id) port=$ListenPort"
    Write-Host "Watchdog started. PID=$($watch.Id)"
}

function Run-Watchdog {
    param([int]$ListenPort)

    $PID | Set-Content -LiteralPath $WatchPidFile -Encoding ascii
    Remove-Item -LiteralPath $WatchHaltFile -Force -ErrorAction SilentlyContinue

    Write-WatchLog "watchdog-loop-enter pid=$PID port=$ListenPort"

    $consecutiveFailures = 0
    $restartTimes = @()
    $lastResourceLog = Get-Date '2000-01-01'

    while (-not (Test-Path -LiteralPath $StopFlag)) {
        Start-Sleep -Seconds 20

        $serverPid = Get-PidFromFile -Path $ServerPidFile
        $alive = Test-ProcessAlive -ProcessId $serverPid
        $healthy = if ($alive) {
            Test-Health -ListenPort $ListenPort
        } else {
            $false
        }

        if ($alive -and $healthy) {
            $consecutiveFailures = 0

            if (((Get-Date) - $lastResourceLog).TotalMinutes -ge 5) {
                Write-ResourceSnapshot -ServerPid $serverPid
                $lastResourceLog = Get-Date
            }

            continue
        }

        $consecutiveFailures++
        Write-WatchLog "health-failure count=$consecutiveFailures pid=$serverPid alive=$alive"

        if (-not $alive) {
            Capture-RecentLlamaCrashEvent
        }

        if ($consecutiveFailures -lt 3) { continue }

        $portOwner = Get-PortOwnerPid -ListenPort $ListenPort
        if ($null -ne $portOwner -and $portOwner -ne $serverPid) {
            Write-WatchLog "restart-blocked port=$ListenPort unknown-owner=$portOwner"
            Start-Sleep -Seconds 60
            $consecutiveFailures = 0
            continue
        }

        if ($alive -and $null -ne $serverPid) {
            Write-WatchLog "watchdog-did-not-kill-unhealthy-pid=$serverPid; manual diagnosis required"
            continue
        }

        Remove-GpuClaimsForPid -ServerPid $serverPid

        $restartTimes = @(
            $restartTimes |
            Where-Object { $_ -gt (Get-Date).AddMinutes(-30) }
        )

        if ($restartTimes.Count -ge 5) {
            $message = 'Watchdog halted: >=5 restarts within 30 minutes. Manual diagnosis required.'
            $message | Set-Content -LiteralPath $WatchHaltFile -Encoding UTF8
            Write-WatchLog $message
            break
        }

        try {
            $newPid = Start-ModelServer `
                -ListenPort $ListenPort `
                -RunSmokeTest $false

            $restartTimes += Get-Date
            $consecutiveFailures = 0
            Write-WatchLog "restart-success pid=$newPid restarts30m=$($restartTimes.Count)"
        }
        catch {
            $restartTimes += Get-Date
            Write-WatchLog (
                "restart-failed restarts30m=$($restartTimes.Count) " +
                "error=$($_.Exception.Message)"
            )
            Start-Sleep -Seconds 30
        }
    }

    Write-WatchLog 'watchdog-loop-exit'
    Remove-Item -LiteralPath $WatchPidFile -Force -ErrorAction SilentlyContinue
}

function Stop-All {
    # Destructive maintenance requires explicit operator intent and exact identity.
    if (-not $ConfirmStop.IsPresent -or $ExpectedServerPid -le 0 -or [string]::IsNullOrWhiteSpace($ExpectedStartUtc)) {
        throw 'MANUAL_STOP_CONFIRMATION_REQUIRED: provide -ConfirmStop -ExpectedServerPid <PID> -ExpectedStartUtc <UTC_ISO8601>. No process was stopped.'
    }
    $listener = Get-PortOwnerPid -ListenPort $Port
    $trackedPid = Get-PidFromFile -Path $ServerPidFile
    if ($null -eq $listener -or $listener -ne $ExpectedServerPid -or $trackedPid -ne $ExpectedServerPid) {
        throw "STOP_IDENTITY_MISMATCH port=$Port expected=$ExpectedServerPid listener=$listener pidFile=$trackedPid"
    }
    $p = Get-Process -Id $ExpectedServerPid -ErrorAction Stop
    if ($p.ProcessName -ine 'llama-server') { throw "STOP_PROCESS_NAME_MISMATCH pid=$ExpectedServerPid name=$($p.ProcessName)" }
    $created = $p.StartTime.ToUniversalTime()
    $expected = [DateTimeOffset]::Parse($ExpectedStartUtc, [Globalization.CultureInfo]::InvariantCulture).ToUniversalTime().UtcDateTime
    if ([Math]::Abs(($created-$expected).TotalSeconds) -gt 2) {
        throw "STOP_PROCESS_CREATION_MISMATCH pid=$ExpectedServerPid created=$($created.ToString('o')) expected=$ExpectedStartUtc"
    }
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$ExpectedServerPid" -ErrorAction Stop
    $cmd = [string]$cim.CommandLine
    $portRegex = '(?i)(?:^|\s)--port(?:\s+|=)' + [regex]::Escape([string]$Port) + '(?:\s|$)'
    if ($cmd -notmatch $portRegex -or ($cmd -notmatch [regex]::Escape($Model) -and $cmd -notmatch [regex]::Escape($Alias))) {
        throw "STOP_COMMANDLINE_IDENTITY_MISMATCH pid=$ExpectedServerPid port=$Port"
    }
    # Do not disrupt a live trading Engine. It may need the local models.
    $enginePort = @(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue)
    $engineProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
        Where-Object { [string]$_.CommandLine -match '(?i)[\\/]apps[\\/]engine[\\/]dist[\\/]main\.js' })
    if ($enginePort.Count -or $engineProcesses.Count) {
        throw "STOP_BLOCKED_TRADING_ENGINE_PRESENT listeners=$($enginePort.Count) engineProcesses=$($engineProcesses.Count); coordinate maintenance first."
    }
    # Race check before writing watchdog stop signal.
    if ((Get-PortOwnerPid -ListenPort $Port) -ne $ExpectedServerPid) {
        throw "STOP_PORT_OWNER_CHANGED pid=$ExpectedServerPid port=$Port"
    }
    New-Item -ItemType File -Force -Path $StopFlag | Out-Null
    $watchPid = Get-PidFromFile -Path $WatchPidFile
    if ($null -ne $watchPid -and (Test-ProcessAlive -ProcessId $watchPid)) {
        $watchProc = Get-CimInstance Win32_Process -Filter "ProcessId=$watchPid" -ErrorAction Stop
        $watchCommand = [string]$watchProc.CommandLine
        # Never kill an unknown PowerShell host, and never force-stop the watcher.
        $roleStem=[IO.Path]::GetFileNameWithoutExtension($PSCommandPath)
        if ($watchCommand -notmatch '(?i)-Mode\s+Watch' -or $watchCommand -notmatch [regex]::Escape($roleStem)) {
            throw "STOP_BLOCKED_UNKNOWN_WATCHDOG pid=$watchPid; stop.flag retained; manual inspection required"
        }
        $deadline=(Get-Date).AddSeconds(75)
        while ((Get-Date) -lt $deadline -and (Test-ProcessAlive -ProcessId $watchPid)) {
            Start-Sleep -Seconds 1
        }
        if (Test-ProcessAlive -ProcessId $watchPid) {
            throw "STOP_BLOCKED_WATCHDOG_STILL_ALIVE pid=$watchPid; no server kill performed"
        }
    }
    # A legacy untracked watcher can immediately relaunch: do not proceed if found.
    $watchers=@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction Stop |
        Where-Object { $_.CommandLine -match '(?i)-Mode\s+Watch' -and $_.CommandLine -match [regex]::Escape([IO.Path]::GetFileNameWithoutExtension($PSCommandPath)) })
    if ($watchers.Count) {
        throw "STOP_BLOCKED_UNTRACKED_WATCHDOG count=$($watchers.Count); no server kill performed"
    }
    # Reconfirm identity immediately before explicit, one-time maintenance stop.
    $last=Get-Process -Id $ExpectedServerPid -ErrorAction Stop
    if ($last.StartTime.ToUniversalTime() -ne $created -or (Get-PortOwnerPid -ListenPort $Port) -ne $ExpectedServerPid) {
        throw "STOP_IDENTITY_CHANGED_BEFORE_TERMINATION; no server kill performed"
    }
    $engineListeningNow = @(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue)
    $engineProcessesNow = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
        Where-Object { [string]$_.CommandLine -match '(?i)[\\/]apps[\\/]engine[\\/]dist[\\/]main\.js' })
    if ($engineListeningNow.Count -or $engineProcessesNow.Count) {
        throw "STOP_BLOCKED_ENGINE_STARTED_DURING_WAIT: no server kill performed"
    }
    Write-Warning "Operator-confirmed maintenance stop: port=$Port pid=$ExpectedServerPid createdUtc=$($created.ToString('o'))"
    Stop-Process -Id $ExpectedServerPid -Force -ErrorAction Stop
    $deadline=(Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline -and (Test-ProcessAlive -ProcessId $ExpectedServerPid)) {
        Start-Sleep -Seconds 1
    }
    if (Test-ProcessAlive -ProcessId $ExpectedServerPid) {
        throw "STOP_NOT_CONFIRMED pid=$ExpectedServerPid; do not start replacement"
    }
    Remove-GpuClaimsForPid -ServerPid $ExpectedServerPid
    Remove-Item -LiteralPath $WatchPidFile,$ServerPidFile -Force -ErrorAction SilentlyContinue
    # Only clear the stop flag after the tracked watchdog and exact server have exited.
    Remove-Item -LiteralPath $StopFlag,$WatchHaltFile -Force -ErrorAction SilentlyContinue
    Write-WatchLog "operator-confirmed-maintenance-stop pid=$ExpectedServerPid"
    Write-Host "STOP_CONFIRMED role=$RoleName port=$Port pid=$ExpectedServerPid"
}

function Show-Status {
    param([int]$ListenPort)

    $serverPid = Get-PidFromFile -Path $ServerPidFile
    $watchPid = Get-PidFromFile -Path $WatchPidFile

    $serverAlive = Test-ProcessAlive -ProcessId $serverPid
    $watchAlive = Test-ProcessAlive -ProcessId $watchPid
    $healthy = if ($serverAlive) {
        Test-Health -ListenPort $ListenPort
    } else {
        $false
    }

    $physical = 'unknown'
    $visible = 'unknown'

    if (Test-Path -LiteralPath $StateFile) {
        try {
            $state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
            if ($state.physicalDevice) { $physical = [string]$state.physicalDevice }
            if ($state.visibleDevices) { $visible = [string]$state.visibleDevices }
        } catch {}
    }

    Write-Host "Role           : $RoleName"
    Write-Host "Server PID     : $serverPid"
    Write-Host "Server alive   : $serverAlive"
    Write-Host "Health         : $healthy"
    Write-Host "Watchdog PID   : $watchPid"
    Write-Host "Watchdog alive : $watchAlive"
    Write-Host "Physical GPU   : $physical"
    Write-Host "Visible index  : $visible"
    Write-Host 'Child device   : Vulkan0'
    Write-Host "API            : http://${HostAddress}:$ListenPort/v1"

    if (Test-Path -LiteralPath $WatchHaltFile) {
        Write-Warning (Get-Content -LiteralPath $WatchHaltFile -Raw)
    }
}

switch ($Mode) {
    'Start' {
        if (Test-Path -LiteralPath $StopFlag) {
            throw "START_BLOCKED_STOP_FLAG_PRESENT: inspect prior watchdog and stop completion before clearing $StopFlag"
        }

        $runSmoke = -not $SkipSmokeTest.IsPresent

        [void](Start-ModelServer `
            -ListenPort $Port `
            -RunSmokeTest $runSmoke)

        if ($EnableWatchdog.IsPresent -and -not $NoWatchdog.IsPresent) {
            Start-WatchdogProcess -ListenPort $Port
        }

        Write-Host ''
        Write-Host "B580 endpoint: http://${HostAddress}:$Port/v1"
        Write-Host "Status: .\$([IO.Path]::GetFileName($PSCommandPath)) -Mode Status"
        Write-Host "Stop  : .\$([IO.Path]::GetFileName($PSCommandPath)) -Mode Stop -ConfirmStop -ExpectedServerPid <PID> -ExpectedStartUtc <UTC>"
    }

    'Watch' {
        Run-Watchdog -ListenPort $Port
    }

    'Stop' {
        Stop-All
    }

    'Status' {
        Show-Status -ListenPort $Port
    }
}