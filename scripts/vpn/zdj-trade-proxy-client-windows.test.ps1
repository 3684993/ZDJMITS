$ErrorActionPreference='Stop'
$testRoot=Join-Path $env:TEMP ('zdj-proxy-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot|Out-Null
$script=Join-Path $PSScriptRoot 'zdj-trade-proxy-client-windows.ps1'
try {
  . $script -BaseDir $testRoot -ProbeTimeoutSeconds 1
  $errors=$null;[Management.Automation.Language.Parser]::ParseFile($script,[ref]$null,[ref]$errors)|Out-Null
  if($errors){throw 'Parse error'}
  $text=[IO.File]::ReadAllText($script)
  if($text.Contains('BEGIN OPENSSH PRIVATE KEY')){throw 'Embedded key forbidden'}
  # Foreign listener/process must never be adopted or killed based on pid alone.
  $foreign=[pscustomobject]@{ProcessId=7;Name='ssh.exe';ExecutablePath=$ssh;CommandLine='ssh.exe -N -D 127.0.0.1:9999 other@elsewhere'}
  $rejected=$false;try{Assert-Owned $foreign}catch{$rejected=$_.Exception.Message -like '*OWNER_NOT_PROVEN*'}
  if(-not $rejected){throw 'Foreign process accepted'}
  $owned=[pscustomobject]@{ProcessId=17;Name='ssh.exe';ExecutablePath=$ssh;CommandLine="ssh.exe -N -D 127.0.0.1:20091 -p 22091 -i $keyPath zdjproxy@43.156.0.24";CreationDate=[datetime]'2026-01-01'}
  Assert-Owned $owned
  Save-Json $receiptPath @{pid=17;createdAt='2026-01-02T00:00:00Z'}
  $rejected=$false;try{Assert-Owned $owned}catch{$rejected=$_.Exception.Message -eq 'PID_REUSE_DO_NOT_KILL'}
  if(-not $rejected){throw 'Pid reuse accepted'}
  Remove-Item -LiteralPath $receiptPath
  # A real stalled localhost SOCKS peer must expire at the shared deadline and close.
  $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start()
  $LocalPort=$listener.LocalEndpoint.Port
  function Get-Owner { return [pscustomobject]@{ProcessId=17} }
  function Assert-Owned($Process) { }
  $health=Test-Tunnel
  $peer=$listener.AcceptTcpClient();$peer.ReceiveTimeout=1000
  $buffer=New-Object byte[] 16;[void]$peer.GetStream().Read($buffer,0,16)
  if($peer.GetStream().Read($buffer,0,16) -ne 0){throw 'Cancelled probe socket still open'}
  $peer.Dispose();$listener.Stop()
  if($health.healthy -or $health.failurePhase -ne 'SOCKS_GREETING' -or $health.elapsedMs -gt 2500){throw 'Stalled peer deadline not enforced'}
  # Initial and replacement SSH exits must consume a finite recovery budget.
  # Every lifecycle function is replaced before Main; no real SSH is started/stopped.
  $Watch=$true;$Restart=$false;$MaxRestarts=2;$FailureThreshold=1;$RunForSeconds=0
  $script:starts=0;$script:stops=0
  function Get-Owner {return $null}
  function Start-OwnedTunnel {$script:starts++;throw 'SSH_EXITED fixture'}
  function Stop-OwnedTunnel {$script:stops++}
  $script:probes=0
  function Test-Tunnel {$script:probes++;if($script:probes -ge 7){throw 'FIXTURE_OBSERVATION_COMPLETE'};return [pscustomobject]@{healthy=$false;failurePhase='SOCKS_CONNECT_REPLY';elapsedMs=1}}
  function Start-Sleep {param($Seconds,$Milliseconds)}
  $observed=$false;try{Main|Out-Null}catch{$observed=$_.Exception.Message -eq 'FIXTURE_OBSERVATION_COMPLETE'}
  if(-not $observed -or $script:probes -ne 7 -or $script:starts -ne 3 -or $script:stops -ne 2){throw 'Exhausted restart budget disabled monitoring or restarted again'}
  $budgetEvents=@(Get-Content -LiteralPath $eventPath|ForEach-Object {$_|ConvertFrom-Json}|Where-Object {$_.event -eq 'RESTART_BUDGET_EXHAUSTED'})
  if($budgetEvents.Count -ne 1){throw 'Exhausted budget alert is missing or repeated on every tick'}
  # Restoring observation after a spent budget may grant zero lifecycle attempts.
  $MaxRestarts=0;$script:starts=0;$script:stops=0;$script:probes=0
  function Get-Owner {return [pscustomobject]@{ProcessId=17}}
  function Test-Tunnel {$script:probes++;if($script:probes -ge 4){throw 'FIXTURE_ZERO_RESTART_OBSERVATION_COMPLETE'};return [pscustomobject]@{healthy=$false;failurePhase='SOCKS_CONNECT_REPLY';elapsedMs=1}}
  $observed=$false;try{Main|Out-Null}catch{$observed=$_.Exception.Message -eq 'FIXTURE_ZERO_RESTART_OBSERVATION_COMPLETE'}
  if(-not $observed -or $script:starts -ne 0 -or $script:stops -ne 0){throw 'Read-only guardian restoration touched SSH lifecycle'}
  # One-shot restart restores the monitor even if public verification still fails.
  # All lifecycle functions remain fixtures: no production process is touched.
  $Watch=$false;$Restart=$true;$script:restored=0;$script:guardianStops=0
  function Test-Tunnel {return [pscustomobject]@{healthy=$false;failurePhase='SOCKS_CONNECT_REPLY';elapsedMs=1}}
  function Stop-Guardian {$script:guardianStops++}
  function Start-Guardian {$script:restored++}
  function Start-OwnedTunnel {$script:starts++}
  $failed=$false;try{Main|Out-Null}catch{$failed=$_.Exception.Message -like 'TUNNEL_UNHEALTHY*'}
  if(-not $failed -or $script:restored -ne 1 -or $script:guardianStops -ne 1){throw 'Restart lost guardian after failed probe'}
  if($text -match 'AddMinutes\(-15\)') {throw 'Lifetime restart budget must not reset on clock passage'}
  Write-Output 'VPN_CLIENT_TEST_PASS: foreign owner, pid reuse, real stalled peer deadline/socket close, finite failed-start recovery, no embedded secret'
}finally{
  # Resolve and check the exact generated temp directory before recursive cleanup.
  $resolved=[IO.Path]::GetFullPath($testRoot);$parent=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
  if($resolved.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'zdj-proxy-test-*'){
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
