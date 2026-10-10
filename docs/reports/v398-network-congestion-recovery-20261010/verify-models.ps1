[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Out)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-environment-reader.ps1')
$results=@()
foreach($name in @('qwen35-b580-vulkan','harness-qwen38-vulkan1','zdj-qwen38')){
 $state=Get-Content -LiteralPath ("D:/llama-vulkan/runtime/$name/state.json") -Raw|ConvertFrom-Json
 $owner=@(Get-NetTCPConnection -LocalPort $state.port -State Listen -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique)
 $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($state.pid)"
 if(-not $process -or $owner.Count -ne 1 -or $owner[0] -ne $state.pid -or $process.Name -ne 'llama-server.exe'){throw 'MODEL_OWNER_IDENTITY_FAILED'}
 $health=Invoke-RestMethod -Uri "http://127.0.0.1:$($state.port)/health" -TimeoutSec 5
 $models=Invoke-RestMethod -Uri "http://127.0.0.1:$($state.port)/v1/models" -TimeoutSec 5
 $environment=[RecoveryProcessEnvReader]::ReadEntryEnvironment($state.pid)
 $visible=($environment -split "`n"|Where-Object {$_ -like 'GGML_VK_VISIBLE_DEVICES=*'}) -replace '^GGML_VK_VISIBLE_DEVICES=',''
 $clock=[Diagnostics.Stopwatch]::StartNew()
 $body=@{model=$state.model;messages=@(@{role='user';content='Reply with exactly OK'});max_tokens=16;temperature=0;chat_template_kwargs=@{enable_thinking=$false}}|ConvertTo-Json -Depth 5
 $inference=Invoke-RestMethod -Uri "http://127.0.0.1:$($state.port)/v1/chat/completions" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
 $clock.Stop()
 $gpuMatches=[string]$visible -eq [string]$state.visibleDevices
 $creationMatches=[Math]::Abs((([DateTimeOffset]$state.startedAt).UtcDateTime-([DateTime]$process.CreationDate).ToUniversalTime()).TotalMilliseconds) -lt 100
 $result=[ordered]@{port=$state.port;pid=$state.pid;createdAt=([DateTime]$process.CreationDate).ToUniversalTime().ToString('o');model=$state.model;context=$state.context;physicalIndex=$state.physicalIndex;gpu=$state.gpu;actualVisibleDevices=$visible;gpuEnvironmentMatches=$gpuMatches;creationMatches=$creationMatches;health=$health.status;modelListed=@($models.data.id) -contains $state.model;inferenceMs=$clock.ElapsedMilliseconds;completion=$inference.choices[0].message.content;completionTokens=$inference.usage.completion_tokens;restartAttempts=0}
 $results+=$result
 if(-not $gpuMatches -or -not $creationMatches -or $result.health -ne 'ok' -or -not $result.modelListed -or [string]$result.completion -notmatch 'OK'){throw 'MODEL_RUNTIME_VERIFICATION_FAILED'}
}
[IO.File]::WriteAllText($Out,(@{observedAt=[DateTime]::UtcNow.ToString('o');models=$results;healthyModelsRestarted=$false}|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$results|Select-Object port,pid,model,physicalIndex,gpuEnvironmentMatches,creationMatches,inferenceMs
