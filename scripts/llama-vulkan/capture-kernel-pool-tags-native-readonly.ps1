# Native Windows Pool Tag reader for x64. No PoolMon/WDK installation required.
# EXPERIMENTAL DIAGNOSTIC: SystemPoolTagInformation (0x16) is an undocumented
# information class/structure, not a stable supported Windows API contract.
# READ-ONLY: NtQuerySystemInformation only. No kernel driver, registry, ETW,
# pagefile, model, Engine, network, and no process termination/restart.
# Validate with -Mode Validate first. Fails closed on unsupported OS/layout.
[CmdletBinding()]
param(
    [ValidateSet('Validate','Capture')][string]$Mode='Capture',
    [ValidateRange(1,4)][int]$Samples=2,
    [ValidateRange(3,30)][int]$IntervalSeconds=5,
    [ValidateRange(5,50)][int]$TopRows=20
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

if(-not [Environment]::Is64BitProcess -or [IntPtr]::Size -ne 8){
    throw 'UNSUPPORTED_PROCESS_ARCH: launch 64-bit Windows PowerShell. No query performed.'
}
$source=@'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
namespace ZdjLlamaPoolDiagnostics {
    public sealed class PoolTagRow {
        public string Tag { get; set; }
        public string TagHex { get; set; }
        public long PagedBytes { get; set; }
        public long NonPagedBytes { get; set; }
        public long PagedAllocations { get; set; }
        public long PagedFrees { get; set; }
        public long NonPagedAllocations { get; set; }
        public long NonPagedFrees { get; set; }
    }
    public static class PoolTagQuery {
        // This information class and its binary layout are undocumented.
        // x64 SYSTEM_POOLTAG_INFORMATION: count@0, entries@8; each entry 40 bytes.
        // Each tag: Tag@0, PagedAllocs@4, PagedFrees@8,
        // PagedUsed@16, NonPagedAllocs@24, NonPagedFrees@28, NonPagedUsed@32.
        private const int InfoClass = 0x16;
        private const int HeaderBytes = 8;
        private const int RecordBytes = 40;
        private const int StatusInfoLengthMismatch = unchecked((int)0xC0000004);
        private const int StatusBufferTooSmall = unchecked((int)0xC0000023);
        [DllImport("ntdll.dll", ExactSpelling=true)]
        private static extern int NtQuerySystemInformation(
            int informationClass, IntPtr systemInformation,
            int systemInformationLength, out int returnLength);
        private static long Unsigned32(IntPtr ptr, int pos) {
            return (long)unchecked((uint)Marshal.ReadInt32(ptr,pos));
        }
        private static PoolTagRow[] Parse(IntPtr ptr, int bufferLength) {
            if(bufferLength < HeaderBytes)
                throw new InvalidOperationException("POOLTAG_BUFFER_TOO_SMALL");
            long n=Unsigned32(ptr,0);
            if(n == 0 || n > 100000 ||
              n > (long)(bufferLength - HeaderBytes)/RecordBytes)
                throw new InvalidOperationException("POOLTAG_LAYOUT_VALIDATION_FAILED count="+n);
            List<PoolTagRow> rows=new List<PoolTagRow>((int)n);
            for(int i=0;i<(int)n;i++) {
                int off=checked(HeaderBytes+i*RecordBytes);
                char[] chars=new char[4];
                byte[] tagBytes=new byte[4];
                for(int j=0;j<4;j++) {
                    byte b=Marshal.ReadByte(ptr,off+j);
                    tagBytes[j]=b;
                    chars[j]=(b>=32 && b<=126)?(char)b:'?';
                }
                long paged=Marshal.ReadInt64(ptr,off+16);
                long nonpaged=Marshal.ReadInt64(ptr,off+32);
                if(paged<0 || nonpaged<0)
                    throw new InvalidOperationException("POOLTAG_NEGATIVE_BYTE_COUNT");
                rows.Add(new PoolTagRow{
                    Tag=new String(chars),
                    TagHex=BitConverter.ToString(tagBytes).Replace("-",""),
                    PagedAllocations=Unsigned32(ptr,off+4),
                    PagedFrees=Unsigned32(ptr,off+8),
                    PagedBytes=paged,
                    NonPagedAllocations=Unsigned32(ptr,off+24),
                    NonPagedFrees=Unsigned32(ptr,off+28),
                    NonPagedBytes=nonpaged
                });
            }
            return rows.ToArray();
        }
        public static bool ValidateManagedLayout() {
            IntPtr ptr=Marshal.AllocHGlobal(HeaderBytes+RecordBytes*2);
            try{
                for(int i=0;i<HeaderBytes+RecordBytes*2;i++)
                    Marshal.WriteByte(ptr,i,0);
                Marshal.WriteInt32(ptr,0,2);
                int a=HeaderBytes, b=HeaderBytes+RecordBytes;
                byte[] tagA=new byte[]{(byte)'T',(byte)'E',(byte)'S',(byte)'T'};
                byte[] tagB=new byte[]{(byte)'N',(byte)'P',(byte)'A',(byte)'G'};
                for(int i=0;i<4;i++){
                    Marshal.WriteByte(ptr,a+i,tagA[i]);
                    Marshal.WriteByte(ptr,b+i,tagB[i]);
                }
                Marshal.WriteInt32(ptr,a+4,100);
                Marshal.WriteInt32(ptr,a+8,20);
                Marshal.WriteInt64(ptr,a+16,123456789L);
                Marshal.WriteInt32(ptr,a+24,33);
                Marshal.WriteInt32(ptr,a+28,3);
                Marshal.WriteInt64(ptr,a+32,987654321L);
                Marshal.WriteInt64(ptr,b+16,5555L);
                Marshal.WriteInt64(ptr,b+32,6666L);
                PoolTagRow[] rows=Parse(ptr,HeaderBytes+RecordBytes*2);
                return rows.Length==2 &&
                    rows[0].Tag=="TEST" &&
                    rows[0].PagedBytes==123456789L &&
                    rows[0].NonPagedBytes==987654321L &&
                    rows[0].PagedAllocations==100L &&
                    rows[0].PagedFrees==20L &&
                    rows[0].NonPagedAllocations==33L &&
                    rows[0].NonPagedFrees==3L &&
                    rows[1].Tag=="NPAG" &&
                    rows[1].PagedBytes==5555L &&
                    rows[1].NonPagedBytes==6666L;
            }finally{Marshal.FreeHGlobal(ptr);}
        }
        public static PoolTagRow[] ReadTags() {
            int allocated=256*1024;
            for(int attempt=0; attempt<8;attempt++) {
                if(allocated>16*1024*1024)
                    throw new InvalidOperationException("POOLTAG_BUFFER_LIMIT_16_MIB");
                IntPtr ptr=Marshal.AllocHGlobal(allocated);
                try {
                    int required=0;
                    int status=NtQuerySystemInformation(InfoClass,ptr,allocated,out required);
                    if(status==0) return Parse(ptr,allocated);
                    if(status==StatusInfoLengthMismatch || status==StatusBufferTooSmall) {
                        long candidate=Math.Max((long)allocated*2,(long)required+4096);
                        if(candidate>16*1024*1024)
                            throw new InvalidOperationException("POOLTAG_REQUIRED_BUFFER_TOO_LARGE");
                        allocated=(int)candidate;
                        continue;
                    }
                    throw new InvalidOperationException(
                        "NT_POOL_TAG_QUERY_UNAVAILABLE_STATUS_0x"+unchecked((uint)status).ToString("X8"));
                }finally{
                    Marshal.FreeHGlobal(ptr);
                }
            }
            throw new InvalidOperationException("POOLTAG_RETRY_BUDGET_EXHAUSTED");
        }
    }
}
'@
Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
if(-not [ZdjLlamaPoolDiagnostics.PoolTagQuery]::ValidateManagedLayout()){
    throw 'NATIVE_TAG_PARSER_SELF_TEST_FAILED. No native pool query performed.'
}
Write-Host 'NATIVE_POOLTAG_LAYOUT_SELFTEST_PASS (synthetic, does NOT validate OS compatibility)'
if($Mode -eq 'Validate'){
    Write-Host 'VALIDATE_ONLY_COMPLETE: no kernel query or model interaction.'
    return
}

$dir=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
[IO.Directory]::CreateDirectory($dir)|Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$results=New-Object 'System.Collections.Generic.List[object]'
for($i=0;$i -lt $Samples;$i++){
    try {
        $rows=@([ZdjLlamaPoolDiagnostics.PoolTagQuery]::ReadTags())
    }catch{
        Write-Warning ('NATIVE_POOLTAG_UNAVAILABLE: '+$_.Exception.Message)
        Write-Host 'No system settings changed. Do not enable Driver Verifier or pool tagging to bypass failure.'
        Write-Host 'Fallback: arrange operator-approved local Codex official WDK/PoolMon installation or use a supported system diagnostic tool.'
        return
    }
    $m=Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
    $topP=@($rows|Sort-Object PagedBytes -Descending|Select-Object -First $TopRows|
        ForEach-Object {
            [pscustomobject]@{
                tag=$_.Tag;tagHex=$_.TagHex
                bytes=[long]$_.PagedBytes
                gib=[Math]::Round([double]$_.PagedBytes/1GB,4)
                outstanding=([long]$_.PagedAllocations-[long]$_.PagedFrees)
                allocations=[long]$_.PagedAllocations
                frees=[long]$_.PagedFrees
            }
        })
    $topN=@($rows|Sort-Object NonPagedBytes -Descending|Select-Object -First $TopRows|
        ForEach-Object {
            [pscustomobject]@{
                tag=$_.Tag;tagHex=$_.TagHex
                bytes=[long]$_.NonPagedBytes
                gib=[Math]::Round([double]$_.NonPagedBytes/1GB,4)
                outstanding=([long]$_.NonPagedAllocations-[long]$_.NonPagedFrees)
                allocations=[long]$_.NonPagedAllocations
                frees=[long]$_.NonPagedFrees
            }
        })
    $pagedSum=($rows|Measure-Object -Property PagedBytes -Sum).Sum
    $nonpagedSum=($rows|Measure-Object -Property NonPagedBytes -Sum).Sum
    $snap=[pscustomobject]@{
        timeUtc=[DateTimeOffset]::UtcNow.ToString('o')
        operatingSystem=[Environment]::OSVersion.Version.ToString()
        tagCount=$rows.Count
        pagedPoolPerfGiB=[Math]::Round([double]$m.PoolPagedBytes/1GB,4)
        nonpagedPoolPerfGiB=[Math]::Round([double]$m.PoolNonpagedBytes/1GB,4)
        pagedPoolTagSumGiB=[Math]::Round([double]$pagedSum/1GB,4)
        nonpagedPoolTagSumGiB=[Math]::Round([double]$nonpagedSum/1GB,4)
        commitUsedGiB=[Math]::Round([double]$m.CommittedBytes/1GB,4)
        commitFreeGiB=[Math]::Round(([double]$m.CommitLimit-[double]$m.CommittedBytes)/1GB,4)
        topPaged=$topP
        topNonpaged=$topN
    }
    $results.Add($snap)
    Write-Host ""
    Write-Host ("SNAPSHOT {0}/{1} UTC={2} tags={3}" -f ($i+1),$Samples,$snap.timeUtc,$snap.tagCount)
    Write-Host ("Kernel pool counters: paged={0:N3} GiB, nonpaged={1:N3} GiB; sum of exposed tag rows paged={2:N3}, nonpaged={3:N3}" -f $snap.pagedPoolPerfGiB,$snap.nonpagedPoolPerfGiB,$snap.pagedPoolTagSumGiB,$snap.nonpagedPoolTagSumGiB)
    Write-Host "PAGED TOP BY BYTES";$topP|Format-Table tag,gib,outstanding,allocations,frees -AutoSize|Out-Host
    Write-Host "NONPAGED TOP BY BYTES";$topN|Format-Table tag,gib,outstanding,allocations,frees -AutoSize|Out-Host
    if($i+1 -lt $Samples){Start-Sleep -Seconds $IntervalSeconds}
}
$out=Join-Path $dir "pool-tags-native-$stamp.json"
$artifact=[ordered]@{
    method='UNDOCUMENTED_SystemPoolTagInformation_0x16'
    warning='Read-only unsupported binary data layout; not proof of driver identity or leak; tag sums may differ from OS total.'
    selftest='PASS'
    samples=@($results.ToArray())
    noChanges='NO_INSTALL_NO_DRIVER_NO_VERIFIER_NO_REBOOT_NO_MODEL_OR_ENGINE_LIFECYCLE'
}
[IO.File]::WriteAllText($out,($artifact|ConvertTo-Json -Depth 9),[Text.UTF8Encoding]::new($false))
Write-Host "LOCAL_ONLY_NATIVE_POOL_TAGS: $out"
Write-Host 'Do not commit full local system snapshots to public GitHub without review.'
