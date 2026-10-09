# Compare TWO native pool-tag captures separated by a useful interval.
# READ ONLY. Reads existing local JSON, does not query OS or start/stop models.
[CmdletBinding()]
param(
    [string]$DiagnosticDir='',
    [ValidateRange(5,50)][int]$TopRows=20
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([string]::IsNullOrWhiteSpace($DiagnosticDir)){
    $DiagnosticDir=Join-Path $env:LOCALAPPDATA 'ZDJMITS\diagnostics'
}
if(-not(Test-Path -LiteralPath $DiagnosticDir -PathType Container)){
    throw "DIAGNOSTIC_DIR_NOT_FOUND: $DiagnosticDir"
}
$files=@(Get-ChildItem -LiteralPath $DiagnosticDir -Filter 'pool-tags-native-*.json' -File |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 2)
if($files.Count -lt 2){
    Write-Warning 'POOL_TAG_TREND_NEEDS_TWO_SEPARATE_CAPTURES: run the native capture again later; do not reboot/restart models to manufacture a trend.'
    return
}
$newer=Get-Content -LiteralPath $files[0].FullName -Raw -ErrorAction Stop | ConvertFrom-Json
$older=Get-Content -LiteralPath $files[1].FullName -Raw -ErrorAction Stop | ConvertFrom-Json
if($newer.method -ne 'UNDOCUMENTED_SystemPoolTagInformation_0x16' -or
   $older.method -ne 'UNDOCUMENTED_SystemPoolTagInformation_0x16'){
    throw 'INCOMPATIBLE_CAPTURE_METHOD: only native-tag query JSON supported'
}
if(-not $newer.samples -or -not $older.samples){throw 'INVALID_CAPTURE_SAMPLES'}
$a=@($older.samples)[-1]
$b=@($newer.samples)[-1]
$ta=[DateTimeOffset]::Parse([string]$a.timeUtc)
$tb=[DateTimeOffset]::Parse([string]$b.timeUtc)
$elapsed=($tb-$ta).TotalMinutes
if($elapsed -le 0){throw 'INVALID_CAPTURE_CHRONOLOGY'}
if($elapsed -lt 10){
    Write-Warning ("SHORT_OBSERVATION_INTERVAL minutes={0:N2}: a flat delta cannot rule out a leak." -f $elapsed)
}
function Convert-TopRowIndex {
    param($Snapshot)
    $index=@{}
    foreach($row in @($Snapshot.topPaged)){
        $key='P:'+([string]$row.tagHex)
        $index[$key]=[pscustomobject]@{type='Paged';tag=$row.tag;bytes=[long]$row.bytes;outstanding=[long]$row.outstanding}
    }
    foreach($row in @($Snapshot.topNonpaged)){
        $key='N:'+([string]$row.tagHex)
        $index[$key]=[pscustomobject]@{type='Nonpaged';tag=$row.tag;bytes=[long]$row.bytes;outstanding=[long]$row.outstanding}
    }
    return $index
}
$oldIdx=Convert-TopRowIndex -Snapshot $a
$newIdx=Convert-TopRowIndex -Snapshot $b
$joined=New-Object 'System.Collections.Generic.List[object]'
foreach($key in @($oldIdx.Keys)){
    if(-not $newIdx.ContainsKey($key)){
        # Top-N lists are not exhaustive; absence from top-N is NOT zero bytes.
        continue
    }
    $old=$oldIdx[$key];$new=$newIdx[$key]
    $joined.Add([pscustomobject]@{
        tag=[string]$old.tag;type=[string]$old.type
        oldGiB=[Math]::Round([double]$old.bytes/1GB,4)
        newGiB=[Math]::Round([double]$new.bytes/1GB,4)
        deltaMiB=[Math]::Round(([double]$new.bytes-[double]$old.bytes)/1MB,3)
        oldOutstanding=[long]$old.outstanding;newOutstanding=[long]$new.outstanding
        deltaOutstanding=([long]$new.outstanding-[long]$old.outstanding)
    })
}
Write-Host ("OLDER_CAPTURE: {0} {1}" -f $files[1].Name,$ta)
Write-Host ("NEWER_CAPTURE: {0} {1}" -f $files[0].Name,$tb)
Write-Host ("INTERVAL_MINUTES: {0:N2}" -f $elapsed)
Write-Host ("OS PAGED_POOL_GIB: {0:N3} -> {1:N3}" -f $a.pagedPoolPerfGiB,$b.pagedPoolPerfGiB)
Write-Host ("OS NONPAGED_POOL_GIB: {0:N3} -> {1:N3}" -f $a.nonpagedPoolPerfGiB,$b.nonpagedPoolPerfGiB)
Write-Host 'COMMON_TOP_TAGS_ORDERED_BY_DELTA_MIB:'
$joined|Sort-Object deltaMiB -Descending|Select-Object -First $TopRows|
    Format-Table type,tag,oldGiB,newGiB,deltaMiB,deltaOutstanding -AutoSize|Out-Host
Write-Host 'Top-N inclusion is limited; unlisted tags were not zero. A rising count alone is not a proven leak.'
Write-Host 'NO_SYSTEM_OR_MODEL_CHANGE_PERFORMED'
