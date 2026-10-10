# V3.9.8 网络拥堵优化：Engine 停机对照、分层修复、受控重启与稳定运行计划
更新锚点：2026-10-10 北京时间约 22:00；GitHub main 基线 `ef00780c9b02c1db762ddca2705a836555abbd59`。本文件是最新网络专项计划；历史网络计划中的“当前运行 PID/24h 仍在进行/不得发布”是其当时现场记录，须以本计划与实时只读采样替换。任何 GitHub 更新都不自动证明 Windows 已部署。

## A. 已完成的真实实验（PROVEN / INFERENCE 分离）

1. Engine 运行时：Windows `ssh.exe` 经 `socks5h://127.0.0.1:20091` → Ubuntu `43.156.0.24:22091` → `demo-fapi.binance.com`。用户公共/time诊断 `0/8` PASS，每次 SOCKS/CONNECT 类超时约8s，远端 SSH 发往 Windows 的 Send-Q 长期约2.7MB、notsent约2.72MB、RTT约380–420ms、拥塞窗口曾由13降至8。Windows TCP+SOCKS greeting 单独28/29ms可成功，不能把 ssh 进程存在当成 Binance 通路正常。
2. 21:17 受控代理 `-Restart` 一次，旧18988→新 PID12212；新PID首次 Binance public time通过约4.98s；同PID约69秒后 `-Status` 在 SOCKS_CONNECT_REPLY 8.055s超时。说明重启仅是短暂缓解，不能当根治。
3. Engine 在线 WS 解码量实际60s：PUBLIC 0.586MiB/1875条（DEPTH349.3KiB、BOOK_TICKER250.5KiB），MARKET 3.974MiB/1543条（全市场 TICKER_24H 1861.1KiB、全市场 MARK_PRICE1829.9KiB、KLINE306.6KiB、AGG_TRADE72.1KiB）。两个全市场数组合计约81%所有已解码 WS 应用数据。**不等于真实 SSH/TCP wire bytes，不能按0.64Mbps直接证明下行容量。**
4. Engine 已停实验：隔离前后 8080 无 LISTEN、无 ZDJ Engine node，原代理同 PID12212/创建时间不变；`socks5h` Binance Demo public time `4/4` HTTP200，耗时 `5.754536, 2.446706, 2.229529, 3.317008` 秒。Ubuntu 12次/10s采样同 SSH session `Send-Q 11/12次0`，仅一次4496B、notsent232B并在下个样本清空。RTT约420–570ms，仍见较小cwnd及累计重传；app_limited时期 delivery_rate不是带宽实测容量。
5. **证实**：Engine OFF 与 SSH积压消失/公开接口恢复高度相关，且代理无需重启。**未证实**：单独某一种WS就是唯一原因、该网络长期稳定、私有REST/所有TP已恢复、HTTP451已消失。另一混杂因素为网络质量变化。
6. 用户先前尝试 `graceful-console-stop` helper 两次均 exit1；当时不能从 helper 结果证明停机；**随后隔离前后进程/监听证明 Engine 实际已离线**。停机发起者/退出来由不可凭猜测补齐。下一阶段不得再次按PID13476实施停止动作。

## B. GitHub 当前工作与未合并项（每次开工刷新）

- `main` 观察基线 `ef00780c`。原线上 e3dc48b 对应发布目录 `D:\MITS-RELEASES\ZDJMITS-v398-cockpit-e3dc48b`、Engine当时PID13476、build `3.9.8-a790207862ad258b41a0`，现在用户隔离实验已证明Engine已停。不要将这个旧PID当作当前运行。
- PR #41 `https://github.com/3684993/ZDJMITS/pull/41`，`codex/v398-proxy-lifecycle-20261010`，HEAD `f1f5d9c7863d6be3f6aef1a451a4cb90a556ea1d`；精确HEAD Actions `38055343428` 和 `38055340946` 均 SUCCESS。负责代理配置/连接验证/启动与重启界面、身份校验。**尚未合并/部署**；CI绿不等于稳定传输。
- PR #42 `https://github.com/3684993/ZDJMITS/pull/42`，`chatgpt/v398-ws-retained-stream-congestion-p0-20261010`，HEAD `c9cd14c572851dda581cc84d66a3ddbfd4d0ed9d`，草稿；首次 CI `38057726621` 最后检查仍进行，**必须回读精确最新HEAD及结果**。它以保留标的的单币种 `symbol@ticker` 和 `symbol@markPrice@1s` 替代MARKET两个全市场数组（常规<=160），中等规模回退单个全市场mark，更大规模回退原数组，并加测试；没有修改PUBLIC全市场bookTicker。检查>239个标的时原有MARKET单连接1024 streams边界，不能为保覆盖而静默超限。实际减负量只可通过后续同负载窗口测量，禁止宣称已达到。
- PR #37早期界面草稿长期滞后，不应盲目合并。原 `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`、`docs/project-memory.md`、`docs/plans/V398_BINANCE_NETWORK_COMMUNICATION_AUDIT_AND_OPTIMIZATION_20261010.md` 用作历史知识，时间优先级低于本次隔离证据。Windows / Ubuntu 测试日志只保留脱敏摘要/哈希，完整原始隐私日志不得上传。

## C. 总体目标和本次执行授权

操作者本次明确授权 Codex 为修复网络拥堵执行**必要的实际维护、版本合并、测试网发布、组件的受控停止/启动/重启和复测**，但仅限该项目、同一受控 TESTNET 网络与经核验的进程。不要停留在设计文档，不要用“已合并”冒充“已重启上线”。不要求每个组件不加区分全部重启——没有相关故障的三 Qwen 健康进程无需重启；如果需要重启任一服务，应明确原因、依赖关系、回滚/失败停止机制，记录PID/creation/start/health前后证据。正常业务目标是能够持续处理必要的私有同步、风险和已有TP及安全的Primary分析，而不是强行制造新订单。

完成标准：在 **实际 Engine 正常业务负载** 下稳定运行并具备可核验的私有账户/仓位、合法用户TP保护、消息新鲜度和低拥堵指标；若受实际网络/权限/账户限制而无法安全达到，继续修复可控的软件层且停止不安全重启/交易操作，清楚报告仍被阻塞的客观条件，不虚报稳定。

## D. 分阶段 Codex 动作（实际可执行，不是纸面审计）

### P0 安全恢复前核验与离线修复
1. `git fetch` 后确认main、PR41/42、exact-head CI、发布包及`D:\MITS`脏工作树；独立 worktree修改，不`reset --hard`/`clean -fd`/覆盖真实Settings/运行SQLite。识别2026-10-10 21:46-48 Engine-OFF隔离事实是否仍成立，仅有限本地进程/SSH只读采样，不再进行8轮密集探测。
2. **优先评审和完善 PR #42**：检查Binance USD-M官方单symbol`@ticker`、`@markPrice@1s`语义、推送事件字段、订阅ACK实际回包、两个lane独立上限1024、客户端入站控制消息速率、断线补订、缩减/扩容时冷启动、持仓/挂单必需标的保护。确认`onMessage`识别单对象与数组且`quote.ts`所有关键字段有自身真实新鲜度。不得把“已请求订阅”当成“交易所已确认订阅”。
3. 原有 BinancePublicMarketDataProvider.discoveryTicker 通过REST `/fapi/v1/ticker/24hr`单飞+60s缓存维持市场发现和流动性筛选，优化WS不能偷偷让每个symbol增加REST发现调用/洪泛修复。必要时修复采集预算和full vs mini ticker字段差异。PUBLIC全市场`!bookTicker`在第二阶段按持仓、候选、资金路由保留集合逐步评审，不能让持仓、pending、BTC/ETH基准丢关键报价。
4. 先运行focus tests、PowerShell检查、`npm ci`、`npm run verify:ci`、S00/githash与远端exact-HEAD CI。PR42无绿灯不能合并。PR41虽CI绿，仍需评审定时验证是否会在拥堵时进一步放大并发/守护反复重启，必要时后置或拆分问题；不应把GUI代理灯加入必需写入门禁。

### P1 Windows/Ubuntu端与传输压力分层优化
1. Windows：SSH动态SOCKS监听/进程所有权、私有凭证/known_hosts权限、守护管理、`-Restart`停止guardian后未恢复守护的行为、Engine请求连接池/代理握手deadline、no-direct fallback；本地日志与文件编码须兼容PowerShell 5.1（UTF-8 BOM或ASCII），避免上次脚本因中文乱码ParserError。诊断与生命周期操作分开；API设置保存 != SOCKS TLS联通 != 请求本地队列健康。
2. Ubuntu：`ss -tinp` 对齐相同server SSH fd与 Windows PID 代理连接，采集 60s应用payload和TCP Send-Q/notsent/bytes_acked增量/RTT/retrans；观察`CLOSE-WAIT`、上游RecV-Q、SSH channnels；先以减负证明改善。不要无证据修改ssh配置、`MaxSessions=0`、出口地址/地区、SSH authorized_keys。
3. Engine transport：确认最重要的私有账户/仓位/TP维护和REST execution 的本地 admission/AGENT_QUEUE、SOCKS_NEGOTIATION、TLS、FIRST_BYTE、response、requestWeight记录；避免背景全市场、订单历史、REST K线回补抢占6 socket与关键lane；恢复窗口请求节流/有界指数backoff/single-flight。高负载时新Entry fail-closed，不能自动重试UNKNOWN订单POST或弱化60s私有事实TTL。
4. 若WS减负后仍受同SSH TCP HOL显著影响，允许在隔离端口（如20092）测试同一合规出口的 Hysteria2/QUIC 或 sing-box，证书认证及SSH部署策略需审计，Windows+Ubuntu双向可用且UDP链路真实稳定才可以灰度；不许可直连交易所、轮换地区/出口或自动回退未授权代理。改善代理协议不能代替消除总带宽不足。

### P2 真实部署与**必需的服务重启**
1. 用户本消息已经授权**必要重启**，Codex应亲自完成可用的 Windows 本地操作而非只给命令，但必须核实当前进程状态/已签 TP和运行实例，再决定重启哪些组件。`8080` Engine 当前隔离停机，**若仍停机应执行新版本受控启动而非再调用停止/强杀**。如需要停止现运行Engine，优先SIGINT/隔离Ctrl+C有回执，核验身份/创建时间/端口持有者，不因助手exit1而猜测已停；无法优雅停时禁止静默强杀交易处理程序，须记录BLOCKED并维持现有TP安全态。
2. 首次启动可以先`ANALYSIS_ONLY` / 限制新建仓（遵守已有Entry许可与配置机制），恢复私有数据/保护校验及行情；恢复正常TESTNET Entry前必须获得新鲜签名账户+当前仓位+当前openOrders及openAlgoOrders中的双ID/qty/side/reduceOnly/价格一致性，原未知的TP不由旧缓存升级为通过。只有真实完整保护和业务权限才能启用新建仓，禁止以用户“重启直到稳定”作为绕过签名数据/TP规则的许可证。
3. 使用封存发布包、source/artifact/settings哈希、当前`main`对应exact-head CI、运行日志备份、回滚包和启动审批；校验6/6运行实例身份、Production写入0、Engine :8080、proxy :20091、Binance DEMO REST/WS和模型端口8081/8083/8084。仅当守护/observer/任务确实绑定旧PID/旧路径时，更新并受控重启对应守护；健康Qwen不为证明“全重启”而无故重启。不得启动24小时正式验收，除非另有明确指令。
4. 允许诊断→修补代码/脚本→独立PR→CI→合并→受控重新部署→有限窗口观测的**反复迭代**，但对同一组件每种失败机制的重启尝试须有明确预算和冷却（建议单阶段最多2次、失败退回诊断），绝不无限紧循环、不为压过错误而频繁重启、不断放宽timeout/内存/TTL或交易安全机制。Codex如果无法操作受控主机/远端，明确阻断原因和所需人工步骤，不能声称已执行。

### P3 稳定运行验收（公开健康 != 私有交易系统稳定）
1. 每次部署先测 public Demo `/fapi/v1/time`有界调用（无生产出口），并实时观察同一代理PID与SSH积压；但成功1/1/4/4仅作为瞬时连通，严禁绿灯持续两分钟后仍显示新鲜验证。
2. 至少**30分钟自然运行负载**：本地交易Engine和三模型正常状态；被动遥测显示关键REST无连续超时/无持续关键队列过期；必要私有同步持续在自身TTL内；签名TP实际每仓完整覆盖且订单身份未变；无非法新Entry/补仓/人工单处理；无生产写入。网络参照目标：30分钟至少30个自然/有界连接窗口的公众API成功率不低于99%（观察样本不足标UNKNOWN），public p95<8s、连续关键SOCKS失败为0；server SSH Send-Q不得持续 >1MiB 超过30s，且P95应显著低于原2.7MB基线；market WS 60s decoded-by-type 与留存标的/quote完整度必须同时呈现，不能只削流量导致事实缺失。
3. 再做**90分钟只读自然业务稳定跟踪**（不同于旧90min或24h验收）核验PRIVATE、TP、REST lanes、WS reconnect、quote per-field freshness、Kline连续性、账户容量、延迟p95/p99、error分类和拥塞历史。禁止制造交易/强制Primary做单以增加样本。若出现持续超时或保护UNKNOWN，则不签稳定PASS，返回P0/P1进一步修复。
4. 测试与报告要分别输出 `CODE_FIXED`、`CI_GREEN`、`MERGED_MAIN`、`HOST_DEPLOYED`、`PUBLIC_REST_OK`、`PRIVATE_RECONCILED`、`TP_EXCHANGE_VERIFIED`、`SUSTAINED_STABLE`。达到全部适用门禁才可叫做完成，缺证据则UNKNOWN/NO_GO。

## E. 必须保存的证据/交付
- 本计划关联 `docs/prompts/CHATGPT_V398_NETWORK_CONGESTION_NEXT_CHAT_20261010.md` 和 `docs/prompts/CODEX_V398_NETWORK_CONGESTION_EXECUTE_20261010.md`。新实施报告写 `docs/reports/v398-network-congestion-recovery-20261010/`，复用旧报告、不删除失败记录。
- 每个PR需清楚说明改变的文件/问题基线/新旧WS字节/测试/API时效/运行来源/TP/风险，保留准确完整提交hash和CI地址；合并后核对 `main`、真实新发布目录、Engine PID/启动时间/hostPID/instanceId、8x服务health、签名TP、Production0。
- 更新 `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` 最顶部、`docs/project-memory.md` 以及当前计划；原始账号/私钥、API key、未脱敏交易所订单ID、live数据库绝不上传GitHub。
- 不允许把网络QoS问题按“行情看涨/看跌”解释；NET-001/002、PRIVATE-DATA-001、BINANCE-QUEUE-001各自按真实触发原因修复且保持UNKNOWN fail-closed。
