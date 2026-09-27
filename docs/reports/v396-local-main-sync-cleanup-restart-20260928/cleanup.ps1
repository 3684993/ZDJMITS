# Destructive cleanup is gated by fresh READY and exact canonical runtime identity.
$ErrorActionPreference='Stop';Set-Location 'D:\MITS'
$out='D:\MITS\docs\reports\v396-local-main-sync-cleanup-restart-20260928'
$h=Invoke-RestMethod http://127.0.0.1:8080/health -TimeoutSec 10
if(-not $h.ready){throw 'CLEANUP_REQUIRES_READY'}
node (Join-Path $out 'identity.mjs') after
if($LASTEXITCODE -ne 0){throw 'CLEANUP_REQUIRES_IDENTITY_CLOSED'}
$plan=Get-Content (Join-Path $out 'cleanup-plan.json') -Raw | ConvertFrom-Json
$preserved=Get-Content (Join-Path $out 'preservation-manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
$receiptPath=Join-Path $out 'cleanup-receipt.json'
if(Test-Path -LiteralPath $receiptPath){throw 'CLEANUP_ALREADY_ATTEMPTED_INSPECT_RECEIPT'}
$record=[ordered]@{startedAt=[DateTime]::UtcNow.ToString('o');status='IN_PROGRESS';removedWorktrees=@();preservedLocalFiles=@();unlinkedReparsePoints=@();movedLegacyRoots=@()}
function Save-Receipt {$record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8}
function Assert-Target([string]$p){
 $full=[IO.Path]::GetFullPath($p).TrimEnd('\')
 if($full -eq 'D:\MITS' -or -not ($full.StartsWith('D:\MITS-',[StringComparison]::OrdinalIgnoreCase) -or $full -eq 'D:\MITS\_codex_pr2_gate_9b6549c')){throw "UNAPPROVED_CLEANUP_PATH $full"}
 if((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Root is a reparse point'}
 return $full
}
function Unlink-ReparseChildren([string]$folder,[string]$boundary){
 foreach($item in Get-ChildItem -LiteralPath $folder -Force){
  if(-not $item.FullName.StartsWith($boundary+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Reparse traversal escape'}
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){
   $record.unlinkedReparsePoints+=@{path=$item.FullName;target=$item.Target;operation='Remove link only, never recurse into target'}
   Remove-Item -LiteralPath $item.FullName -Force
  }elseif($item.PSIsContainer){Unlink-ReparseChildren $item.FullName $boundary}
 }
}
Save-Receipt
foreach($entry in $plan.worktrees){
 $target=Assert-Target $entry.path
 $users=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0})
 if($users.Count){throw "CHECKOUT_STILL_IN_USE $target"}
 foreach($p in $preserved.files | Where-Object {$_.checkout -eq $target -and $_.category -ne 'NESTED_WORKTREE_OR_DIRECTORY'}){
  $source=[IO.Path]::GetFullPath((Join-Path $target $p.path))
  if(-not $source.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Preserved source escape'}
  if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $p.sha256){throw 'Dirty source changed since backup'}
  if((Get-FileHash -LiteralPath $p.localArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $p.sha256){throw 'Dirty backup mismatch'}
 }
 foreach($p in $entry.preserveLocalFiles){
  $source=[IO.Path]::GetFullPath((Join-Path $target $p.path));$dest=[IO.Path]::GetFullPath((Join-Path ('D:\MITS\backups\local-convergence-20260928\legacy-private\'+(Split-Path -Leaf $target)) $p.path))
  if(-not $source.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $dest.StartsWith('D:\MITS\backups\local-convergence-20260928\legacy-private\',[StringComparison]::OrdinalIgnoreCase)){throw 'Archive move path escape'}
  $hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
  Move-Item -LiteralPath $source -Destination $dest
  if((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $hash){throw 'Archived file mismatch'}
  $record.preservedLocalFiles+=@{source=$source;archive=$dest;sha256=$hash}
 }
 Unlink-ReparseChildren $target $target
 Save-Receipt
 git worktree remove --force -- $target
 if($LASTEXITCODE -ne 0){throw "WORKTREE_REMOVE_FAILED $target"}
 if(Test-Path -LiteralPath $target){throw 'Removed worktree still exists'}
 $record.removedWorktrees+=$target;Save-Receipt
}
foreach($source in $plan.nonGitRootsPreserveByMove){
 $target=Assert-Target $source
 $dest='D:\MITS\backups\local-convergence-20260928\legacy-directories\'+(Split-Path -Leaf $target)
 $dest=[IO.Path]::GetFullPath($dest)
 if(-not $dest.StartsWith('D:\MITS\backups\local-convergence-20260928\legacy-directories\',[StringComparison]::OrdinalIgnoreCase)){throw 'Legacy target escape'}
 New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
 Move-Item -LiteralPath $target -Destination $dest
 $record.movedLegacyRoots+=@{source=$target;archive=$dest};Save-Receipt
}
$container=Assert-Target 'D:\MITS-worktrees'
$remaining=@(Get-ChildItem -LiteralPath $container -Force)
if($remaining.Count -eq 0){Remove-Item -LiteralPath $container -Force;$record.removedEmptyContainer=$container}else{$record.remainingContainerEntries=@($remaining.FullName)}
$record.status='D_DRIVE_CLEANUP_COMPLETED';$record.endedAt=[DateTime]::UtcNow.ToString('o');Save-Receipt
