# One-shot THREE-MODEL + ENGINE recovery viability assessment (READ ONLY).
# This script DOES NOT start/restart/stop ANY process, perform trading or modify pagefile.
# Conservative all-model reserve based on measured 27B private commit and startup transients.
[CmdletBinding()]
param([ValidateRange(60,160)][int]$RequiredCommitFreeGiB=70)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
$limitGiB=[double]$m.CommitLimit/1GB
$committedGiB=[double]$m.CommittedBytes/1GB
$freeGiB=$limitGiB-$committedGiB
$usedRatio=if($limitGiB -gt 0){$committedGiB/$limitGiB}else{1.0}
$engineListeners=@(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue)
$engineProcs=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
    Where-Object {[string]$_.CommandLine -match '(?i)[\\/]apps[\\/]engine[\\/]dist[\\/]main\.js'})
$rows=@(foreach($role in @(
    @{name='9B';port=8081},
    @{name='Harness27B';port=8083},
    @{name='Primary27B';port=8084}
)){
    $owners=@(Get-NetTCPConnection -State Listen -LocalPort $role.port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    $p=$null
    if($owners.Count -eq 1){$p=Get-Process -Id $owners[0] -ErrorAction SilentlyContinue}
    [pscustomobject]@{
        role=$role.name
        port=$role.port
        listenerCount=$owners.Count
        processId=$(if($p){$p.Id}else{$null})
        processName=$(if($p){$p.ProcessName}else{$null})
        handles=$(if($p){$p.HandleCount}else{$null})
        privateGiB=$(if($p){[Math]::Round($p.PrivateMemorySize64/1GB,2)}else{$null})
    }
})
$highHandles=@(Get-Process -Name llama-server -ErrorAction SilentlyContinue |
    Where-Object {$_.HandleCount -ge 100000})
$blocked=@()
if($freeGiB -lt $RequiredCommitFreeGiB){$blocked+=("COMMIT_BUDGET {0:N2}GiB < {1}GiB" -f $freeGiB,$RequiredCommitFreeGiB)}
if($usedRatio -ge .80){$blocked+=("CURRENT_COMMIT_RATIO {0:P1} >= 80%" -f $usedRatio)}
if($engineListeners.Count -or $engineProcs.Count){$blocked+='ENGINE_RUNNING_OR_PORT_OCCUPIED: use existing process, no second start'}
if($highHandles.Count){$blocked+='UNRESOLVED_EXCESSIVE_LLAMA_HANDLES'}
$nine=@($rows|Where-Object {$_.role -eq '9B'})
if($nine.Count -ne 1 -or $nine[0].listenerCount -ne 1 -or $nine[0].processName -ne 'llama-server'){
    $blocked+='EXISTING_9B_LISTENER_IDENTITY_NOT_CLOSED'
}
foreach($r in @($rows|Where-Object {$_.role -ne '9B'})){
    if($r.listenerCount -ne 0){$blocked+=("$($r.role)_PORT_NOT_EMPTY")}
}
$report=[ordered]@{
    purpose='READ_ONLY_THREE_MODEL_RECOVERY_BUDGET'
    atUtc=[DateTimeOffset]::UtcNow.ToString('o')
    usedCommitGiB=[Math]::Round($committedGiB,3)
    commitLimitGiB=[Math]::Round($limitGiB,3)
    freeCommitGiB=[Math]::Round($freeGiB,3)
    usedRatio=[Math]::Round($usedRatio,4)
    requiredCommitFreeGiB=$RequiredCommitFreeGiB
    pagedPoolGiB=[Math]::Round([double]$m.PoolPagedBytes/1GB,3)
    nonpagedPoolGiB=[Math]::Round([double]$m.PoolNonpagedBytes/1GB,3)
    enginesFound=$engineProcs.Count
    engineListeners=$engineListeners.Count
    models=$rows
    resourceBlockers=$blocked
    eligibleForFurtherIndependentChecks=($blocked.Count -eq 0)
    engineDeploymentIdentity='UNKNOWN_MUST_CHECK_MAIN_WORKTREE_AND_LIVE_TESTNET_FRESHNESS'
    caveat='Not permission to start, not a forecast for actual load, no Engine or trade authorization inferred from this check.'
    action='NO_START_NO_STOP_NO_TRADE_NO_WINDOWS_SETTING_CHANGE'
}
$folder=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
[IO.Directory]::CreateDirectory($folder)|Out-Null
$out=Join-Path $folder ('full-recovery-preflight-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
[IO.File]::WriteAllText($out,($report|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
Write-Host ("COMMIT: {0:N2}/{1:N2}GiB free={2:N2}GiB; three-model preflight reserve={3}GiB" -f $committedGiB,$limitGiB,$freeGiB,$RequiredCommitFreeGiB)
Write-Host ("POOLS: paged={0:N2}GiB nonpaged={1:N2}GiB" -f $report.pagedPoolGiB,$report.nonpagedPoolGiB)
$rows|Format-Table role,port,listenerCount,processId,handles,privateGiB -AutoSize|Out-Host
if($blocked.Count){
    Write-Warning 'ALL_MODEL_RESTART_BLOCKED: do NOT sequentially start two 27B under this commit budget.'
    foreach($reason in $blocked){Write-Host "BLOCK: $reason"}
}else{
    Write-Host 'RESOURCE_PRECHECK_PASS_ONLY: fresh TESTNET account/safeguards, exact Engine build and all model APIs still require separate verification.'
}
Write-Host "LOCAL_ONLY_PREFLIGHT: $out"
Write-Host 'NO_MODEL_ENGINE_WINDOWS_TRADE_ACTION_PERFORMED'
