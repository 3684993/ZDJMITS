[CmdletBinding()]
param([ValidateSet('TunnelGuardian','Engine')][string]$Mode,[string]$RepositoryRoot)
$ErrorActionPreference='Stop'
$powershell=(Get-Command powershell.exe).Source
function Quote-PS([string]$Value){return "'"+$Value.Replace("'","''")+"'"}
if($Mode -eq 'TunnelGuardian'){
  $script='D:\MITS\scripts\vpn\zdj-trade-proxy-client-windows.ps1'
  $base=Join-Path $env:LOCALAPPDATA 'ZDJ-MITS\trade-proxy'
  $receipt=Join-Path $base 'ssh-guardian.json'
  if(Test-Path -LiteralPath $receipt){
    $g=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
    $existing=Get-CimInstance Win32_Process -Filter "ProcessId=$($g.pid)" -ErrorAction SilentlyContinue
    if($existing -and $existing.CommandLine -match '-EncodedCommand'){
      throw 'GUARDIAN_EXISTS: inspect the recorded identity before creating another'
    }
  }
  $log=Join-Path $base 'guardian-console.log'
  $command='& '+(Quote-PS $script)+' -Watch *>> '+(Quote-PS $log)
  $directory=Split-Path $script -Parent
}else{
  if([string]::IsNullOrWhiteSpace($RepositoryRoot)){throw 'RepositoryRoot required'}
  $directory=(Resolve-Path -LiteralPath $RepositoryRoot).Path
  if(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue){throw 'ENGINE_ALREADY_LISTENING: no automatic stop'}
  $script=Join-Path $directory 'scripts\start-zdj-lan.ps1'
  $log=Join-Path $directory 'docs\reports\v397-ssh-socks-remediation-20261008\detached-engine-launch.txt'
  $command='& '+(Quote-PS $script)+' -StartReason MANUAL_START -SkipFirewall *>> '+(Quote-PS $log)
}
if(-not(Test-Path -LiteralPath $script)){throw 'Launch script missing'}
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
$created=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine=('"'+$powershell+'" -NoProfile -ExecutionPolicy Bypass -EncodedCommand '+$encoded)
  CurrentDirectory=$directory;ProcessStartupInformation=$startup
}
if($created.ReturnValue -ne 0){throw "WMI_CREATE_FAILED $($created.ReturnValue)"}
@{at=(Get-Date).ToUniversalTime().ToString('o');mode=$Mode;detachedLauncherPid=$created.ProcessId;script=$script;log=$log;result='LAUNCHED_NOT_HEALTH_VERIFIED'}|ConvertTo-Json
