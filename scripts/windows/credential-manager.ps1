param([ValidateSet('set','get','delete','status')][string]$Action, [string]$Target)
$ErrorActionPreference = 'Stop'
if (-not ('ZdjMitsCredentialNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZdjMitsCredentialNative {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
  public UInt32 Flags, Type; public string TargetName, Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist, AttributeCount;
  public IntPtr Attributes; public string TargetAlias, UserName;
 }
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credentialPtr);
 [DllImport("advapi32.dll", SetLastError=true)] public static extern bool CredDelete(string target, uint type, uint flags);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);
}
'@
}
$type = 1; $missing = 1168
function Read-Credential([string]$name) { $ptr=[IntPtr]::Zero; if(-not [ZdjMitsCredentialNative]::CredRead($name,$type,0,[ref]$ptr)) { if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq $missing){ return $null }; throw [ComponentModel.Win32Exception]([Runtime.InteropServices.Marshal]::GetLastWin32Error()) }; try { $c=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][ZdjMitsCredentialNative+CREDENTIAL]); $bytes=New-Object byte[] $c.CredentialBlobSize; [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$bytes,0,$bytes.Length); return ,$bytes } finally { [ZdjMitsCredentialNative]::CredFree($ptr) } }
switch($Action) {
 'set' { $bytes=[Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim()); $blob=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length); try { [Runtime.InteropServices.Marshal]::Copy($bytes,0,$blob,$bytes.Length); $c=New-Object ZdjMitsCredentialNative+CREDENTIAL; $c.Type=$type; $c.TargetName=$Target; $c.CredentialBlobSize=$bytes.Length; $c.CredentialBlob=$blob; $c.Persist=2; $c.UserName='ZDJ-MITS'; if(-not [ZdjMitsCredentialNative]::CredWrite([ref]$c,0)){throw [ComponentModel.Win32Exception]([Runtime.InteropServices.Marshal]::GetLastWin32Error())} } finally {[Runtime.InteropServices.Marshal]::FreeHGlobal($blob)} }
 'get' { $bytes=Read-Credential $Target; if($null -ne $bytes){[Console]::Out.Write([Convert]::ToBase64String($bytes))} }
 'status' { if($null -ne (Read-Credential $Target)){[Console]::Out.Write('READY')}else{[Console]::Out.Write('MISSING')} }
 'delete' { if(-not [ZdjMitsCredentialNative]::CredDelete($Target,$type,0) -and [Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne $missing){throw [ComponentModel.Win32Exception]([Runtime.InteropServices.Marshal]::GetLastWin32Error())} }
}
