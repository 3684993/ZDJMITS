# Windows 11 x64 C: fixed 48GiB + retain D: system-managed pagefile.
# MODE PLAN=readonly, APPLY=explicit OS setting change (admin), VERIFY=readonly after manual reboot.
# NEVER reboots, stops/starts processes, changes any other driver/Windows security setting.
# This is a capacity mitigation, not a Windows File/FilterManager pool-leak fix.
[CmdletBinding()]
param(
    [ValidateSet('Plan','Apply','Verify')][string]$Mode='Plan',
    [switch]$ConfirmApply
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$CPageMB=49152
$KeepCFreeGiB=16
$KeepDFreeGiB=16
$regPath='HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management'
function Get-Snapshot {
    $cs=Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    $settings=@(Get-CimInstance Win32_PageFileSetting -ErrorAction Stop)
    $usage=@(Get-CimInstance Win32_PageFileUsage -ErrorAction Stop)
    $mem=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
    $c=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction Stop
    $d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='D:'" -ErrorAction Stop
    $reg=(Get-ItemProperty -LiteralPath $regPath -Name PagingFiles -ErrorAction Stop).PagingFiles
    $crash=Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\CrashControl' -ErrorAction Stop
    [pscustomobject]@{
        utc=[DateTimeOffset]::UtcNow.ToString('o')
        automaticManaged=[bool]$cs.AutomaticManagedPagefile
        pagefileSettings=@($settings | Select-Object Name,InitialSize,MaximumSize)
        actualPagefiles=@($usage | Select-Object Name,AllocatedBaseSize,CurrentUsage,PeakUsage)
        registryPagingFiles=@($reg)
        dumpType=$crash.CrashDumpEnabled
        dedicatedDumpFile=$(if($crash.PSObject.Properties['DedicatedDumpFile']){[string]$crash.DedicatedDumpFile}else{$null})
        cFreeGiB=[Math]::Round([double]$c.FreeSpace/1GB,3)
        dFreeGiB=[Math]::Round([double]$d.FreeSpace/1GB,3)
        commitUsedGiB=[Math]::Round([double]$mem.CommittedBytes/1GB,3)
        commitLimitGiB=[Math]::Round([double]$mem.CommitLimit/1GB,3)
        commitFreeGiB=[Math]::Round(([double]$mem.CommitLimit-[double]$mem.CommittedBytes)/1GB,3)
        pagedPoolGiB=[Math]::Round([double]$mem.PoolPagedBytes/1GB,3)
        nonpagedPoolGiB=[Math]::Round([double]$mem.PoolNonpagedBytes/1GB,3)
    }
}
function Get-OnlyPagefileDrives {
    param($Snapshot)
    $names=@($Snapshot.actualPagefiles | ForEach-Object {[string]$_.Name})+
        @($Snapshot.pagefileSettings | ForEach-Object {[string]$_.Name})
    foreach($name in $names){
        if($name -notmatch '^[CD]:\\pagefile\.sys$'){
            throw "UNEXPECTED_PAGEFILE_TOPOLOGY: $name ; no changes performed"
        }
    }
}
function Write-LocalReceipt {
    param([string]$Name,$Payload)
    $dir=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
    [IO.Directory]::CreateDirectory($dir)|Out-Null
    $out=Join-Path $dir ($Name+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
    [IO.File]::WriteAllText($out,($Payload|ConvertTo-Json -Depth 9),[Text.UTF8Encoding]::new($false))
    Write-Host "LOCAL_ONLY_RECEIPT: $out"
}
$before=Get-Snapshot
Write-Host ("CURRENT: autoManaged={0}; C free={1:N2}GiB D free={2:N2}GiB; COMMIT={3:N2}/{4:N2}GiB free={5:N2}GiB" -f $before.automaticManaged,$before.cFreeGiB,$before.dFreeGiB,$before.commitUsedGiB,$before.commitLimitGiB,$before.commitFreeGiB)
Write-Host 'CURRENT PAGEFILE USAGE:'
$before.actualPagefiles | Format-Table -AutoSize | Out-Host
Write-Host 'CURRENT PAGEFILE SETTINGS:'
$before.pagefileSettings | Format-Table -AutoSize | Out-Host
if($Mode -eq 'Verify'){
    $c=@($before.actualPagefiles | Where-Object {[string]$_.Name -ieq 'C:\pagefile.sys'})
    $d=@($before.actualPagefiles | Where-Object {[string]$_.Name -ieq 'D:\pagefile.sys'})
    $cSetting=@($before.pagefileSettings|Where-Object {[string]$_.Name -ieq 'C:\pagefile.sys'})
    $dSetting=@($before.pagefileSettings|Where-Object {[string]$_.Name -ieq 'D:\pagefile.sys'})
    if($before.automaticManaged -or $c.Count -ne 1 -or $d.Count -ne 1 -or
       $c[0].AllocatedBaseSize -lt 48000 -or
       $cSetting.Count -ne 1 -or $dSetting.Count -ne 1 -or
       [int]$cSetting[0].InitialSize -ne $CPageMB -or [int]$cSetting[0].MaximumSize -ne $CPageMB -or
       [int]$dSetting[0].InitialSize -ne 0 -or [int]$dSetting[0].MaximumSize -ne 0 -or
       $before.commitFreeGiB -lt 70){
       Write-Warning 'PAGEFILE_VERIFY_BLOCKED: no model start permitted. Check after Windows reboot; inspect settings and current commit.'
       Write-LocalReceipt -Name 'pagefile-verify-failed' -Payload $before
       return
    }
    Write-Host 'PAGEFILE_VERIFY_PASS: C fixed48GiB + D system-managed; host free-commit>=70GiB'
    Write-LocalReceipt -Name 'pagefile-verify-pass' -Payload $before
    return
}
Get-OnlyPagefileDrives -Snapshot $before
$cs=Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
$settings=@(Get-CimInstance Win32_PageFileSetting -ErrorAction Stop)
$cSettings=@($settings|Where-Object {[string]$_.Name -ieq 'C:\pagefile.sys'})
$dSettings=@($settings|Where-Object {[string]$_.Name -ieq 'D:\pagefile.sys'})
$livePagefiles=@($before.actualPagefiles)
$cLive=@($livePagefiles|Where-Object {[string]$_.Name -ieq 'C:\pagefile.sys'})
$dLive=@($livePagefiles|Where-Object {[string]$_.Name -ieq 'D:\pagefile.sys'})
if($cLive.Count -ne 0 -or $cSettings.Count -ne 0){
    throw 'C_PAGEFILE_ALREADY_CONFIGURED: do not overwrite unknown configuration'
}
if($dLive.Count -ne 1 -or $dSettings.Count -gt 1){
    throw 'D_PAGEFILE_EXPECTED_SINGLE: no changes performed'
}
if(-not $before.automaticManaged) {
    throw 'CUSTOM_PAGEFILE_LAYOUT_ALREADY_ACTIVE: inspect actual config before editing'
}
if($before.cFreeGiB -lt 48+$KeepCFreeGiB -or $before.dFreeGiB -lt $KeepDFreeGiB){
    throw ("DISK_SPACE_GUARD: require C free>=64GiB and D free>=16GiB; currently C={0:N2} D={1:N2}" -f $before.cFreeGiB,$before.dFreeGiB)
}
Write-Host 'PLAN: switch global automatic pagefile flag OFF; keep D:\pagefile.sys via explicit System-managed (0/0); add C:\pagefile.sys fixed 49152/49152 MiB.'
Write-Host 'PLAN: existing runtime pagefiles remain until user performs an OS restart; preserve crash dump configuration (do not edit CrashControl).'
Write-Host ("ESTIMATED HOST FREE COMMIT AFTER REBOOT IF USAGE IS UNCHANGED: ~{0:N2}GiB; ACTUAL VALUE MUST BE MEASURED" -f ($before.commitFreeGiB+48))
Write-LocalReceipt -Name 'pagefile-before' -Payload $before
if($Mode -eq 'Plan'){Write-Host 'PLAN_ONLY_NO_CHANGES';return}
if(-not $ConfirmApply.IsPresent){throw 'EXPLICIT_CONFIRMATION_REQUIRED: -Mode Apply -ConfirmApply'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw 'ADMINISTRATOR_REQUIRED: open elevated Windows PowerShell; no changes performed'
}
# Verify exact readback just before first write, avoiding silent extra pagefiles.
$beforeWrite=Get-Snapshot
if(-not $beforeWrite.automaticManaged -or
   $beforeWrite.cFreeGiB -lt 48+$KeepCFreeGiB -or
   @($beforeWrite.actualPagefiles).Count -ne 1 -or
   [string]$beforeWrite.actualPagefiles[0].Name -ine 'D:\pagefile.sys'){
    throw 'CONFIG_CHANGED_SINCE_PLAN: no changes performed'
}
$changedAuto=$false
$addedD=$false
$addedC=$false
try{
    $cs | Set-CimInstance -Property @{AutomaticManagedPagefile=$false} -ErrorAction Stop
    $changedAuto=$true
    # Automatic mode often has no explicit Win32_PageFileSetting object.
    $afterSwitch=@(Get-CimInstance Win32_PageFileSetting -ErrorAction Stop)
    foreach($entry in $afterSwitch){
        if([string]$entry.Name -notin @('D:\pagefile.sys','C:\pagefile.sys')){
            throw "UNEXPECTED_PAGEFILE_ENTRY_AFTER_SWITCH: $($entry.Name)"
        }
    }
    $dExisting=@($afterSwitch|Where-Object {[string]$_.Name -ieq 'D:\pagefile.sys'})
    if($dExisting.Count -gt 1){throw 'DUPLICATE_D_PAGEFILE_SETTING'}
    if($dExisting.Count -eq 1){
        $dExisting[0]|Set-CimInstance -Property @{InitialSize=0;MaximumSize=0} -ErrorAction Stop
    }else{
        [void](New-CimInstance -ClassName Win32_PageFileSetting -Property @{
            Name='D:\pagefile.sys';InitialSize=[uint32]0;MaximumSize=[uint32]0
        } -ErrorAction Stop)
        $addedD=$true
    }
    $cExisting=@(Get-CimInstance Win32_PageFileSetting -ErrorAction Stop |
        Where-Object {[string]$_.Name -ieq 'C:\pagefile.sys'})
    if($cExisting.Count){throw 'C_PAGEFILE_CREATED_BY_OTHER_ACTOR: refusing overwrite'}
    [void](New-CimInstance -ClassName Win32_PageFileSetting -Property @{
        Name='C:\pagefile.sys';InitialSize=[uint32]$CPageMB;MaximumSize=[uint32]$CPageMB
    } -ErrorAction Stop)
    $addedC=$true
    $pending=Get-Snapshot
    $cc=@($pending.pagefileSettings|Where-Object {$_.Name -ieq 'C:\pagefile.sys'})
    $dd=@($pending.pagefileSettings|Where-Object {$_.Name -ieq 'D:\pagefile.sys'})
    if($pending.automaticManaged -or $cc.Count -ne 1 -or $dd.Count -ne 1 -or
       [int]$cc[0].InitialSize -ne $CPageMB -or [int]$cc[0].MaximumSize -ne $CPageMB -or
       [int]$dd[0].InitialSize -ne 0 -or [int]$dd[0].MaximumSize -ne 0){
        throw 'PAGEFILE_PENDING_READBACK_MISMATCH'
    }
    Write-LocalReceipt -Name 'pagefile-pending-reboot' -Payload ([ordered]@{
        before=$before;pending=$pending;requiresManualReboot=$true
    })
    Write-Host 'PAGEFILE_CONFIG_APPLIED_PENDING_REBOOT: C fixed48GiB; D remains system-managed. DO NOT START models yet.'
    Write-Host 'NEXT: operator chooses Windows Restart (this stops the currently running 9B), then run -Mode Verify.'
}catch{
    $failure=$_.Exception.Message
    Write-Warning "PAGEFILE_CONFIG_FAILED: $failure"
    # Best-effort rollback of ONLY the entries created by this invocation.
    # If rollback fails, preserve the existing state and demand manual inspection.
    $rollback=@()
    if($addedC){
        try{
            $cc=@(Get-CimInstance Win32_PageFileSetting -ErrorAction Stop|
                 Where-Object {$_.Name -ieq 'C:\pagefile.sys'})
            foreach($e in $cc){$e|Remove-CimInstance -ErrorAction Stop}
            $rollback+='C_PAGEFILE_ENTRY_DELETED'
        }catch{$rollback+=("C_ROLLBACK_FAILED:"+$_.Exception.Message)}
    }
    if($addedD){
        try{
            $dd=@(Get-CimInstance Win32_PageFileSetting -ErrorAction Stop|
                Where-Object {$_.Name -ieq 'D:\pagefile.sys'})
            foreach($e in $dd){$e|Remove-CimInstance -ErrorAction Stop}
            $rollback+='CREATED_D_ENTRY_REMOVED'
        }catch{$rollback+=("D_ROLLBACK_FAILED:"+$_.Exception.Message)}
    }
    if($changedAuto){
        try{
            (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop)|
                Set-CimInstance -Property @{AutomaticManagedPagefile=$true} -ErrorAction Stop
            $rollback+='RESTORED_AUTOMATIC_MANAGEMENT_FLAG'
        }catch{$rollback+=("AUTO_FLAG_ROLLBACK_FAILED:"+$_.Exception.Message)}
    }
    Write-LocalReceipt -Name 'pagefile-apply-error' -Payload ([ordered]@{
        error=$failure;rollback=$rollback;after=Get-Snapshot
    })
    throw 'PAGEFILE_APPLY_FAILED_INSPECT_LOCAL_RECEIPT; DO_NOT_REBOOT_UNTIL_PENDING_SETTINGS_REVIEWED'
}
