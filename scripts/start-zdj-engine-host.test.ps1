$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$hostScript=Join-Path $PSScriptRoot 'start-zdj-engine-host.ps1'
$launcherScript=Join-Path $PSScriptRoot 'start-zdj-lan.ps1'
$tokens=$null;$errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($hostScript,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ('HOST_SCRIPT_PARSE_FAILED: '+(($errors|ForEach-Object Message)-join '; '))}
$tokens=$null;$errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($launcherScript,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ('LAUNCHER_SCRIPT_PARSE_FAILED: '+(($errors|ForEach-Object Message)-join '; '))}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('zdj-host-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force|Out-Null
try{
  $fake=Join-Path $temp 'fake-engine.js';[IO.File]::WriteAllText($fake,'setTimeout(()=>process.exit(23),25);',[Text.UTF8Encoding]::new($false))
  $stdout=Join-Path $temp 'stdout.log';$stderr=Join-Path $temp 'stderr.log';$life=Join-Path $temp 'lifecycle.jsonl';$receipt=Join-Path $temp 'receipt.json';$launchId=[guid]::NewGuid().ToString('N')
  $shell=(Get-Process -Id $PID).Path;$node=(Get-Command node.exe -ErrorAction Stop).Source
  $q={param($v) '"'+[string]$v+'"'}
  $args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(& $q $hostScript),'-NodePath',(& $q $node),'-EnginePath',(& $q $fake),'-WorkingDirectory',(& $q $root),'-StdoutPath',(& $q $stdout),'-StderrPath',(& $q $stderr),'-LifecyclePath',(& $q $life),'-ReceiptPath',(& $q $receipt),'-LaunchId',$launchId)
  $p=Start-Process -FilePath $shell -ArgumentList $args -PassThru -Wait
  if($p.ExitCode -ne 0){throw "HOST_TEST_PROCESS_FAILED:$($p.ExitCode)"}
  $r=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
  if($r.launchId -ne $launchId -or [int]$r.pid -le 0){throw 'HOST_RECEIPT_INVALID'}
  $rows=@(Get-Content -LiteralPath $life|ForEach-Object {$_|ConvertFrom-Json})
  $exit=@($rows|Where-Object event -eq 'CHILD_EXITED')[-1]
  if(-not $exit -or [int]$exit.payload.pid -ne [int]$r.pid -or [int]$exit.payload.exitCode -ne 23){throw 'CHILD_EXIT_EVIDENCE_INVALID'}
  Write-Output 'start-zdj-engine-host.test.ps1 PASS'
}finally{Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue}
