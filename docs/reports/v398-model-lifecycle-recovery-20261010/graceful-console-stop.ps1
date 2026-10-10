param([Parameter(Mandatory)][int]$TargetPid,[Parameter(Mandatory)][string]$ExpectedStartUtc,[Parameter(Mandatory)][string]$ExpectedNode,[Parameter(Mandatory)][string]$ExpectedEntry,[Parameter(Mandatory)][string]$ExpectedEntrySha256,[Parameter(Mandatory)][string]$Receipt,[switch]$ProbeOnly)
$ErrorActionPreference='Stop'
$proc=Get-CimInstance Win32_Process -Filter "ProcessId=$TargetPid"
if(-not $proc -or $proc.ExecutablePath -ine $ExpectedNode -or $proc.CommandLine -notmatch [regex]::Escape($ExpectedEntry) -or (Get-Process -Id $TargetPid).StartTime.ToUniversalTime().ToString('o') -cne $ExpectedStartUtc -or (Get-FileHash -LiteralPath $ExpectedEntry).Hash -ine $ExpectedEntrySha256){throw 'ENGINE_IDENTITY_CHANGED'}
Add-Type -TypeDefinition @'
using System;
using System.Linq;
using System.Runtime.InteropServices;
public static class EngineConsoleStop {
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AttachConsole(uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool FreeConsole();
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetConsoleProcessList([Out] uint[] p,uint count);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetConsoleCtrlHandler(IntPtr h,bool add);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GenerateConsoleCtrlEvent(uint kind,uint group);
 public static uint[] Invoke(uint target,uint own,bool probe){
  FreeConsole();if(!AttachConsole(target))throw new Exception("ENGINE_CONSOLE_UNAVAILABLE:"+Marshal.GetLastWin32Error());
  try{uint[] ids=new uint[64];uint n=GetConsoleProcessList(ids,64);if(n!=2||!ids.Take((int)n).Contains(target)||!ids.Take((int)n).Contains(own))throw new Exception("ENGINE_CONSOLE_NOT_ISOLATED");
   var result=ids.Take((int)n).ToArray();if(!probe){if(!SetConsoleCtrlHandler(IntPtr.Zero,true))throw new Exception("HELPER_CTRL_HANDLER_FAILED");if(!GenerateConsoleCtrlEvent(0,0))throw new Exception("ENGINE_CTRL_C_FAILED:"+Marshal.GetLastWin32Error());}return result;
  }finally{FreeConsole();}
 }
}
'@
$ids=[EngineConsoleStop]::Invoke($TargetPid,$PID,$ProbeOnly.IsPresent)
$row=[ordered]@{at=[DateTimeOffset]::Now.ToString('o');targetPid=$TargetPid;helperPid=$PID;consolePids=$ids;probeOnly=$ProbeOnly.IsPresent;signal=if($ProbeOnly){'NONE'}else{'CTRL_C_EVENT'};forceTermination=$false}
[IO.File]::WriteAllText($Receipt,($row | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
if(-not $ProbeOnly){$deadline=(Get-Date).AddSeconds(45);while((Get-Process -Id $TargetPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 250};if(Get-Process -Id $TargetPid -ErrorAction SilentlyContinue){throw 'ENGINE_GRACEFUL_EXIT_TIMEOUT_NO_FORCE_FALLBACK'}}
$row | ConvertTo-Json -Compress
