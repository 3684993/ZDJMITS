$ErrorActionPreference='Stop'
$out='D:\MITS\docs\reports\v396-local-main-sync-cleanup-restart-20260928'
$h=Invoke-RestMethod http://127.0.0.1:8080/health -TimeoutSec 10
if(-not $h.ready){throw 'READY_REQUIRED'}
$rows=Get-Content (Join-Path $out 'remaining-container-inventory.json') -Raw | ConvertFrom-Json
$removed=@()
foreach($row in $rows|Where-Object {$_.action -eq 'DELETE_OBSOLETE_BUILD'}){
 $p=(Resolve-Path -LiteralPath $row.path).Path
 if((Split-Path -Parent $p) -ne 'D:\MITS-worktrees' -or (Split-Path -Leaf $p) -notlike 'backup-live-dist*'){throw 'Obsolete build boundary mismatch'}
 if(@($row.reparsePoints).Count -or @($row.gitMarkers).Count){throw 'Unexpected reparse or Git repository in build'}
 Remove-Item -LiteralPath $p -Recurse -Force
 $removed+=$p
}
$source=(Resolve-Path -LiteralPath 'D:\MITS-worktrees').Path
$dest=[IO.Path]::GetFullPath('D:\MITS\backups\local-convergence-20260928\legacy-directories\MITS-worktrees-forensics')
if($source -ne 'D:\MITS-worktrees' -or -not $dest.StartsWith('D:\MITS\backups\')){throw 'Container move boundary mismatch'}
if(@($rows|Where-Object {$_.gitMarkers.Count -or $_.reparsePoints.Count}).Count){throw 'Forensic container still has Git/reparse data'}
Move-Item -LiteralPath $source -Destination $dest
[ordered]@{at=[DateTime]::UtcNow.ToString('o');obsoleteBuildsDeleted=$removed;remainingForensicsMovedTo=$dest;DTopLevelMitsDirectories=@(Get-ChildItem D:\ -Directory -Filter 'MITS*'|Select-Object -ExpandProperty FullName)}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $out 'remaining-container-cleanup.json') -Encoding utf8
