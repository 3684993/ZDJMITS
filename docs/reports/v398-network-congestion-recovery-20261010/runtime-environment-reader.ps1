Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;using System.Text;
public static class RecoveryProcessEnvReader {
[DllImport("kernel32.dll")]static extern IntPtr OpenProcess(uint a,bool b,int id);
[DllImport("kernel32.dll")]static extern bool ReadProcessMemory(IntPtr h,IntPtr p,byte[] b,int n,out IntPtr count);
[DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
[DllImport("ntdll.dll")]static extern int NtQueryInformationProcess(IntPtr h,int c,IntPtr[] b,int n,out int r);
static byte[] Read(IntPtr h,long p,int n){var b=new byte[n];IntPtr count;if(!ReadProcessMemory(h,new IntPtr(p),b,n,out count))throw new Exception("READ_FAILED");return b;}
public static string ReadEntryEnvironment(int id){var h=OpenProcess(0x410,false,id);if(h==IntPtr.Zero)throw new Exception("OPEN_FAILED");try{var b=new IntPtr[6];int r;if(NtQueryInformationProcess(h,0,b,48,out r)!=0)throw new Exception("PEB_QUERY_FAILED");long pp=BitConverter.ToInt64(Read(h,b[1].ToInt64()+0x20,8),0);long e=BitConverter.ToInt64(Read(h,pp+0x80,8),0);var text="";for(int chunk=0;chunk<128;chunk++){text+=Encoding.Unicode.GetString(Read(h,e+chunk*512,512));if(text.Contains("\0\0"))break;}var selected=Array.FindAll(text.Split('\0'), row=>row.StartsWith("GGML_VK_VISIBLE_DEVICES=")||row.StartsWith("ZDJ_ENTRY_")||row.StartsWith("ZDJ_DATA_DIR=")||row.StartsWith("ZDJ_CONFIG_DIR=")||row.StartsWith("ZDJ_PORT="));return string.Join("\n",selected);}finally{CloseHandle(h);}}
}
"@
