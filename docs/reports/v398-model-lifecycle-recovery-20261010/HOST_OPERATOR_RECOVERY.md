# 本机操作：按原始启动器逐个恢复模型

本文件是 **主机操作者在自己的 PowerShell 7 终端执行的步骤**，不是 Codex 已执行的收据。2026-10-10 的新授权启动请求仍在执行前被平台拒绝，只有 `blocked by policy` 原文，没有更详细拒绝理由。当前 Codex 终端不能申请交互升级；不要由 Codex 换包装器、改名或换通道执行以下动作。用户已明确允许具有主机权限的操作者使用原有经审查的运维命令。

先只恢复模型，不停止 Engine，不取消/修改 TP，不补仓，不改 Settings、出口代理或 Primary 授权。原启动器自带 GPU allocator、冷加载显存/主机 commit 门槛、启动健康及真实 inference smoke；保留这些保护，不加 `SkipSmokeTest`，不启用自动 watchdog。

## 1. 在本机 PowerShell 7 准备日志和只读检查

如果目前打开的是Windows PowerShell5，可先在本机终端执行以下已存在的PowerShell7程序，进入交互会话：

```powershell
& 'C:/Users/5700x/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe' -NoProfile
```

逐段执行；任何 throw/超时/非零退出立即停在当前段，不自动重试，不强杀进程。请保留 stdout、stderr 和 smoke 结果，只上传日志文件，勿粘贴长控制台输出或凭证。

```powershell
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'POWERSHELL_7_REQUIRED' }
$ps7 = (Get-Process -Id $PID).Path
$logRoot = 'D:/MITS-OPERATIONS/immediate-model-recovery-20261010/operator-' + (Get-Date -Format yyyyMMdd-HHmmss)
New-Item -ItemType Directory -Path $logRoot | Out-Null
Start-Transcript -Path "$logRoot/operator-session.log"
$manifest = Get-Content D:/MITS-OPERATIONS/immediate-model-recovery-20261010/model-manifest.json -Raw | ConvertFrom-Json
if ((Get-FileHash D:/llama-vulkan/llama-server.exe).Hash -ne '5ED8B8FC6316EB051FC793B59F54C57B0CD2B40E344327E969C5A9C70C7384BA') { throw 'LLAMA_BINARY_CHANGED' }
& D:/llama-vulkan/llama-server.exe --list-devices *>&1 | Tee-Object -FilePath "$logRoot/gpu-devices.log"
if ($LASTEXITCODE -ne 0) { throw 'GPU_ENUMERATION_FAILED' }
$close = Invoke-RestMethod http://127.0.0.1:8080/api/v3/diagnostics/closeout -TimeoutSec 12
$bound = $close.productionWriteBoundary
if ($bound.environment -ne 'TESTNET' -or $bound.executionMode -ne 'TESTNET_ENABLED' -or !$bound.lockedToTestnet -or $bound.productionWrites -ne 0) { throw 'TESTNET_PRODUCTION_BOUNDARY_FAILED' }
$close | ConvertTo-Json -Depth 30 | Set-Content "$logRoot/closeout-before.private.json"
```

## 2. Scout 8081（先执行并等待完成）

```powershell
$m = $manifest.models | Where-Object id -eq 'scout-b580'
if (@($m).Count -ne 1 -or $m.port -ne 8081 -or (Get-FileHash -LiteralPath $m.launcher).Hash -ne 'D0B9F5F4D05ED4DE3AFFA41DBBE7A182993CFB2A0A5133D4C69DC6AA012EC45E') { throw 'SCOUT_BINDING_CHANGED' }
if (Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue) { throw 'SCOUT_ALREADY_LISTENING_INSPECT_DO_NOT_RESTART' }
$r = Invoke-RestMethod http://127.0.0.1:8080/api/v3/brain/resources -TimeoutSec 12
$resource = @($r | Where-Object id -eq $m.id)
if ($resource.Count -ne 1 -or $resource[0].baseUrl -ne 'http://127.0.0.1:8081/v1' -or $resource[0].model -ne 'qwen3.5:9b' -or $resource[0].active -ne 0 -or $resource[0].queueDepth -ne 0) { throw 'SCOUT_BINDING_OR_IDLE_CHECK_FAILED' }
$p = Start-Process -FilePath $ps7 -ArgumentList @('-NoProfile','-File','D:/MITS-WORKTREES/llama-memory-20261009/scripts/llama-vulkan/start-qwen3.5-9b-vulkan.ps1','-Mode','Start','-NoWatchdog') -WindowStyle Hidden -RedirectStandardOutput "$logRoot/scout.stdout.log" -RedirectStandardError "$logRoot/scout.stderr.log" -PassThru
$handle = $p.Handle
if (!$p.WaitForExit(300000)) { throw 'SCOUT_LAUNCH_TIMEOUT_INSPECT_DO_NOT_KILL_OR_RETRY' }
if ($p.ExitCode -ne 0) { throw "SCOUT_LAUNCH_FAILED_$($p.ExitCode)" }
Invoke-RestMethod http://127.0.0.1:8081/health -TimeoutSec 8 | ConvertTo-Json | Set-Content "$logRoot/scout-health.json"
Get-Content "$logRoot/scout.stdout.log" -Tail 30
```

原启动器实际提交 smoke：Scout检查completion choice；Review提交两次Responses请求但丢弃响应体；Primary检查真实返回的SKIP_THIS_CYCLE JSON。它们不是三份完整响应收据。保留server.stderr/启动退出码，并在后续Engine自然任务投影中核验新启动时间后的完成与失败记录；缺少内容或自然任务则该项UNKNOWN，不能只凭`/health=ok`称全部推理恢复。不要额外对正在被旧Engine调用的模型发未取得容量租约的测试请求。若启动器失败但进程仍存在，保留现场，勿补一次启动或关掉Engine。

## 3. Review 8083（Scout 成功后执行）

```powershell
$m = $manifest.models | Where-Object id -eq 'review-7900-gpu2'
if (@($m).Count -ne 1 -or $m.port -ne 8083 -or (Get-FileHash -LiteralPath $m.launcher).Hash -ne 'E1E7C83663DB5CEFC8A6D2CE5CD0D41D9F9177A13C6C2592DA7DBAB35DA6BC48') { throw 'REVIEW_BINDING_CHANGED' }
if (Get-NetTCPConnection -LocalPort 8083 -State Listen -ErrorAction SilentlyContinue) { throw 'REVIEW_ALREADY_LISTENING_INSPECT_DO_NOT_RESTART' }
$r = Invoke-RestMethod http://127.0.0.1:8080/api/v3/brain/resources -TimeoutSec 12
$resource = @($r | Where-Object id -eq $m.id)
if ($resource.Count -ne 1 -or $resource[0].baseUrl -ne 'http://127.0.0.1:8083/v1' -or $resource[0].model -ne 'qwen/qwen3.8-27b' -or $resource[0].active -ne 0 -or $resource[0].queueDepth -ne 0) { throw 'REVIEW_BINDING_OR_IDLE_CHECK_FAILED' }
$p = Start-Process -FilePath $ps7 -ArgumentList @('-NoProfile','-File','D:/MITS-WORKTREES/llama-memory-20261009/scripts/llama-vulkan/start-qwen3.8-27b-harness-vulkan1.ps1','-Mode','Start','-NoWatchdog') -WindowStyle Hidden -RedirectStandardOutput "$logRoot/review.stdout.log" -RedirectStandardError "$logRoot/review.stderr.log" -PassThru
$handle = $p.Handle
if (!$p.WaitForExit(300000)) { throw 'REVIEW_LAUNCH_TIMEOUT_INSPECT_DO_NOT_KILL_OR_RETRY' }
if ($p.ExitCode -ne 0) { throw "REVIEW_LAUNCH_FAILED_$($p.ExitCode)" }
Invoke-RestMethod http://127.0.0.1:8083/health -TimeoutSec 8 | ConvertTo-Json | Set-Content "$logRoot/review-health.json"
Get-Content "$logRoot/review.stdout.log" -Tail 30
```

## 4. Primary 8084（前两者成功后执行）

Primary 的 queueDepth 是候选 backlog；不能将它等同已在途推理，也不能删除 backlog 来让检查通过。这里只要求其 active=0，保留候选与唯一 Entry 权限。

```powershell
$m = $manifest.models | Where-Object id -eq 'brain-7900-primary'
if (@($m).Count -ne 1 -or $m.port -ne 8084 -or (Get-FileHash -LiteralPath $m.launcher).Hash -ne '8AF565EDF29AEC5EC70674FC0894FA352AFCC0F89187B583EFDB74806E536C8E') { throw 'PRIMARY_BINDING_CHANGED' }
if (Get-NetTCPConnection -LocalPort 8084 -State Listen -ErrorAction SilentlyContinue) { throw 'PRIMARY_ALREADY_LISTENING_INSPECT_DO_NOT_RESTART' }
$r = Invoke-RestMethod http://127.0.0.1:8080/api/v3/brain/resources -TimeoutSec 12
$resource = @($r | Where-Object id -eq $m.id)
if ($resource.Count -ne 1 -or $resource[0].baseUrl -ne 'http://127.0.0.1:8084/v1' -or $resource[0].model -ne 'qwen/qwen3.8-27b' -or $resource[0].active -ne 0) { throw 'PRIMARY_BINDING_OR_INFERENCE_CHECK_FAILED' }
$p = Start-Process -FilePath $ps7 -ArgumentList @('-NoProfile','-File','D:/MITS-WORKTREES/llama-memory-20261009/scripts/llama-vulkan/start-qwen3.8-27b-zdj-vulkan1.ps1','-Mode','Start','-NoWatchdog') -WindowStyle Hidden -RedirectStandardOutput "$logRoot/primary.stdout.log" -RedirectStandardError "$logRoot/primary.stderr.log" -PassThru
$handle = $p.Handle
if (!$p.WaitForExit(300000)) { throw 'PRIMARY_LAUNCH_TIMEOUT_INSPECT_DO_NOT_KILL_OR_RETRY' }
if ($p.ExitCode -ne 0) { throw "PRIMARY_LAUNCH_FAILED_$($p.ExitCode)" }
Invoke-RestMethod http://127.0.0.1:8084/health -TimeoutSec 8 | ConvertTo-Json | Set-Content "$logRoot/primary-health.json"
Get-Content "$logRoot/primary.stdout.log" -Tail 30
```

## 5. 留存 PID、真实 GPU/PCI/显存与保护回读

以下只读收集器复制到私有目录运行，避免原脚本旁生成输出污染已封存源树。它们不产生模型任务、不改变 GPU 或交易状态。缺失指标保留 UNKNOWN。

```powershell
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 8080,8081,8083,8084,20091)
$listeners | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json | Set-Content "$logRoot/listeners.json"
Get-CimInstance Win32_Process | Where-Object ProcessId -in $listeners.OwningProcess | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json | Set-Content "$logRoot/processes.private.json"
Copy-Item D:/MITS-RELEASES/ZDJMITS-v398-models-4c84631/scripts/performance/map-gpu-luid.ps1 "$logRoot/map-gpu-luid.ps1"
& $ps7 -NoProfile -File "$logRoot/map-gpu-luid.ps1" *>&1 | Tee-Object -FilePath "$logRoot/gpu-mapping.log"
Copy-Item D:/MITS-RELEASES/ZDJMITS-v398-models-4c84631/scripts/performance/collect-windows-gpu.ps1 "$logRoot/collect-windows-gpu.ps1"
& $ps7 -NoProfile -File "$logRoot/collect-windows-gpu.ps1" -Samples 3 -IntervalSeconds 15 *>&1 | Tee-Object -FilePath "$logRoot/gpu-sampling.log"
foreach ($model in $manifest.models) {
  Copy-Item -LiteralPath $model.stateFile -Destination "$logRoot/$($model.id)-state.private.json"
  $lastLog = Get-ChildItem -LiteralPath $model.logRoot -Filter '*.err.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($lastLog) { Copy-Item -LiteralPath $lastLog.FullName -Destination "$logRoot/$($model.id)-server.private.err.log" }
}
Invoke-RestMethod http://127.0.0.1:8080/api/v3/brain/resources -TimeoutSec 12 | ConvertTo-Json -Depth 12 | Set-Content "$logRoot/engine-models.json"
Invoke-RestMethod http://127.0.0.1:8080/api/v3/diagnostics/closeout -TimeoutSec 12 | ConvertTo-Json -Depth 30 | Set-Content "$logRoot/closeout-after.private.json"
Stop-Transcript
Write-Output "完整操作日志：$logRoot/operator-session.log；三个模型 stdout/stderr 保存在同一目录。"
```

三模型进程、alias、state.starttime、GPU 实测以及 smoke 结果全部回读后才可宣布恢复。本机原始日志留私有目录；公开 GitHub 前须脱敏。无需停止刚恢复的活跃 27B 来演示按钮。

## Engine 部署当前仍不得直接执行

已准备：独立发布目录 `D:/MITS-RELEASES/ZDJMITS-v398-models-4c84631`、1999 文件封存、Settings253 匹配、一致性 DB 备份、当前 Engine 回滚身份、ACL 限制的高强度模型操作 token 和 **未激活**的新版本精确授权。

未完成：模型恢复回读、动作时全部新鲜 signed TP/私有≤30s/canTrade/Production0、当前实例/PID/创建时间再绑定，以及可证明 graceful 的旧 Engine 停止路径。现有 `D:/MITS/scripts/stop-zdj-lan.ps1` 使用 `Stop-Process -Force`；不得声称它执行 graceful shutdown，也不得为完成部署强制调用它。旧 Engine 未具备新模型管理 API。

本轮没有给出裸 Stop-Process/taskkill 或直接 Engine start 命令。新版本启动前应以新鲜门禁核验并仅激活此次封存版本的授权；正式 host 启动必须保留旧数据目录、当前 Settings 和原代理，同时设置：

```text
ZDJ_MODEL_MANIFEST=D:/MITS-OPERATIONS/immediate-model-recovery-20261010/model-manifest.json
ZDJ_MODEL_OPERATIONS_DIR=D:/MITS-OPERATIONS/immediate-model-recovery-20261010
ZDJ_MODEL_OPERATION_TOKEN=<从 model-operation-token.private.txt 本机读取，禁止粘贴到聊天/日志>
PATH=<已核实 pwsh.exe 所在目录;继承原 PATH，仅用于此子进程>
```

不得复用以前已消费的 `controlled-switch.ps1`，不得将旧版本批准转给新 artifact。成功正式启动后需要 6/6 实例闭环、全仓签名 TP、Production0、私有同步、实际模型推理和 UI/API 回读。新 24h 始终 `NOT_STARTED / T0=null`，等待用户后续指令。
