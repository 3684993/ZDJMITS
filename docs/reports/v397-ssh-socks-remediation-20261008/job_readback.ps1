param([int[]]$ProcessIds)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class ZdjJobReadback{[DllImport("kernel32.dll",SetLastError=true)]public static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);}'
$rows=foreach($taskId in $ProcessIds){
  $process=Get-Process -Id $taskId -ErrorAction SilentlyContinue
  $meta=Get-CimInstance Win32_Process -Filter "ProcessId=$taskId" -ErrorAction SilentlyContinue
  if($process){$inJob=$false;$ok=[ZdjJobReadback]::IsProcessInJob($process.Handle,[IntPtr]::Zero,[ref]$inJob)
    @{pid=$taskId;inJob=$inJob;queryOk=$ok;parentPid=$meta.ParentProcessId;createdAt=([datetime]$meta.CreationDate).ToUniversalTime().ToString('o');name=$meta.Name}
  }else{@{pid=$taskId;exists=$false}}
}
$rows|ConvertTo-Json -Depth 5
