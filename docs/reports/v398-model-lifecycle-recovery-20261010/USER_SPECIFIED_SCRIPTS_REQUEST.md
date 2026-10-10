## 2026-10-10 17:42 实际部分恢复：Scout/Primary成功，Review未执行

本轮正常工具实际允许Scout/Primary创建启动器；第一次Scout因Windows RemoteSigned和三原脚本ZoneId=3而未加载。已核验三文件Git内容无diff、SHA256一致，仅对用户明确指定的三文件执行Microsoft Unblock-File；标记已私有备份，未修改全局/用户/组策略、脚本内容或TP/交易保护。随后Scout25912/8081/Vulkan0/ctx32768与Primary16772/8084/Vulkan2/ctx65536实际启动，health=ok，原启动器真实smoke完成；Scout还有两次新自然Engine完成，Primary此样本未观察新自然Engine run，勿将startup JSON smoke等同自然Entry。

Review8083原harness脚本启动请求在CreateProcess前被平台blocked by policy拒绝，没有细项，没有启动器/模型PID，不换包装/通道绕过。实际2/3恢复，不宣称全部完成。D3DKMT+WDDM主要显存：Scout PCIbus5约6,357,635,072bytes，Primarybus19约18,526,982,144bytes；跨卡少量分配保留。两模型同时加载commit52,047,556,608/limit178,217,693,184bytes；未加载Review，三模型预算尚UNKNOWN。

当前Engine23936未重启/未部署，17:42本地TP26/26 READY且问题计数0、Production0；这只是本地保护读回，不伪称此次新增签名全仓门禁。旧08:34验收ABORTED、新24h NOT_STARTED/T0=null。原退出发起者/退出码仍UNKNOWN；本轮Windows来源标记只解释新Scout首次启动失败，不解释旧llama退出。运行证据和启动/推理事实日志在actual-partial-recovery-1742.json及actual-*.log。完整本机日志D:/MITS/logs/model-start-20261010-173800。

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
