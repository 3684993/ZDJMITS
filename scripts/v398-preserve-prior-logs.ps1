# Preserve original private runtime logs before the manual launcher opens new streams.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$logRoot='D:\MITS\data\runtime-logs'
$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$rows=@()
foreach($name in @('engine.stdout.log','engine.stderr.log')){
 $source=Join-Path $logRoot $name
 if(-not (Test-Path -LiteralPath $source)){continue}
 $archive=Join-Path $logRoot ($name+'.before-v398-'+$stamp)
 if(Test-Path -LiteralPath $archive){throw 'PRIOR_LOG_ARCHIVE_EXISTS'}
 $hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
 Copy-Item -LiteralPath $source -Destination $archive
 if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $hash){throw 'PRIOR_LOG_ARCHIVE_HASH_MISMATCH'}
 $rows+=@{source=$source;privateArchive=$archive;bytes=(Get-Item -LiteralPath $source).Length;sha256=$hash;identical=$true}
}
@{at=[DateTimeOffset]::UtcNow.ToString('o');rawPrivateRuntimeLogsExcludedFromGitHub=$true;preserved=$rows}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'docs\reports\v398-entry-sizing-quality-review\evidence-20261008\prior-runtime-log-preservation.json') -Encoding UTF8
