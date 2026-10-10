# Codex 可执行任务书：v3.9.8 网络拥堵优化 / 修复→合并→受控重启→稳定验收

**这是任务授权与阶段路线，不是已完成回执。** 收到本文件的 Codex 应立即开始实际工作，不再要求操作者粘贴旧聊天。主计划：
`docs/plans/V398_NETWORK_CONGESTION_ENGINE_ISOLATION_RECOVERY_20261010.md`
新 ChatGPT 提示词：
`docs/prompts/CHATGPT_V398_NETWORK_CONGESTION_NEXT_CHAT_20261010.md`
仓库：`3684993/ZDJMITS`

## 0. 原样获取当前计划（Codex Windows terminal）
```powershell
cd D:\MITS
git fetch origin main
git show origin/main:docs/prompts/CODEX_V398_NETWORK_CONGESTION_EXECUTE_20261010.md
git show origin/main:docs/plans/V398_NETWORK_CONGESTION_ENGINE_ISOLATION_RECOVERY_20261010.md
```
如果D:\MITS是dirty的，只在独立worktree写代码；绝不reset/clean/stash现网目录。再读`CURRENT_MAINTENANCE_HANDOFF.md`、`docs/project-memory.md`、GitHub PR #41/#42及精确HEAD Actions。实时运行事实优先于旧交接内的2026-10-10早期PID/“24h运行”描述。切勿把README或CI的“deployment”字样当真实部署。

## 1. 第一项必须交付：最新现场事实与网络业务压力归因
- 用户2026-10-10 21:46–21:48已做受控Engine OFF实验：8080没有listener/node，SSH PID12212不变，Binance Demo public/time 4/4 PASS (5.755s/2.447s/2.230s/3.317s)，12个远端Send-Q采样11个0、一个4496B；ON时0/8且SSH 2.7MB积压。这是**负载影响强相关**而非已证明唯一路由故障。
- 最后一轮运行Engine PID13476、源码e3dc48b、发布目录`D:\MITS-RELEASES\ZDJMITS-v398-cockpit-e3dc48b`，已被用户确认OFFLINE；新任务务必再查，不要向旧PID发送停止或把异常helper exit1解释为“正常退出”。
- 先读取归档`summary.json / results.csv / server-queue.csv / server-ss-raw.txt`的**本机原始文件（如存在）**；如果未挂载可用，基于本计划精确列出的用户回显证据，不要编造路径。非敏感的统计只读导出。
- 关键市场量 60s MARKET3.974MiB，PUBLIC0.586MiB；全市场ticker 1861.1KiB、mark 1829.9KiB占总量约81%；观察的是解码WS业务payload，不能冒充SSH wire字节。
- 复核账户/仓位/TP与私有事实：此刻最新签名状态UNKNOWN。公共GET成功不能证明私有可用，运行前对齐账号、TESTNET、订单身份与保护。

## 2. 执行顺序与可修改范围：不要只出报告
1. 拉取并code review **PR #42** `chatgpt/v398-ws-retained-stream-congestion-p0-20261010` (初始HEAD `c9cd14c572851dda581cc84d66a3ddbfd4d0ed9d`)。先看本HEAD CI，失败则查看workflow job logs并最小修复，继续跑完整CI；审查每symbol的ticker/mark、1024 lane上限/额外160+的fallback、订阅LIST/ACK、自恢复、MarketDataProvider发现REST、字段TTLs、持仓及挂单symbol保留。改正源程序和回归测试而非偷掉测试；CI绿、满足全部约束后完成Review/merge PR42入`main`。这一步切实减少上游推送内容，不能只在Windows收包后丢弃。
2. PR #41 `codex/v398-proxy-lifecycle-20261010` HEAD `f1f5d9c`：两项exact-head CI已成功。独立审查代理GUI与周期验证是否在带宽受限时反而触发额外请求、auto-watch是否无限restart，以及 `-Restart` 对guardian的影响。如果其本地身份、token、审计和超时安全成立就完成review/merge，否则补最小修复后CI再merge。保持UI“保存配置”/“本地SOCKS好”/“真实TLS连通”/“排队正常”事实分离。
3. 若削减MARKET仍不够，继续审查`BinanceMarketStream.desired('PUBLIC')`的`!bookTicker`全市场推送，改为保留symbols的`@bookTicker`并验证quote bid/ask freshness；辅助`aggTrade`/K线/深度按业务证明缩减；避免过度过滤丢掉BTC/ETH基准、持仓TP和现存订单/原始候选发现。每次变更独立commit+focused/full tests；不要牺牲完整性换“0.0MiB”。
4. 排队与代理脚本：`BinanceTransport.ts`、`requestBudget.ts`、PrivateSync/Reconciliation、`scripts/vpn/zdj-trade-proxy-client-windows.ps1`及Ubuntu脚本只针对可复现阶段诊断逐项修改，保留Socks代理强制、HTTP451含义、背景REST退让、真实request weight、幂等双ID与fail-closed。严禁只延长15s超时/放宽私有TTL，严禁POST未知结果直接重下单。检查PowerShell 5.1中文脚本编码错误、隔离Ctrl+C helper exit1的真实异常/输出/退出码，不要在无法验证时强杀。
5. GitHub每阶段真实建小PR/修改现有PR，运行`npm ci`、`npm run verify:ci`、S00+全部测试、exact-head CI并根据代码审查合并。不要盲目合并滞后PR #37或部署不绿代码。维护交接、issue注释、真实脱敏报告。

## 3. 必须执行的本机上线和必要重启（用户现已授权）
- 不是建议性步骤：通过所有安全门禁时，Codex**要实际打包/发布到Windows主机，启动离线Engine（若仍已停），并重启确实需要重新加载配置/修复的组件**，校验交易所REST/WS、后台守护/observer及UI。需要修改 Windows 或 Ubuntu 脚本就先备份、回归、原出口A/B，再一次受控应用；不因服务仍旧OFFLINE就宣称任务完毕。
- 启动前先核对现存 TESTNET 仓位与Binance权威openOrders/openAlgoOrders，能独立签名则验证双ID、side、qty、reduceOnly、price和完整性，不能以旧本地TP27/27冒充新鲜。若仅公开接口可读而私有不可读，先启用有明确已验证机制的`ANALYSIS_ONLY`/禁止新Entry方式恢复观测，**绝对不能在PRIVATE/TP UNKNOWN时启用自动新建仓或修改TP**；若安全模式无法证明，不启动有自动交易权限的实例，只处理网络和文档。
- Engine优先受控SIGINT/Ctrl+C，旧 helper exit1先修复原因；无安全可验证退出就STOP/BLOCKED，不强制杀死持有仓位TP控制权的进程；不会重复停止已经离线的PID13476。重启前后保留DB/Settings/source/build/hash和回滚收据；检查正式release 6/6、PRODUCTION 0、private freshness以及Qwen 8081/8083/8084的真实身份。健康模型无需无故重启；需要重启的一律受控而非粗暴群杀。
- 直到持续30分钟正常负载 + 90分钟自然观察窗口符合主计划的独立稳定验收，再写 `SUSTAINED_STABLE=PASS`。有失败先按真实 failurePhase定位→修复→新CI→重启必要组件→重测，不用一轮成功代替长期成功。单组件同故障同阶段最多2次重启尝试/有冷却，安全门禁阻断或平台权限拒绝要如实汇报并保持fail-closed，绝不为无限重启绕开审批/秘钥/交易保护。

## 4. 禁令与交付
- STRICT: Only Binance Futures Demo TESTNET; Production writes 0; Primary 唯一新建仓决策; **禁止补仓/第二独立Entry**; HUMAN_MANAGED优先; 交易所双ID/幂等; 实际TP覆盖; 未知/超时/451不得伪造成READY。不可改真实出口或绕过地区/交易所限制，也不可在SOCKS失效时直连。
- 禁止把Live数据库/私钥/令牌/真实订单ID/原始私有响应上传GitHub，不乱动`D:\MITS` dirty目录，不自动开始旧/新24小时正式验收。不要用新建仓测试网络，不做无谓高频健康probe/重启风暴。
- 每阶段交付 `docs/reports/v398-network-congestion-recovery-20261010/` 的`BASELINE_AND_CAUSALITY.md`、`IMPLEMENTATION_AND_CI.md`、`HOST_CUTOVER_RECEIPT.md`、`STABILITY_30M_AND_90M.md`（若未执行标NOT_DONE）、现网仍未知项和下一次最小步骤。更新当前交接文件最顶部，不复用过期旧状态。
- 如果操作工具不能执行主机重启/修改，先用其正式权限申请通道一次；被拒绝就停止该执行操作，交付**已验证命令、准确脚本路径、操作前后预检、具体不可访问原因**，并继续可做的GitHub离线代码工作。不得假称执行完或反复包装规避。
