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
  function Test-Tunnel {return [pscustomobject]@{healthy=$false;failurePhase='SOCKS_CONNECT_REPLY';elapsedMs=1}}
  function Start-Sleep {param($Seconds,$Milliseconds)}
  $bounded=$false;try{Main|Out-Null}catch{$bounded=$_.Exception.Message -like 'RESTART_BUDGET_EXHAUSTED*'}
  if(-not $bounded -or $script:starts -ne 3 -or $script:stops -ne 2){throw 'Failed start/restart budget not bounded'}
  Write-Output 'VPN_CLIENT_TEST_PASS: foreign owner, pid reuse, real stalled peer deadline/socket close, finite failed-start recovery, no embedded secret'
}finally{
  # Resolve and check the exact generated temp directory before recursive cleanup.
  $resolved=[IO.Path]::GetFullPath($testRoot);$parent=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
  if($resolved.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'zdj-proxy-test-*'){
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
