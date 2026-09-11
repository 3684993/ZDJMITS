[CmdletBinding()]
param([int]$Port=8080)
$ErrorActionPreference='SilentlyContinue'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$listener=Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1
$owner=$null;$ownerCommand=$null
if($listener){$owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)";$ownerCommand=$owner.CommandLine}
function Probe([string]$Url){$sw=[Diagnostics.Stopwatch]::StartNew();$body=curl.exe --connect-timeout 2 --max-time 5 -sS $Url 2>$null;$sw.Stop();$code=0;if($body){try{$code=[int]((curl.exe --connect-timeout 2 --max-time 5 -s -o NUL -w '%{http_code}' $Url 2>$null))}catch{}};[ordered]@{url=$Url;status=if($code -in 200,202,204,503){'UP'}else{'DOWN'};httpCode=$code;latencyMs=$sw.ElapsedMilliseconds}}
$ips=@(Get-NetIPAddress -AddressFamily IPv4 -Type Unicast | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred'} | Select-Object -ExpandProperty IPAddress)
$lanIp=($ips|Where-Object {$_ -like '192.168.*'}|Select-Object -First 1);if(!$lanIp){$lanIp=$ips|Select-Object -First 1}
$rule=Get-NetFirewallRule -DisplayName 'ZDJ-MITS Engine 8080';$remote=if($rule){(($rule|Get-NetFirewallAddressFilter).RemoteAddress -join ',')}else{'NOT_FOUND'}
$profile=(Get-NetConnectionProfile|Where-Object {$_.IPv4Connectivity -ne 'NoTraffic'}|Select-Object -First 1)
$identityPath=Join-Path $root 'data\runtime\engine-instance.json';$identity=$null;try{$identity=Get-Content -LiteralPath $identityPath -Raw|ConvertFrom-Json}catch{}
[ordered]@{timestamp=[DateTimeOffset]::UtcNow.ToString('o');pid=$listener.OwningProcess;processAlive=[bool]$owner;processCommand=$ownerCommand;processUptimeSeconds=if($owner){[int]((Get-Date)-$owner.CreationDate).TotalSeconds}else{$null};listener=[bool]$listener;listenerAddress=$listener.LocalAddress;port=$Port;loopbackProbe=(Probe "http://127.0.0.1:$Port/health");lanProbe=if($lanIp){Probe "http://${lanIp}:$Port/health"}else{[ordered]@{status='NO_LAN_IP'}};lanIps=$ips;networkProfile=$profile.NetworkCategory;networkInterface=$profile.InterfaceAlias;firewallRuleState=[ordered]@{present=[bool]$rule;enabled=$rule.Enabled;profile=$rule.Profile;remoteAddress=$remote};instanceId=$identity.instanceId;restartCount=$identity.restartCount;lastRestartAt=$identity.startedAt;lastRestartReason=$identity.startReason}|ConvertTo-Json -Depth 8
