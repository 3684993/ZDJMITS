# ZDJMITS Read-only file-system minifilter driver provenance, no software installation.
# Collects live fltmc name/service mapping + signature version and SHA256 of EXISTING
# loaded filter .sys files. Nothing is loaded/unloaded, started/stopped, or modified.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$fltmc=Join-Path $env:SystemRoot 'System32\fltmc.exe'
if(-not (Test-Path -LiteralPath $fltmc -PathType Leaf)){
    throw 'WINDOWS_FLTMC_UNAVAILABLE'
}
$lines=@(& $fltmc filters 2>&1)
if($LASTEXITCODE -ne 0){throw "FLTMC_FILTERS_UNAVAILABLE exitCode=$LASTEXITCODE"}
$serviceIndex=@{}
foreach($drv in @(Get-CimInstance Win32_SystemDriver -ErrorAction Stop)){
    if(-not [string]::IsNullOrWhiteSpace([string]$drv.Name)){
        $serviceIndex[[string]$drv.Name]=$drv
    }
}
function Resolve-SystemDriverBinary {
    param([string]$PathName)
    if([string]::IsNullOrWhiteSpace($PathName)){return $null}
    $v=$PathName.Trim().Trim('"')
    $v=[Environment]::ExpandEnvironmentVariables($v)
    $v=$v -replace '^(?i)\\SystemRoot\\', ([regex]::Escape($env:SystemRoot) + '\')
    # Replace the common NT service path prefix without inventing arbitrary paths.
    $v=$v -replace '^(?i)\\\?\?\\',''
    if($v -match '^(?i)System32\\'){
        $v=Join-Path $env:SystemRoot $v
    }
    if($v -match '^(?i)\\Windows\\'){
        $v=Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) $v.TrimStart('\')
    }
    if(Test-Path -LiteralPath $v -PathType Leaf){return $v}
    return $null
}
$names=New-Object 'System.Collections.Generic.List[string]'
foreach($line in $lines){
    if([string]$line -match '^\s*(?<Name>[A-Za-z0-9_.-]+)\s+\d+\s+\d+(?:\.\d+)?\s+(?<Frame>\S+)\s*$'){
        $names.Add($Matches.Name)
    }
}
if(-not $names.Count){
    throw 'FLTMC_NAME_PARSE_UNAVAILABLE: no driver signing claims generated'
}
$rows=New-Object 'System.Collections.Generic.List[object]'
foreach($name in @($names)){
    $matched=$serviceIndex.ContainsKey([string]$name)
    $drv=$(if($matched){$serviceIndex[[string]$name]}else{$null})
    $path=$(if($drv){Resolve-SystemDriverBinary -PathName ([string]$drv.PathName)}else{$null})
    $signature=$(if($path){Get-AuthenticodeSignature -LiteralPath $path -ErrorAction SilentlyContinue}else{$null})
    $file=$(if($path){Get-Item -LiteralPath $path -ErrorAction SilentlyContinue}else{$null})
    $hash=$(if($path){Get-FileHash -LiteralPath $path -Algorithm SHA256 -ErrorAction SilentlyContinue}else{$null})
    $rows.Add([pscustomobject]@{
        filterName=$name
        serviceMatch=$matched
        serviceState=$(if($drv){[string]$drv.State}else{$null})
        serviceStartMode=$(if($drv){[string]$drv.StartMode}else{$null})
        binaryFound=($null -ne $path)
        binaryFileName=$(if($path){[IO.Path]::GetFileName($path)}else{$null})
        version=$(if($file){[string]$file.VersionInfo.FileVersion}else{$null})
        productName=$(if($file){[string]$file.VersionInfo.ProductName}else{$null})
        companyName=$(if($file){[string]$file.VersionInfo.CompanyName}else{$null})
        signatureStatus=$(if($signature){[string]$signature.Status}else{'UNAVAILABLE'})
        certificateSubject=$(if($signature -and $signature.SignerCertificate){[string]$signature.SignerCertificate.Subject}else{$null})
        sha256=$(if($hash){[string]$hash.Hash}else{$null})
        absolutePathLocalOnly=$path
        serviceImagePathLocalOnly=$(if($drv){[string]$drv.PathName}else{$null})
        mappingConfidence='SAME_SERVICE_NAME_ONLY_NOT_POOL_TAG_OWNER_PROOF'
    })
}
$folder=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
[IO.Directory]::CreateDirectory($folder)|Out-Null
$out=Join-Path $folder ('filter-driver-provenance-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
$result=[ordered]@{
    purpose='READ_ONLY_MINIFILTER_PROVENANCE'
    utc=[DateTimeOffset]::UtcNow.ToString('o')
    filters=@($rows.ToArray())
    disclaimer='Signature/version checks of reported driver binaries do not attribute kernel pool tags, and an absent file may merely be unresolved path.'
    noChanges='NO_DRIVER_CHANGE_NO_MODEL_ACTION_NO_OS_SETTING_CHANGE_NO_EXCHANGE_ACTION'
}
[IO.File]::WriteAllText($out,($result | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$rows | Select-Object filterName,binaryFileName,version,companyName,signatureStatus |
    Format-Table -AutoSize | Out-Host
Write-Host "LOCAL_ONLY_DRIVER_PROVENANCE: $out"
Write-Host 'Driver names/signatures are evidence of installed components, not of allocation ownership.'
Write-Host 'NO_DRIVER_WAS_CHANGED'
