# Read-only Windows graphics adapter lookup. No model initialization or device changes.
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GpuAddress {
 [StructLayout(LayoutKind.Sequential)] struct Luid {public uint Low; public int High;}
 [StructLayout(LayoutKind.Sequential)] struct Open {public Luid Luid; public uint Handle;}
 [StructLayout(LayoutKind.Sequential)] struct Query {public uint Handle;public int Type;public IntPtr Data;public uint Size;}
 [StructLayout(LayoutKind.Sequential)] struct Close {public uint Handle;}
 [DllImport("gdi32.dll")] static extern int D3DKMTOpenAdapterFromLuid(ref Open o);
 [DllImport("gdi32.dll")] static extern int D3DKMTQueryAdapterInfo(ref Query q);
 [DllImport("gdi32.dll")] static extern int D3DKMTCloseAdapter(ref Close c);
 public static uint[] Read(uint high,uint low){
  var o=new Open{Luid=new Luid{High=unchecked((int)high),Low=low}};
  if(D3DKMTOpenAdapterFromLuid(ref o)!=0)throw new Exception("ADAPTER_OPEN_UNKNOWN");
  var ptr=Marshal.AllocHGlobal(12);
  try{var q=new Query{Handle=o.Handle,Type=6,Data=ptr,Size=12};
   if(D3DKMTQueryAdapterInfo(ref q)!=0)throw new Exception("ADAPTER_ADDRESS_UNKNOWN");
   return new uint[]{unchecked((uint)Marshal.ReadInt32(ptr,0)),unchecked((uint)Marshal.ReadInt32(ptr,4)),unchecked((uint)Marshal.ReadInt32(ptr,8))};
  }finally{Marshal.FreeHGlobal(ptr);var c=new Close{Handle=o.Handle};D3DKMTCloseAdapter(ref c);}
 }
}
'@
$counters=(Get-Counter '\GPU Process Memory(*)\Dedicated Usage').CounterSamples
$servicePids=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 8081,8083,8084 | Select-Object -ExpandProperty OwningProcess -Unique)
$result=@()
foreach($counter in $counters | Where-Object { $_.InstanceName -match '^pid_(\d+)_' -and [int]$Matches[1] -in $servicePids }){
  if($counter.InstanceName -match '^pid_(\d+)_luid_0x([0-9a-f]+)_0x([0-9a-f]+)_phys_(\d+)'){
    $servicePid=[int]$Matches[1];$high=[Convert]::ToUInt32($Matches[2],16);$low=[Convert]::ToUInt32($Matches[3],16);$luid="0x$($Matches[2])_0x$($Matches[3])"
    try{$address=[GpuAddress]::Read($high,$low);$result+=@{pid=$servicePid;luid=$luid;bus=$address[0];device=$address[1];function=$address[2];dedicatedBytes=$counter.CookedValue;source='D3DKMT_ADAPTERADDRESS_AND_WDDM_PROCESS_MEMORY';status='MEASURED'}}
    catch{$result+=@{pid=$servicePid;luid=$luid;bus=$null;dedicatedBytes=$counter.CookedValue;status='UNKNOWN'}}
  }
}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$PSScriptRoot/gpu-luid-pci.json" -Encoding UTF8
$result | ConvertTo-Json -Depth 5
