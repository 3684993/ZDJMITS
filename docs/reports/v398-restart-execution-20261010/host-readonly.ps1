$ErrorActionPreference = 'Stop'
$observedAt = [DateTime]::UtcNow.ToString('o')
$listeners = Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in @(8080,8081,8083,8084,20091) } | Sort-Object LocalPort | Select-Object LocalAddress,LocalPort,OwningProcess
$allProcesses = @(Get-CimInstance Win32_Process)
$watch = @($allProcesses | Where-Object { $_.ProcessId -ne $PID -and $_.Name -match '^(powershell|pwsh)\.exe$' -and $_.CommandLine -match '\s-File\s+[^\r\n]*zdj-trade-proxy-client-windows\.ps1.*\s-Watch(?:\s|$)' } | Select-Object ProcessId,ParentProcessId,Name,CreationDate)
$engine = $allProcesses | Where-Object ProcessId -eq 18100 | Select-Object ProcessId,ParentProcessId,Name,CreationDate,ExecutablePath
$observer = $allProcesses | Where-Object ProcessId -eq 17772 | Select-Object ProcessId,ParentProcessId,Name,CreationDate
$proxyRoot = Join-Path $env:LOCALAPPDATA 'ZDJ-MITS\trade-proxy'
$health = Get-Content -LiteralPath (Join-Path $proxyRoot 'tunnel-health.json') -Raw | ConvertFrom-Json
$events = @(Get-Content -LiteralPath (Join-Path $proxyRoot 'tunnel-events.jsonl') -Tail 12 | ForEach-Object { $_ | ConvertFrom-Json } | ForEach-Object { [ordered]@{ at=$_.at; event=$_.event; pid=$_.payload.pid; healthy=$_.payload.healthy; elapsedMs=$_.payload.elapsedMs } })
$tasks = @(Get-ScheduledTask | Where-Object TaskName -like '*ZDJ*' | ForEach-Object { $info = $_ | Get-ScheduledTaskInfo; [ordered]@{ name=$_.TaskName; state=[string]$_.State; hiddenWscript=(@($_.Actions).Count -gt 0 -and @($_.Actions | Where-Object { $_.Execute -notmatch '(?i)wscript(?:\.exe)?$' }).Count -eq 0); lastRunTime=$info.LastRunTime; lastTaskResult=$info.LastTaskResult } })
$approval = Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'ZDJMITS\entry-authorization\v398-testnet-entry.json') -Raw | ConvertFrom-Json
$result = [ordered]@{
  observedAt=$observedAt; lifecycleAttempts=0; settingsWrites=0; taskChanges=0; routeChanges=0
  listeners=@($listeners); engine=$engine; crashObserver=$observer; exactFileInvocationProxyWatchProcesses=$watch
  proxyHealthHistory=[ordered]@{ at=$health.at; healthy=$health.healthy; pid=$health.pid; failurePhase=$health.failurePhase; ageSeconds=([DateTime]::UtcNow-[DateTime]::Parse($health.at).ToUniversalTime()).TotalSeconds; authoritativeForCurrentTransport=$false }
  proxyEventsHistory=$events; proxyStderr=[ordered]@{ byteLength=(Get-Item -LiteralPath (Join-Path $proxyRoot 'ssh-tunnel.stderr.log')).Length; contentRead='FAILED_FILE_LOCK_NOT_A_CLEAN_LOG_PROOF' }
  tasks=$tasks; approval=[ordered]@{ mode=$approval.mode; revoked=$approval.revoked; settingsVersion=$approval.settingsVersion; sourceSha256=$approval.sourceSha256; artifactSha256=$approval.artifactSha256; entrypointSha256=$approval.entrypointSha256; approvedAt=$approval.approvedAt; expiresAt=$approval.expiresAt; authorizesNewCandidate=$false }
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'host-evidence.json') -Encoding utf8
