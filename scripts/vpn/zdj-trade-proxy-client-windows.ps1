[CmdletBinding()]
param(
  [switch]$Restart, [switch]$Stop, [switch]$Status, [switch]$Watch,
  [string]$BaseDir = (Join-Path $env:LOCALAPPDATA 'ZDJ-MITS\trade-proxy'),
  [ValidateRange(1,65535)][int]$LocalPort = 20091,
  [ValidateRange(1,60)][int]$ProbeTimeoutSeconds = 8,
  [ValidateRange(5,300)][int]$HealthIntervalSeconds = 30,
  [ValidateRange(1,10)][int]$FailureThreshold = 3,
  [ValidateRange(0,2)][int]$MaxRestarts = 2,
  [ValidateRange(0,86400)][int]$RunForSeconds = 0
)
# Existing deployment: same user, host, SSH port, SOCKS bind and secure local key.
# No private key is embedded, generated, overwritten, printed or uploaded.
$ErrorActionPreference='Stop'
$ServerIp='43.156.0.24'; $ServerPort=22091; $ProxyUser='zdjproxy'
$keyPath=Join-Path $BaseDir 'id_ed25519'; $knownHosts=Join-Path $BaseDir 'known_hosts'
$pidPath=Join-Path $BaseDir 'ssh-tunnel.pid'; $receiptPath=Join-Path $BaseDir 'ssh-tunnel.json'
$guardianPath=Join-Path $BaseDir 'ssh-guardian.json'; $statePath=Join-Path $BaseDir 'tunnel-health.json'
$eventPath=Join-Path $BaseDir 'tunnel-events.jsonl'; $stderrPath=Join-Path $BaseDir 'ssh-tunnel.stderr.log'
$stdoutPath=Join-Path $BaseDir 'ssh-tunnel.stdout.log'
$ssh=(Get-Command ssh.exe -ErrorAction Stop).Source
function Write-TunnelEvent($Name,$Payload) {
  if ((Test-Path -LiteralPath $eventPath) -and (Get-Item -LiteralPath $eventPath).Length -gt 1MB) {
    Move-Item -LiteralPath $eventPath -Destination ($eventPath+'.previous') -Force
  }
  $row=@{at=(Get-Date).ToUniversalTime().ToString('o');event=$Name;payload=$Payload}
  [IO.File]::AppendAllText($eventPath,($row|ConvertTo-Json -Depth 8 -Compress)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
}
function Save-Json($Path,$Value) {
  [IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
}
function Get-Owner {
  $owners=@(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)
  $ids=@($owners|Select-Object -ExpandProperty OwningProcess -Unique)
  if($ids.Count -gt 1){throw 'MULTIPLE_LISTENER_OWNERS'}
  if($ids.Count -eq 1){ return Get-CimInstance Win32_Process -Filter "ProcessId=$($ids[0])" }
  if(Test-Path -LiteralPath $pidPath) {
    $candidate=0
    if([int]::TryParse(([IO.File]::ReadAllText($pidPath)).Trim(),[ref]$candidate) -and $candidate -gt 0){
      return Get-CimInstance Win32_Process -Filter "ProcessId=$candidate" -ErrorAction SilentlyContinue
    }
  }
  return $null
}
function Assert-Owned($Process) {
  if(-not $Process){return}
  $command=[string]$Process.CommandLine
  $bind='127.0.0.1:'+$LocalPort
  if($Process.Name -ne 'ssh.exe' -or $Process.ExecutablePath -ne $ssh -or
     $command -notmatch ('(?:^|\s)-D\s+"?'+[regex]::Escape($bind)+'"?(?:\s|$)') -or
     $command -notmatch ('(?:^|\s)-p\s+'+$ServerPort+'(?:\s|$)') -or
     -not $command.Contains($ProxyUser+'@'+$ServerIp) -or
     -not $command.Contains($keyPath) -or $command -notmatch '(?:^|\s)-N(?:\s|$)') {
    throw "OWNER_NOT_PROVEN_DO_NOT_KILL PID=$($Process.ProcessId)"
  }
  # Pid reuse is checked against the original process creation time when recorded.
  if(Test-Path -LiteralPath $receiptPath){
    $record=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json
    if([int]$record.pid -eq [int]$Process.ProcessId -and
       ([datetime]$record.createdAt).ToUniversalTime() -ne ([datetime]$Process.CreationDate).ToUniversalTime()) {
      throw 'PID_REUSE_DO_NOT_KILL'
    }
  }
}
function Stop-OwnedTunnel {
  $owner=Get-Owner; Assert-Owned $owner
  if($owner){ Stop-Process -Id $owner.ProcessId -Force; Write-TunnelEvent 'TUNNEL_STOPPED' @{pid=$owner.ProcessId} }
  for($i=0;$i -lt 20;$i++){
    if(-not(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)){break}
    Start-Sleep -Milliseconds 100
  }
  if(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue){throw 'SOCKS_PORT_NOT_RELEASED'}
  foreach($path in @($pidPath,$receiptPath)){if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Force}}
}
function Test-Tunnel {
  $clock=[Diagnostics.Stopwatch]::StartNew(); $phase='LOCAL_TCP_CONNECT'; $client=$null; $stream=$null
  $result=[ordered]@{at=(Get-Date).ToUniversalTime().ToString('o');proxy="127.0.0.1:$LocalPort";target='demo-fapi.binance.com:443';stages=@();healthy=$false}
  function Wait-ProbeTask($Task) {
    $remaining=[math]::Max(1,$ProbeTimeoutSeconds*1000-[int]$clock.ElapsedMilliseconds)
    if(-not $Task.Wait($remaining)){throw 'PROBE_DEADLINE_EXHAUSTED'}
    return $Task.GetAwaiter().GetResult()
  }
  function Read-Exact([int]$Count) {
    $buffer=New-Object byte[] $Count; $offset=0
    while($offset -lt $Count){
      $n=Wait-ProbeTask ($stream.ReadAsync($buffer,$offset,$Count-$offset))
      if($n -eq 0){throw 'PEER_CLOSED'}; $offset+=$n
    }
    return ,$buffer
  }
  function Record-Phase { $result.stages+=@{phase=$phase;elapsedMs=$clock.ElapsedMilliseconds} }
  try {
    $owner=Get-Owner; Assert-Owned $owner
    if(-not $owner){throw 'SOCKS_OWNER_MISSING'}; $result.pid=$owner.ProcessId
    $client=[Net.Sockets.TcpClient]::new()
    Wait-ProbeTask ($client.ConnectAsync('127.0.0.1',$LocalPort)) | Out-Null
    $stream=$client.GetStream(); Record-Phase
    $phase='SOCKS_GREETING'; $stream.Write([byte[]](5,1,0),0,3); $g=Read-Exact 2
    if($g[0] -ne 5 -or $g[1] -ne 0){throw 'SOCKS_AUTH_OR_VERSION_REJECTED'}; Record-Phase
    $phase='SOCKS_CONNECT_REPLY'; $hostBytes=[Text.Encoding]::ASCII.GetBytes('demo-fapi.binance.com')
    $request=[byte[]](@(5,1,0,3,$hostBytes.Length)+$hostBytes+@(1,187))
    $stream.Write($request,0,$request.Length); $reply=Read-Exact 4
    if($reply[0] -ne 5 -or $reply[1] -ne 0){throw "SOCKS_CONNECT_REJECTED code=$($reply[1])"}
    switch($reply[3]){1{Read-Exact 6|Out-Null}4{Read-Exact 18|Out-Null}3{$len=Read-Exact 1;Read-Exact ($len[0]+2)|Out-Null}default{throw 'SOCKS_ADDRESS_INVALID'}}
    Record-Phase; $phase='TLS_HANDSHAKE'; $stream=[Net.Security.SslStream]::new($stream,$false)
    Wait-ProbeTask ($stream.AuthenticateAsClientAsync('demo-fapi.binance.com'))|Out-Null; Record-Phase
    $phase='HTTP_PUBLIC_TIME'; $request=[Text.Encoding]::ASCII.GetBytes("GET /fapi/v1/time HTTP/1.1`r`nHost: demo-fapi.binance.com`r`nConnection: close`r`n`r`n")
    $stream.Write($request,0,$request.Length); $response=''; $buffer=New-Object byte[] 4096
    while($response.Length -lt 65536){
      $n=Wait-ProbeTask ($stream.ReadAsync($buffer,0,$buffer.Length)); if($n -eq 0){break}
      $response+=[Text.Encoding]::ASCII.GetString($buffer,0,$n)
      if($response -match '\r\n\r\n.*"serverTime"\s*:\s*\d+'){break}
    }
    if($response -notmatch '^HTTP/1\.[01] 200 ' -or $response -notmatch '"serverTime"\s*:\s*\d+'){throw ('HTTP_TIME_INVALID '+($response -split "`r`n")[0])}
    Record-Phase; $result.healthy=$true
  }catch{$result.failurePhase=$phase;$result.error=$_.Exception.GetBaseException().Message}
  finally{if($stream){$stream.Dispose()};if($client){$client.Dispose()};$clock.Stop()}
  $result.elapsedMs=$clock.ElapsedMilliseconds
  Save-Json $statePath $result
  return [pscustomobject]$result
}
function Start-OwnedTunnel {
  if(-not(Test-Path -LiteralPath $keyPath)){throw "SECURE_LOCAL_KEY_MISSING: $keyPath"}
  if(-not(Test-Path -LiteralPath $knownHosts)){throw 'PINNED_KNOWN_HOSTS_MISSING: provision the verified host key locally'}
  if(Get-Owner){throw 'TUNNEL_ALREADY_EXISTS'}
  foreach($path in @($stderrPath,$stdoutPath)){
    if(Test-Path -LiteralPath $path){Move-Item -LiteralPath $path -Destination ($path+'.previous') -Force}
  }
  $sshArguments=@('-N','-T','-E',('"'+$stderrPath+'"'),'-D',"127.0.0.1:$LocalPort",'-p',"$ServerPort",'-i',('"'+$keyPath+'"'),
    '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ExitOnForwardFailure=yes',
    '-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','TCPKeepAlive=yes',
    '-o','ConnectTimeout=10','-o','ConnectionAttempts=1','-o','StrictHostKeyChecking=yes',
    '-o',('UserKnownHostsFile="'+$knownHosts+'"'),'-o','LogLevel=ERROR',"$ProxyUser@$ServerIp") -join ' '
  # WMI owns the creation, outside an invoking terminal/Codex Job. A normal
  # Start-Process here inherits that Job and can die when its UI/CLI crashes.
  # ShowWindow=0 keeps the helper hidden; SSH -E owns its bounded error log.
  $startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
  $launch=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine=('"'+$ssh+'" '+$sshArguments);CurrentDirectory=$BaseDir;ProcessStartupInformation=$startup
  }
  if($launch.ReturnValue -ne 0){throw "DETACHED_SSH_CREATE_FAILED code=$($launch.ReturnValue)"}
  $process=Get-Process -Id $launch.ProcessId -ErrorAction Stop
  [IO.File]::WriteAllText($pidPath,[string]$process.Id,[Text.Encoding]::ASCII)
  $created=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
  Save-Json $receiptPath @{pid=$process.Id;createdAt=([datetime]$created.CreationDate).ToUniversalTime().ToString('o');bind="127.0.0.1:$LocalPort";target="$ProxyUser@$ServerIp`:$ServerPort"}
  for($i=0;$i -lt 60;$i++){
    $process.Refresh(); if($process.HasExited){throw "SSH_EXITED exit=$($process.ExitCode); see $stderrPath"}
    $listener=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
    if($listener){if($listener.OwningProcess -ne $process.Id){throw 'LISTENER_OWNER_MISMATCH'};break}
    Start-Sleep -Milliseconds 200
  }
  if(-not $listener){Stop-OwnedTunnel;throw 'SOCKS_LISTENER_NOT_READY'}
  Write-TunnelEvent 'TUNNEL_STARTED' @{pid=$process.Id}
}
function Invoke-Locked($Action) {
  $mutex=[Threading.Mutex]::new($false,"Local\ZDJ_TRADE_PROXY_LIFECYCLE_$LocalPort")
  $locked=$false
  try{
    try{$locked=$mutex.WaitOne(1000)}catch [Threading.AbandonedMutexException]{$locked=$true}
    if(-not $locked){throw 'TUNNEL_LIFECYCLE_BUSY'}
    & $Action
  }finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
}
function Stop-Guardian {
  if(Test-Path -LiteralPath $guardianPath){
    $g=Get-Content -LiteralPath $guardianPath -Raw|ConvertFrom-Json
    $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($g.pid)" -ErrorAction SilentlyContinue
    if($p){
      if($p.ProcessId -eq $PID){return}
      $invocation=[string]$p.CommandLine
      if($invocation -match '(?i)-EncodedCommand\s+([A-Za-z0-9+/=]+)'){
        $invocation=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
      }
      if($p.Name -notin @('powershell.exe','pwsh.exe') -or $invocation -notlike ('*'+$PSCommandPath+'*') -or $invocation -notmatch '(?:^|\s)-Watch(?:\s|$)' -or
        ([datetime]$p.CreationDate).ToUniversalTime() -ne ([datetime]$g.createdAt).ToUniversalTime()){throw 'GUARDIAN_OWNER_NOT_PROVEN'}
      Stop-Process -Id $p.ProcessId -Force
    }
    Remove-Item -LiteralPath $guardianPath -Force
  }
}
function Start-Guardian {
  if(Test-Path -LiteralPath $guardianPath){
    $record=Get-Content -LiteralPath $guardianPath -Raw|ConvertFrom-Json
    $existing=Get-CimInstance Win32_Process -Filter "ProcessId=$($record.pid)" -ErrorAction SilentlyContinue
    if($existing){
      $invocation=[string]$existing.CommandLine
      if($invocation -match '(?i)-EncodedCommand\s+([A-Za-z0-9+/=]+)'){$invocation=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))}
      if($existing.Name -notin @('powershell.exe','pwsh.exe') -or $invocation -notlike ('*'+$PSCommandPath+'*') -or $invocation -notmatch '(?:^|\s)-Watch(?:\s|$)' -or ([datetime]$existing.CreationDate).ToUniversalTime() -ne ([datetime]$record.createdAt).ToUniversalTime()){throw 'GUARDIAN_OWNER_NOT_PROVEN'}
      return
    }
  }
  $powershell=(Get-Command powershell.exe -ErrorAction Stop).Source
  $args='-NoProfile -NonInteractive -File "'+$PSCommandPath+'" -Watch -BaseDir "'+$BaseDir+'" -LocalPort '+$LocalPort+' -ProbeTimeoutSeconds '+$ProbeTimeoutSeconds+' -HealthIntervalSeconds '+$HealthIntervalSeconds+' -FailureThreshold '+$FailureThreshold+' -MaxRestarts '+$MaxRestarts
  $startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
  $launch=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=('"'+$powershell+'" '+$args);CurrentDirectory=$BaseDir;ProcessStartupInformation=$startup}
  if($launch.ReturnValue -ne 0){throw 'DETACHED_GUARDIAN_CREATE_FAILED'}
  $created=Get-CimInstance Win32_Process -Filter "ProcessId=$($launch.ProcessId)"
  Save-Json $guardianPath @{pid=$launch.ProcessId;createdAt=([datetime]$created.CreationDate).ToUniversalTime().ToString('o');script=$PSCommandPath}
  Write-TunnelEvent 'GUARDIAN_RESTORED' @{pid=$launch.ProcessId}
}
function Main {
  New-Item -ItemType Directory -Path $BaseDir -Force|Out-Null
  if(@($Stop,$Status,$Watch)|Where-Object{$_}|Measure-Object|Select-Object -ExpandProperty Count){
    if(([int][bool]$Stop+[int][bool]$Status+[int][bool]$Watch) -gt 1){throw 'CHOOSE_ONE_MODE'}
  }
  if($Stop){Invoke-Locked {Stop-Guardian;Stop-OwnedTunnel};return}
  if($Status){$health=Test-Tunnel;$health|ConvertTo-Json -Depth 8;if(-not $health.healthy){throw 'TUNNEL_UNHEALTHY'};return}
  $watchMutex=$null; $watchLocked=$false
  if($Watch){
    $watchMutex=[Threading.Mutex]::new($false,"Local\ZDJ_TRADE_PROXY_GUARDIAN_$LocalPort")
    try{$watchLocked=$watchMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$watchLocked=$true}
    if(-not $watchLocked){$watchMutex.Dispose();throw 'GUARDIAN_ALREADY_RUNNING'}
  }
  try{
    try {
      Invoke-Locked {
        if($Restart){if(-not $Watch){Stop-Guardian};Stop-OwnedTunnel}
        $owner=Get-Owner;Assert-Owned $owner
        if(-not $owner){
          if($Watch -and $MaxRestarts -eq 0){throw 'RESTART_BUDGET_EXHAUSTED_NO_INITIAL_START'}
          Start-OwnedTunnel
        }
      }
    }catch {
      # Ownership failures must never turn into restart attempts against another process.
      if(-not $Watch -or $_.Exception.Message -match 'OWNER|PID_REUSE|MULTIPLE_LISTENER|LIFECYCLE_BUSY'){throw}
      Write-TunnelEvent 'INITIAL_START_FAILED' @{error=$_.Exception.Message}
    }
    $health=Test-Tunnel;$health|ConvertTo-Json -Depth 8
    Write-TunnelEvent 'INITIAL_HEALTH' $health
    if(-not $Watch){Invoke-Locked {Start-Guardian};if(-not $health.healthy){throw 'TUNNEL_UNHEALTHY: listener alone is not READY'};Write-Output "READY SOCKS5H=socks5h://127.0.0.1:$LocalPort";return}
    $self=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
    Save-Json $guardianPath @{pid=$PID;createdAt=([datetime]$self.CreationDate).ToUniversalTime().ToString('o');script=$PSCommandPath}
    $started=[Diagnostics.Stopwatch]::StartNew();$failures=0;$restarts=@();$restartBudgetExhausted=$false
    while($RunForSeconds -eq 0 -or $started.Elapsed.TotalSeconds -lt $RunForSeconds){
      if($health.healthy){$failures=0}else{$failures++}
      $logTooLarge=(Test-Path -LiteralPath $stderrPath) -and (Get-Item -LiteralPath $stderrPath).Length -gt 8MB
      if($failures -ge $FailureThreshold -or $logTooLarge){
        # Lifetime budget for this guardian: an unchanged fault cannot regain
        # permission to restart merely because fifteen minutes have elapsed.
        if($restarts.Count -ge $MaxRestarts){
          # A finite lifecycle budget must not disable the safety monitor.
          # Continue bounded health probes, with no further SSH stop/start.
          if(-not $restartBudgetExhausted){Write-TunnelEvent 'RESTART_BUDGET_EXHAUSTED' $health;$restartBudgetExhausted=$true}
        }else{
        Write-TunnelEvent 'RESTART_REQUESTED' @{health=$health;failures=$failures;logTooLarge=$logTooLarge}
        Start-Sleep -Seconds ([math]::Min(30,2*[math]::Pow(2,$restarts.Count)))
        $restarts+=Get-Date
        try{Invoke-Locked {Stop-OwnedTunnel;Start-OwnedTunnel};$failures=0}
        catch{
          Write-TunnelEvent 'RESTART_FAILED' @{error=$_.Exception.Message}
          if($_.Exception.Message -match 'OWNER|PID_REUSE|MULTIPLE_LISTENER|LIFECYCLE_BUSY'){throw}
          $failures=$FailureThreshold
        }
        }
      }
      Start-Sleep -Seconds $HealthIntervalSeconds
      $health=Test-Tunnel;Write-TunnelEvent 'HEALTH' $health
    }
  }finally{
    if($watchLocked){
      if(Test-Path -LiteralPath $guardianPath){$g=Get-Content -LiteralPath $guardianPath -Raw|ConvertFrom-Json;if([int]$g.pid -eq $PID){Remove-Item -LiteralPath $guardianPath -Force}}
      $watchMutex.ReleaseMutex();$watchMutex.Dispose()
    }
  }
}
if($MyInvocation.InvocationName -ne '.') { Main }
