# Three-model maintenance PLAN only. No engine/model lifecycle changes.
[CmdletBinding()]
param([string]$LlamaDir='D:\llama-vulkan')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
$freeGiB=([double]$m.CommitLimit-[double]$m.CommittedBytes)/1GB
$useRatio=[double]$m.CommittedBytes/[double]$m.CommitLimit
$engineListening=@(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue)
$engines=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
    Where-Object { [string]$_.CommandLine -match '(?i)[\\/]apps[\\/]engine[\\/]dist[\\/]main\.js' })
$roles=@(
    [pscustomobject]@{role='9B';port=8081;runtime='qwen35-b580-vulkan';device='B580'},
    [pscustomobject]@{role='Harness27B';port=8083;runtime='harness-qwen38-vulkan1';device='Vulkan1 AMD7900XTX'},
    [pscustomobject]@{role='Primary27B';port=8084;runtime='zdj-qwen38';device='Vulkan2 AMD7900XTX'}
)
Write-Host ('Host COMMIT {0:N2}/{1:N2} GiB (free {2:N2}, {3:P1} used)' -f ([double]$m.CommittedBytes/1GB),([double]$m.CommitLimit/1GB),$freeGiB,$useRatio)
Write-Host ('Kernel PagedPool {0:N2} GiB; NonpagedPool {1:N2} GiB' -f ([double]$m.PoolPagedBytes/1GB),([double]$m.PoolNonpagedBytes/1GB))
if($engineListening.Count -or $engines.Count){Write-Warning "ENGINE_MAINTENANCE_BLOCKED: 8080 listeners=$($engineListening.Count), matching Node Engine processes=$($engines.Count)."}
$results=@(foreach($r in $roles){
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $r.port -ErrorAction SilentlyContinue)
    $ownedPids=@($listeners | ForEach-Object { $_.OwningProcess } | Select-Object -Unique)
    $runtimeDir=Join-Path (Join-Path $LlamaDir 'runtime') $r.runtime
    $watchFile=Join-Path $runtimeDir 'watchdog.pid'
    $pidFile=Join-Path $runtimeDir 'server.pid'
    $serverPidFromFile=$null
    $watchPidFromFile=$null
    foreach($item in @(@{path=$pidFile;kind='server'},@{path=$watchFile;kind='watch'})){
        if(Test-Path -LiteralPath $item.path -PathType Leaf){
            $txt=(Get-Content -LiteralPath $item.path -Raw -ErrorAction SilentlyContinue).Trim()
            if($txt -match '^\d+$'){
                if($item.kind -eq 'server'){$serverPidFromFile=[int]$txt}else{$watchPidFromFile=[int]$txt}
            }
        }
    }
    $p=$null
    $pid=$null
    if($ownedPids.Count -eq 1){$pid=[int]$ownedPids[0];$p=Get-Process -Id $pid -ErrorAction SilentlyContinue}
    [pscustomobject]@{
        role=$r.role;port=$r.port;device=$r.device
        listenerPid=$pid;serverPidFile=$serverPidFromFile
        watchdogPidFile=$watchPidFromFile
        watchdogAlive=$(if($null -eq $watchPidFromFile){$null}else{[bool](Get-Process -Id $watchPidFromFile -ErrorAction SilentlyContinue)})
        processName=$(if($p){$p.ProcessName}else{$null})
        startedUtc=$(if($p){try{$p.StartTime.ToUniversalTime().ToString('o')}catch{$null}}else{$null})
        handleCount=$(if($p){$p.HandleCount}else{$null})
        privateGiB=$(if($p){[Math]::Round($p.PrivateMemorySize64/1GB,3)}else{$null})
        pidFileMatchesListener=($null -ne $pid -and $serverPidFromFile -eq $pid)
    }
})
$results|Format-Table -AutoSize|Out-Host
$blocked=($freeGiB -lt 20 -or $useRatio -ge 0.90 -or $engineListening.Count -gt 0 -or $engines.Count -gt 0)
if(@($results|Where-Object {$_.handleCount -ge 100000}).Count){$blocked=$true}
if(@($results|Where-Object {$_.listenerPid -and -not $_.pidFileMatchesListener}).Count){$blocked=$true}
$doc=[ordered]@{utc=[DateTimeOffset]::UtcNow.ToString('o');mode='READ_ONLY_MAINTENANCE_PLAN';commitFreeGiB=[Math]::Round($freeGiB,3);commitUsedRatio=$useRatio;engineListeningCount=$engineListening.Count;engineProcessCount=$engines.Count;requiresManualApproval=$true;safeToColdRestartNow=(-not $blocked);models=$results;note='A false result prevents restart. Even true is only a resource preflight, not permission or an execution guarantee.'}
$folder=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
[IO.Directory]::CreateDirectory($folder)|Out-Null
$file=Join-Path $folder ('model-maintenance-preflight-'+(Get-Date -Format yyyyMMdd-HHmmss)+'.json')
[IO.File]::WriteAllText($file,($doc|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
Write-Host "LOCAL_ONLY_PLAN: $file"
if($blocked){Write-Warning "MAINTENANCE_RESTART_BLOCKED: commit/Engine/PID/handle constraints. No process was touched."}
Write-Host "NO_MODEL_STOP_OR_START_PERFORMED"
