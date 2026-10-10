# 用户指定 scripts/1 的立即启动请求

2026-10-10 17:17–17:20+08：用户明确指定以下三个本机脚本并再次授权立即启动，不需一般性许可。已只读确认三文件真实存在；8081/8083/8084无监听。按Scout→Review→Primary顺序提交正常本地Scout启动请求。

**真实结果：平台在CreateProcess前拒绝，`blocked by policy`，没有细项。** `D:/MITS/scripts/1/start-qwen3.5-9b-vulkan.ps1`没有执行，没有launcher PID/启动收据；Review、Primary未尝试。没有为绕过该拒绝改名、修改启动器、删除保护、换通道或伪造成功。此为用户新指定源脚本的正常授权请求，不是通过改路径让此前被拒绝的命令偷偷执行。

| 指定脚本 | 实读SHA256 | 固定context |
| --- | --- | --- |
| `D:/MITS/scripts/1/start-qwen3.5-9b-vulkan.ps1` | `E6432A7BF22FAAECF429B39463E7C979BACA2B2D3E8192930D3425E9C0C48523` | 32768 |
| `D:/MITS/scripts/1/start-qwen3.8-27b-harness-vulkan1.ps1` | `0D60F7018D4CF0C76DD031F04A83D8F7070F93AC741B91F5CBA1FE39C4E513A5` | 65536 |
| `D:/MITS/scripts/1/start-qwen3.8-27b-zdj-vulkan1.ps1` | `2AC06791EFDA10575F58A281484E6C3E814632F6D1003F90A3B9BF80496DEB6D` | 65536 |

它们与前面已封存的llama-memory P0启动器不同，不伪称hash一致或32K/16K配置。本轮没有改写新Engine私有manifest、没有修改原脚本或已有封存，尚无这些配置同时加载的实际显存预算证明。用户选择了这些原始脚本；保留脚本内GPU allocator、显存检查和真实smoke，不为了启动删除门槛。`-NoWatchdog`避免本次单次恢复之外的自动重复生命周期。

## 具有主机权限的操作者在本机终端执行

当前Codex终端无交互升级入口。用户已明确允许主机操作者执行原始运维命令。下面不是已运行收据；任何非零退出立即停在当前项，不强杀或自动重试，不停止Engine。

```powershell
$pwsh = 'C:/Users/5700x/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
$logs = 'D:/MITS/logs/model-start-' + (Get-Date -Format yyyyMMdd-HHmmss)
New-Item -ItemType Directory -Path $logs | Out-Null

& $pwsh -NoProfile -File 'D:/MITS/scripts/1/start-qwen3.5-9b-vulkan.ps1' -Mode Start -NoWatchdog *>&1 | Tee-Object "$logs/scout.log"
if ($LASTEXITCODE -ne 0) { throw 'Scout启动失败，停止后续操作' }

& $pwsh -NoProfile -File 'D:/MITS/scripts/1/start-qwen3.8-27b-harness-vulkan1.ps1' -Mode Start -NoWatchdog *>&1 | Tee-Object "$logs/review.log"
if ($LASTEXITCODE -ne 0) { throw 'Review启动失败，停止后续操作' }

& $pwsh -NoProfile -File 'D:/MITS/scripts/1/start-qwen3.8-27b-zdj-vulkan1.ps1' -Mode Start -NoWatchdog *>&1 | Tee-Object "$logs/primary.log"
if ($LASTEXITCODE -ne 0) { throw 'Primary启动失败' }
```

只回传生成的三份log文件，不粘贴长输出或凭证。运行后还需真正回读health、实际推理响应或自然Engine任务证据、新PID/创建时间、GPU-LUID-PCI/显存和交易保护；没有这些证据不得宣称三模型恢复。具体只读收集步骤见 [HOST_OPERATOR_RECOVERY](./HOST_OPERATOR_RECOVERY.md) 第5节；其中旧manifest为P0启动器来源，不能冒充此次scripts/1来源。正式Engine部署仍需动作时全部门禁和graceful停止路径；新24h仍NOT_STARTED/T0=null。
