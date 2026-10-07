[CmdletBinding()]
param(
  [string]$Root = "D:\MITS\data",
  [int]$Top = 80
)

$ErrorActionPreference='Stop'
if(-not (Test-Path -LiteralPath $Root)){ throw "DATA_ROOT_NOT_FOUND: $Root" }

$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir=Join-Path $Root 'diagnostics'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$jsonPath=Join-Path $outDir "storage-audit-$stamp.json"
$txtPath=Join-Path $outDir "storage-audit-$stamp.txt"

$files=@(Get-ChildItem -LiteralPath $Root -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
  $full=$_.FullName
  $relative=$full.Substring($Root.TrimEnd('\').Length).TrimStart('\')
  $name=$_.Name
  $kind=if($name -match '\.sqlite-(wal|shm)$|\.sqlite\.(wal|shm)$'){'SQLITE_SIDECAR'}
    elseif($name -match '\.(sqlite|db)$'){'SQLITE'}
    elseif($name -match '\.(jsonl|log|txt)$'){'LOG'}
    elseif($name -match '\.gz$'){'COMPRESSED_LOG'}
    elseif($name -match '\.(tmp|journal)$'){'TEMP_OR_JOURNAL'}
    else{'OTHER'}
  [pscustomobject]@{
    relativePath=$relative
    fullPath=$full
    bytes=[int64]$_.Length
    mib=[math]::Round($_.Length/1MB,2)
    gib=[math]::Round($_.Length/1GB,3)
    kind=$kind
    lastWrite=$_.LastWriteTime.ToString('s')
  }
})

$total=[int64](($files | Measure-Object -Property bytes -Sum).Sum)
$topFiles=@($files | Sort-Object bytes -Descending | Select-Object -First ([math]::Max(1,$Top)))
$byKind=@($files | Group-Object kind | ForEach-Object {
  $sum=[int64](($_.Group | Measure-Object -Property bytes -Sum).Sum)
  [pscustomobject]@{kind=$_.Name;files=$_.Count;bytes=$sum;gib=[math]::Round($sum/1GB,3)}
} | Sort-Object bytes -Descending)
$byTopDirectory=@($files | ForEach-Object {
  $segment=($_.relativePath -split '\\')[0]
  [pscustomobject]@{directory=$segment;bytes=$_.bytes}
} | Group-Object directory | ForEach-Object {
  $sum=[int64](($_.Group | Measure-Object -Property bytes -Sum).Sum)
  [pscustomobject]@{directory=$_.Name;bytes=$sum;gib=[math]::Round($sum/1GB,3)}
} | Sort-Object bytes -Descending)

$result=[ordered]@{
  schemaVersion='ZDJ-STORAGE-AUDIT-1'
  generatedAt=(Get-Date).ToString('o')
  root=(Resolve-Path -LiteralPath $Root).Path
  totalBytes=$total
  totalGiB=[math]::Round($total/1GB,3)
  fileCount=$files.Count
  byKind=$byKind
  byTopDirectory=$byTopDirectory
  topFiles=$topFiles
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$lines=@()
$lines+="ZDJ Runtime Storage Audit"
$lines+="Root: $($result.root)"
$lines+="Total: $($result.totalGiB) GiB / $($result.fileCount) files"
$lines+=""
$lines+="By top directory:"
$lines+=($byTopDirectory | Format-Table -AutoSize | Out-String).TrimEnd()
$lines+=""
$lines+="By kind:"
$lines+=($byKind | Format-Table -AutoSize | Out-String).TrimEnd()
$lines+=""
$lines+="Top files:"
$lines+=($topFiles | Select-Object gib,mib,kind,relativePath,lastWrite | Format-Table -AutoSize | Out-String -Width 240).TrimEnd()
$lines | Set-Content -LiteralPath $txtPath -Encoding UTF8

Write-Host "Storage audit complete."
Write-Host "Total GiB : $($result.totalGiB)"
Write-Host "Report    : $txtPath"
Write-Host "JSON      : $jsonPath"
$topFiles | Select-Object -First 20 gib,mib,kind,relativePath | Format-Table -AutoSize
