[CmdletBinding()]
param([string]$OutputPath)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$identityPath=Join-Path $projectRoot 'data\runtime\engine-instance.json'
$identity=if(Test-Path -LiteralPath $identityPath){Get-Content -LiteralPath $identityPath -Raw|ConvertFrom-Json}else{$null}
$all=@(Get-CimInstance Win32_Process)
$interesting=@($all|Where-Object{$_.Name -in @('node.exe','node_repl.exe','npm.exe','npm.cmd','cmd.exe','powershell.exe','pwsh.exe')})
$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)
$runtimeChain=@();if($identity){$cursor=$all|Where-Object ProcessId -eq ([int]$identity.pid)|Select-Object -First 1;while($cursor){$runtimeChain+=[int]$cursor.ProcessId;$next=$all|Where-Object ProcessId -eq ([int]$cursor.ParentProcessId)|Select-Object -First 1;if(-not $next){break};$cursor=$next}}
$rows=foreach($process in $interesting){
  $parent=$all|Where-Object ProcessId -eq $process.ParentProcessId|Select-Object -First 1
  $ports=@($listeners|Where-Object OwningProcess -eq $process.ProcessId|ForEach-Object LocalPort)
  $isEngine=$identity -and [int]$identity.pid -eq [int]$process.ProcessId -and $process.Name -eq 'node.exe' -and $process.CommandLine -match 'dist[\/]main\.js'
  $isRuntimeChain=[int]$process.ProcessId -in $runtimeChain
  $isZdjChild=$process.CommandLine -match [regex]::Escape($projectRoot) -or $process.CommandLine -match '@zdj/engine|dist[\/]main\.js'
  $isCodex=$process.ExecutablePath -match 'OpenAI\\Codex|codex-runtimes|cua_node' -or $parent.Name -eq 'codex.exe'
  $classification=if($isEngine -or $isRuntimeChain){'ZDJ_RUNTIME_REQUIRED'}elseif($isZdjChild){if($parent){'ZDJ_TRANSIENT_CHILD'}else{'ZDJ_ORPHANED_CHILD'}}elseif($isCodex){'EXTERNAL_TOOL_PROCESS'}else{'UNKNOWN_DO_NOT_KILL'}
  $owner=Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction SilentlyContinue
  [pscustomobject]@{pid=$process.ProcessId;ppid=$process.ParentProcessId;name=$process.Name;executablePath=$process.ExecutablePath;commandLine=$process.CommandLine;startTime=$process.CreationDate;owner=if($owner){"$($owner.Domain)\$($owner.User)"}else{$null};parent=if($parent){[pscustomobject]@{pid=$parent.ProcessId;name=$parent.Name;executablePath=$parent.ExecutablePath;commandLine=$parent.CommandLine}}else{$null};listeningPorts=$ports;classification=$classification}
}
$report=[pscustomobject]@{generatedAt=(Get-Date).ToString('o');projectRoot=$projectRoot;runtimeIdentity=$identity;summary=[pscustomobject]@{processes=$rows.Count;zdjRuntime=@($rows|Where-Object classification -eq 'ZDJ_RUNTIME_REQUIRED').Count;zdjTransient=@($rows|Where-Object classification -eq 'ZDJ_TRANSIENT_CHILD').Count;zdjOrphan=@($rows|Where-Object classification -eq 'ZDJ_ORPHANED_CHILD').Count;external=@($rows|Where-Object classification -eq 'EXTERNAL_TOOL_PROCESS').Count;unknown=@($rows|Where-Object classification -eq 'UNKNOWN_DO_NOT_KILL').Count};processes=$rows}
$json=$report|ConvertTo-Json -Depth 8
if($OutputPath){$resolved=[IO.Path]::GetFullPath($OutputPath);[IO.File]::WriteAllText($resolved,$json,[Text.UTF8Encoding]::new($false))}
$json
