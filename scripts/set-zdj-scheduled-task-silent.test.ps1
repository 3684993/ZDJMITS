$ErrorActionPreference='Stop'
$taskRoot=Join-Path ([IO.Path]::GetTempPath()) ('zdj-silent-test-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $taskRoot | Out-Null
try {
  # No real scheduled task is registered or run. Exercise generated launcher with a harmless child.
  $child=Join-Path $taskRoot 'child probe.ps1'
  $proof=Join-Path $taskRoot 'visibility.json'
  @'
param([string]$Proof)
try {
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ZdjSilentProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }'
$handle=[ZdjSilentProbe]::GetConsoleWindow()
@{consoleVisible=([ZdjSilentProbe]::IsWindowVisible($handle));workingDirectory=[IO.Directory]::GetCurrentDirectory()} | ConvertTo-Json | Set-Content -LiteralPath $Proof
Start-Sleep -Milliseconds 100
exit 23
} catch { $_.Exception.ToString() | Set-Content -LiteralPath ($Proof+'.error'); exit 1 }
'@ | Set-Content -LiteralPath $child
  $global:zdjSilentTestFixture=[pscustomobject]@{Actions=@([pscustomobject]@{Execute=(Get-Command powershell.exe).Source;Arguments=('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$child+'" -Proof "'+$proof+'"');WorkingDirectory=$taskRoot});Principal=[pscustomobject]@{UserId='test-user';LogonType=3}}
  $global:zdjSilentTestSetCalls=0
  function Get-ScheduledTask { param($TaskName,$TaskPath) return $global:zdjSilentTestFixture }
  function Export-ScheduledTask { param($TaskName,$TaskPath) return '<Task>mock-preserved-registration</Task>' }
  function New-ScheduledTaskAction { param($Execute,$Argument) return [pscustomobject]@{Execute=$Execute;Arguments=$Argument;WorkingDirectory=''} }
  function Set-ScheduledTask { param($TaskName,$TaskPath,$Action) $global:zdjSilentTestSetCalls++;$global:zdjSilentTestFixture.Actions=@($Action);return $global:zdjSilentTestFixture }
  $r=& (Join-Path $PSScriptRoot 'set-zdj-scheduled-task-silent.ps1') -TaskName 'ZDJ-Test-Only' -OutputDirectory $taskRoot -Apply
  if ($global:zdjSilentTestSetCalls -ne 1 -or -not $r.waitForChild -or -not $r.propagateExitCode) { throw 'TASK_ACTION_CONTRACT_FAILED' }
  $watch=[Diagnostics.Stopwatch]::StartNew()
  $proc=Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('//B //Nologo "'+$r.launcher+'"') -WindowStyle Hidden -Wait -PassThru
  if ($proc.ExitCode -ne 23) { Get-Content -LiteralPath $r.launcher; if(Test-Path ($proof+'.error')){Get-Content ($proof+'.error')}; throw "CHILD_EXIT_NOT_PROPAGATED:$($proc.ExitCode)" }
  $fact=Get-Content -LiteralPath $proof -Raw | ConvertFrom-Json
  if ($fact.consoleVisible -ne $false -or $fact.workingDirectory -ne $taskRoot) { throw 'CHILD_NOT_HIDDEN_OR_WORKING_DIRECTORY_CHANGED' }
  if ($watch.ElapsedMilliseconds -lt 100) { throw 'LAUNCHER_DID_NOT_WAIT' }
  $rejected=$false
  try { & (Join-Path $PSScriptRoot 'set-zdj-scheduled-task-silent.ps1') -TaskName 'Unrelated-Task' -OutputDirectory $taskRoot | Out-Null } catch { $rejected=$_.Exception.Message -eq 'ONLY_ZDJ_TASKS_ALLOWED' }
  if (-not $rejected) { throw 'UNRELATED_TASK_NOT_REFUSED' }
  Write-Output 'SILENT_TASK_TEST_PASS: no visible child console, quoted paths, working directory, wait and exit=23; no real task or Engine lifecycle'
} finally {
  $resolved=[IO.Path]::GetFullPath($taskRoot)
  if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'zdj-silent-test-*') { throw 'TEST_CLEANUP_OUTSIDE_TEMP_REFUSED' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
