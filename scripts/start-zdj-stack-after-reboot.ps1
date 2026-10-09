[CmdletBinding()]
param(
  [switch]$RegisterAtLogon,
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$ModelScriptsRoot = 'D:\MITS-WORKTREES\llama-memory-20261009\scripts\llama-vulkan',
  [string]$NodePath = (Get-Command node.exe -ErrorAction Stop).Source,
  [string]$DataRoot = 'D:\MITS\data',
  [int]$ProxyPort = 20091,
  [string]$TaskName = 'ZDJ-MITS-AfterReboot-TESTNET'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$diagnostics = Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics\reboot-orchestration'
[IO.Directory]::CreateDirectory($diagnostics) | Out-Null
$log = Join-Path $diagnostics ('startup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -LiteralPath $log -Force | Out-Null

function Write-Stage([string]$Name, [string]$State, [hashtable]$Data = @{}) {
  $row = [ordered]@{ at = [DateTimeOffset]::Now.ToString('o'); utc = [DateTimeOffset]::UtcNow.ToString('o'); stage = $Name; state = $State; data = $Data }
  [IO.File]::AppendAllText((Join-Path $diagnostics 'startup-events.jsonl'), (($row | ConvertTo-Json -Compress -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  Write-Host (($row | ConvertTo-Json -Compress -Depth 8))
}
function Assert-ListenerOwner([int]$Port, [string]$ExpectedImage, [string]$ExpectedFragment) {
  $owners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($owners.Count -ne 1) { throw "PORT_OWNER_COUNT_UNEXPECTED:${Port}:$($owners.Count)" }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($owners[0])"
  if ($proc.Name -ne $ExpectedImage -or $proc.CommandLine -notlike "*$ExpectedFragment*") { throw "PORT_OWNER_IDENTITY_MISMATCH:${Port}:$($proc.ProcessId)" }
  return $proc
}
function Get-MemorySnapshot {
  $m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
  $commitLimit = [double]$m.CommitLimit
  $committed = [double]$m.CommittedBytes
  $freeBytes = $commitLimit - $committed
  if ($freeBytes -lt 0) { $freeBytes = 0 }
  $free = $freeBytes / 1GB
  $processHandles = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'llama-server.exe' } | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).Handles })
  return [ordered]@{ commitFreeGiB = [math]::Round($free, 2); commitUsedPercent = [double]$m.PercentCommittedBytesInUse; poolPagedBytes = [double]$m.PoolPagedBytes; poolNonpagedBytes = [double]$m.PoolNonpagedBytes; llamaHandles = @($processHandles); maxLlamaHandles = if ($processHandles.Count) { ($processHandles | Measure-Object -Maximum).Maximum } else { 0 } }
}
function Test-ModelReady([int]$Port, [string]$Alias) {
  $owners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($owners.Count -eq 0) { return $false }
  $owner = Assert-ListenerOwner -Port $Port -ExpectedImage 'llama-server.exe' -ExpectedFragment "--port $Port"
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/models" -TimeoutSec 5
    $id = [string]$r.data[0].id
    if ($id -and $id -ne $Alias) { throw "MODEL_ALIAS_MISMATCH:${Port}:$id" }
    if ($id -eq $Alias) { Write-Stage "MODEL_READY_$Port" 'PASS' @{ pid = $owner.ProcessId; alias = $id; executable = $owner.ExecutablePath }; return $true }
  } catch {
    if ($_.Exception.Message -like 'MODEL_ALIAS_MISMATCH*' -or $_.Exception.Message -like 'PORT_OWNER_IDENTITY_MISMATCH*') { throw }
  }
  return $false
}
function Wait-Model([int]$Port, [string]$Alias, [string]$LaunchScript) {
  $modelsUri = "http://127.0.0.1:$Port/v1/models"
  $existing = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($existing.Count -eq 0) {
    if (-not (Test-Path -LiteralPath $LaunchScript)) { throw "MODEL_SCRIPT_MISSING:$LaunchScript" }
    $modelLog = Join-Path $diagnostics ("model-$Port-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
    $pwsh = (Get-Command powershell.exe -ErrorAction Stop).Source
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$LaunchScript`" -Mode Start -NoWatchdog"
    $child = Start-Process -FilePath $pwsh -ArgumentList $arg -WorkingDirectory (Split-Path -Parent $LaunchScript) -RedirectStandardOutput $modelLog -RedirectStandardError ($modelLog + '.err') -WindowStyle Hidden -PassThru
    Write-Stage "MODEL_LAUNCH_$Port" 'STARTED_ONCE' @{ launcherPid = $child.Id; log = $modelLog; watchdog = $false }
  } else {
    $owner = Assert-ListenerOwner -Port $Port -ExpectedImage 'llama-server.exe' -ExpectedFragment "--port $Port"
    Write-Stage "MODEL_LAUNCH_$Port" 'ALREADY_PRESENT' @{ pid = $owner.ProcessId }
  }
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(45)
  do {
    try {
      $r = Invoke-RestMethod -Uri $modelsUri -TimeoutSec 5
      $id = [string]$r.data[0].id
      if ($id -eq $Alias) {
        $owner = Assert-ListenerOwner -Port $Port -ExpectedImage 'llama-server.exe' -ExpectedFragment "--port $Port"
        Write-Stage "MODEL_READY_$Port" 'PASS' @{ pid = $owner.ProcessId; alias = $id; executable = $owner.ExecutablePath }
        return
      }
      if ($id) { throw "MODEL_ALIAS_MISMATCH:${Port}:$id" }
    } catch {
      if ($_.Exception.Message -like 'MODEL_ALIAS_MISMATCH*' -or $_.Exception.Message -like 'PORT_OWNER_IDENTITY_MISMATCH*') { throw }
    }
    Start-Sleep -Seconds 5
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw "MODEL_READY_TIMEOUT_NO_RETRY:$Port"
}
function Invoke-NodeDiagnostic([string]$Executable, [string]$ScriptPath, [string]$OutputDirectory) {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.Arguments = ('"' + $ScriptPath.Replace('"','\"') + '" --current-only --out-dir "' + $OutputDirectory.Replace('"','\"') + '"')
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
  if (-not $process.Start()) { throw 'TESTNET_DIAGNOSTIC_PROCESS_START_FAILED' }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit(); $stdout = $stdoutTask.GetAwaiter().GetResult(); $stderr = $stderrTask.GetAwaiter().GetResult()
  [IO.File]::WriteAllText((Join-Path $OutputDirectory 'stdout.log'), $stdout, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $OutputDirectory 'stderr.log'), $stderr, [Text.UTF8Encoding]::new($false))
  if ($stdout) { Write-Host $stdout.TrimEnd() }; if ($stderr) { Write-Host ('DIAGNOSTIC_STDERR: ' + $stderr.Trim()) }
  $exitCode = [int]$process.ExitCode; $process.Dispose(); return $exitCode
}

try {
  if ($RegisterAtLogon) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
      $act = $existing.Actions | Select-Object -First 1
      if ($act.Execute -notmatch 'powershell' -or $act.Arguments -notlike "*start-zdj-stack-after-reboot.ps1*") { throw "TASK_NAME_COLLISION:$TaskName" }
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    $script = Join-Path $PSScriptRoot 'start-zdj-stack-after-reboot.ps1'
    $action = New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -ProjectRoot `"$ProjectRoot`" -ModelScriptsRoot `"$ModelScriptsRoot`" -NodePath `"$NodePath`" -DataRoot `"$DataRoot`" -ProxyPort $ProxyPort"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $trigger.Delay = 'PT30S'
    $settingsTask = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settingsTask -Principal $principal -Description 'Sequential TESTNET model, proxy and fail-closed Engine startup. No automatic retries or restart actions.' | Out-Null
    Write-Stage 'TASK_REGISTER' 'PASS' @{ taskName = $TaskName; trigger = 'AtLogOn+30s'; restartOnFailure = $false; action = $action.Arguments }
    return
  }

  $modelNames = @('start-qwen3.5-9b-vulkan.ps1','start-qwen3.8-27b-harness-vulkan1.ps1','start-qwen3.8-27b-zdj-vulkan1.ps1')
  $warmModels = (Test-ModelReady 8081 'qwen3.5:9b') -and (Test-ModelReady 8083 'qwen/qwen3.8-27b') -and (Test-ModelReady 8084 'qwen/qwen3.8-27b')
  if (-not $warmModels) { foreach ($script in $modelNames) { if (-not (Test-Path -LiteralPath (Join-Path $ModelScriptsRoot $script))) { throw "MODEL_SCRIPT_ROOT_UNAVAILABLE:$ModelScriptsRoot" } } }
  $mem = Get-MemorySnapshot
  if (-not $warmModels -and $mem.commitFreeGiB -lt 70) { throw "COMMIT_HEADROOM_BELOW_COLD_MODEL_LOAD:$($mem.commitFreeGiB)GiB" }
  Write-Stage 'PRE_MODEL_MEMORY' $(if ($warmModels) { 'WARM_MODELS_SKIP_COLD_GATE' } else { 'COLD_START_GATE_PASS' }) $mem
  Wait-Model 8081 'qwen3.5:9b' (Join-Path $ModelScriptsRoot $modelNames[0])
  Wait-Model 8083 'qwen/qwen3.8-27b' (Join-Path $ModelScriptsRoot $modelNames[1])
  $mem = Get-MemorySnapshot
  if ($mem.commitFreeGiB -lt 40 -or $mem.maxLlamaHandles -ge 100000) { throw "PRIMARY_MODEL_RESOURCE_GATE_BLOCKED:$($mem | ConvertTo-Json -Compress)" }
  Write-Stage 'PRE_PRIMARY_MEMORY' 'PASS' $mem
  Wait-Model 8084 'qwen/qwen3.8-27b' (Join-Path $ModelScriptsRoot $modelNames[2])
  $mem = Get-MemorySnapshot
  $memorySamples = @($mem)
  for ($sample = 0; $sample -lt 4; $sample++) { Start-Sleep -Seconds 5; $memorySamples += (Get-MemorySnapshot) }
  $mem = $memorySamples[-1]
  $poolRise = [double]$mem.poolPagedBytes + [double]$mem.poolNonpagedBytes - [double]$memorySamples[0].poolPagedBytes - [double]$memorySamples[0].poolNonpagedBytes
  if ($mem.commitFreeGiB -lt 16 -or $mem.commitUsedPercent -ge 85 -or $mem.maxLlamaHandles -ge 100000 -or $poolRise -gt 256MB) { throw "POST_MODEL_RESOURCE_GATE_BLOCKED:$($mem | ConvertTo-Json -Compress):poolRiseBytes=$poolRise" }
  Write-Stage 'MODELS' 'PASS' @{ snapshot = $mem; sampleCount = $memorySamples.Count; sampleIntervalSeconds = 5; poolRiseBytes = $poolRise; warmModels = $warmModels }

  $proxyScript = 'D:\MITS\scripts\vpn\zdj-trade-proxy-client-windows.ps1'
  if (-not (Test-Path -LiteralPath $proxyScript)) { throw "REQUIRED_PROXY_SCRIPT_MISSING:$proxyScript" }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $proxyScript -Status -LocalPort $ProxyPort
  if ($LASTEXITCODE -ne 0) { throw "PROXY_STATUS_FAILED:$LASTEXITCODE" }
  $proxyOwners = @(Get-NetTCPConnection -State Listen -LocalPort $ProxyPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($proxyOwners.Count -eq 0) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $proxyScript -LocalPort $ProxyPort
    if ($LASTEXITCODE -ne 0) { throw "PROXY_START_FAILED:$LASTEXITCODE" }
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $proxyScript -Status -LocalPort $ProxyPort
  if ($LASTEXITCODE -ne 0) { throw "PROXY_NOT_READY:$LASTEXITCODE" }
  Assert-ListenerOwner -Port $ProxyPort -ExpectedImage 'ssh.exe' -ExpectedFragment "127.0.0.1:$ProxyPort" | Out-Null
  Write-Stage 'PROXY' 'PASS' @{ script = $proxyScript; localPort = $ProxyPort }

  $gateOut = Join-Path $diagnostics ('exchange-gate-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  [IO.Directory]::CreateDirectory($gateOut) | Out-Null
  $env:ZDJ_SETTINGS_DB = Join-Path $DataRoot 'zdj-settings.sqlite'
  $gateExit = 125
  try { $gateExit = Invoke-NodeDiagnostic -Executable $NodePath -ScriptPath (Join-Path $ProjectRoot 'scripts\v398-integrity-current-gate.mjs') -OutputDirectory $gateOut }
  catch { Write-Stage 'TESTNET_TP_DIAGNOSTIC' 'UNKNOWN_DIAGNOSTIC_PROCESS_ERROR' @{ error = $_.Exception.Message; exchangeWrites = 0 } }
  $gatePath = Join-Path $gateOut 'testnet-start-gate.json'
  $gateState = 'UNKNOWN'; $gate = $null
  if (Test-Path $gatePath) { $gate = Get-Content -Raw -LiteralPath $gatePath | ConvertFrom-Json; $gateState = [string]$gate.gate }
  Write-Stage 'TESTNET_TP_DIAGNOSTIC' 'TP_UNVERIFIED_ENGINE_START_ALLOWED' @{ diagnosticState = $gateState; helperExit = $gateExit; evidence = $gatePath; nonzeroPositions = if ($gate) { $gate.nonzeroPositions } else { $null }; candidateProtectionMatches = if ($gate) { $gate.candidateProtectionMatches } else { $null }; assessment = if ($gate) { $gate.protectionAssessment } else { 'UNVERIFIED' }; entryAdmission = 'DISABLED_UNTIL_TP_IDENTITY_REVIEW'; exchangeWrites = 'EXISTING_DURABLE_GUARDS_ONLY' }

  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'apps\engine\dist\main.js'))) { throw 'BUILT_ENGINE_ENTRYPOINT_MISSING' }
  $head = (& git -C $ProjectRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'PROJECT_HEAD_UNAVAILABLE' }
  $engineOwners = @(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue)
  if ($engineOwners.Count) { throw 'ENGINE_PORT_ALREADY_OWNED_NO_TAKEOVER' }
  $launchId = [guid]::NewGuid().ToString()
  $engineLogDir = Join-Path $diagnostics 'engine'
  [IO.Directory]::CreateDirectory($engineLogDir) | Out-Null
  $hostScript = Join-Path $ProjectRoot 'scripts\start-zdj-engine-host.ps1'
  $hostArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$hostScript,'-NodePath',$NodePath,'-EnginePath',(Join-Path $ProjectRoot 'apps\engine\dist\main.js'),'-WorkingDirectory',(Join-Path $ProjectRoot 'apps\engine'),'-StdoutPath',(Join-Path $engineLogDir ($launchId+'.stdout.log')),'-StderrPath',(Join-Path $engineLogDir ($launchId+'.stderr.log')),'-LifecyclePath',(Join-Path $engineLogDir 'lifecycle.jsonl'),'-ReceiptPath',(Join-Path $engineLogDir 'current-receipt.json'),'-LaunchId',$launchId)
  $env:ZDJ_CONFIG_DIR = Join-Path $ProjectRoot 'config'; $env:ZDJ_DATA_DIR = $DataRoot; $env:ZDJ_START_REASON = 'MANUAL_START'; $env:ZDJ_ENTRY_ADMISSION_DISABLED = '1'
  $encodedArgs = ($hostArgs | ForEach-Object { '"' + ($_ -replace '"','\"') + '"' }) -join ' '
  $host = Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList $encodedArgs -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
  Write-Stage 'ENGINE_HOST' 'STARTED_ONCE' @{ hostPid = $host.Id; launchId = $launchId; sourceHead = $head; proxyPort = $ProxyPort; stdout = (Join-Path $engineLogDir ($launchId+'.stdout.log')); stderr = (Join-Path $engineLogDir ($launchId+'.stderr.log')) }
} catch {
  Write-Stage 'ORCHESTRATOR' 'FAILED_CLOSED' @{ error = $_.Exception.Message; engineStartedByThisRun = $false }
  throw
} finally { Stop-Transcript | Out-Null }
