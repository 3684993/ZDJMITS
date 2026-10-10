# Codex：v3.9.8 GPU持续采样 + 专业资金收益驾驶舱（2026-10-10 用户最新任务）

## 当前现场已证明，不要重复重启

用户本机 PowerShell7 在隔离目录**真实运行** `collect-windows-gpu.ps1 -Samples 3 -IntervalSeconds 15`，取得：
- Scout 8081 PID 25912 WDDM MEASURED / 6,369,292,288 bytes 专用显存 / 利用率0%（当次采样）
- Review 8083 PID 22880 WDDM MEASURED / 18,562,105,344 bytes / 0%
- Primary 8084 PID 16772 WDDM MEASURED / 18,553,266,176 bytes / 0%
这是OS采样真实可用证明，**不是**GPU长期利用率/吞吐或PID-PCI全链证据。0%只表当次不忙。
用户报告最新正式 Engine PID **12140 READY**，实例身份 **6/6**，签名TP **28/28**，Production写入0；模型状态均READY，系统设置→AI模型管理已上线并实际验证。原模型退出原因未知。
恢复/部署实码在 [PR#39](https://github.com/3684993/ZDJMITS/pull/39) 源码 `2c9fec513bd5ba0406015c33b2c7cf9ce420ebaf`，部署证据 `bbcda235ca1c4c5da07466714e9f015ba5bc6a9b`，其精确源码和证据CI均已 SUCCESS（38043800329、38045079101）。**PR39仍开放Draft、该在线代码尚非GitHub main**。先fetch并与当前在线源码比对，避免使用落后的main覆盖已运行修复。
此前 [PR#37](https://github.com/3684993/ZDJMITS/pull/37) 已由ChatGPT真实编写专业驾驶舱图表和状态灯，但 **尚未合并/部署、当前显示仍是旧页面**，且与main有冲突（`mergeable=false`）；不要指示用户清缓存就声称图表已上线。PR37 `chatgpt/v398-cockpit-professional-finance-status-20261010`，提交 `1bffa5af2740d9f0f97c9ee96d5c5f93e207cfd6`，相关 `CockpitOverviewTop.vue`、`CockpitSignalStrip.vue`、`cockpitStatus.ts`、`financePerformance.ts`、Overview/PerformanceView。它是可复用实现，不是已验收源码；不得盲目直接合并旧PR37到已恢复分支。
用户已明确要求本次改造并交由Codex完成；**不授权重启健康模型，也不自动启动新24小时验收**。必须保持当前 Engine 的TP保护和自然交易。

## P0 — 把 GPU 采样器变为一个正式由系统管理的只读sidecar

1. 先列出唯一在线 Engine 12140 的 `process.cwd()`、代码根、实际 `apps/engine/dist`、`scripts`、读侧真实文件路径和已存在的采样进程/定时任务；核实并修复以下源码路径错位：
   - `scripts/performance/collect-windows-gpu.ps1`：当前脚本用 `$PSScriptRoot/gpu-snapshot.json` 和 `gpu-baseline.json` 输出，且改变自身脚本目录ACL；原 `D:\MITS\scripts\performance\` 用户机不存在。
   - `apps/engine/src/services/gpuPerformanceReader.ts`：默认 `path.resolve('scripts/performance/gpu-snapshot.json')` 相对正式 Engine工作目录，可能读错。
   - 新 stage `D:\MITS-RELEASES\ZDJMITS-v398-models-4c84631` 是历史封存参考；实际在线源码以后续 PR39 真实发布路径为准。
2. 采用**受限运维目录**作为唯一绝对快照地址（由主机配置如 `ZDJ_GPU_SNAPSHOT_PATH`，脚本显式 `-OutputDirectory`），不在仓库/构建源文件夹中写动态数据、改ACL或污染S00；OS采样进程写原子 JSON（校验 schema/实例asOf/输出长度，防半写）；Engine 仅读这个固定文件、最多每10s读取、45s后 STALE、不读取错误值充作0。对旧未配置地址fail-closed，报告清楚的实际路径。
3. 将默认每15s、最多241点且到期退出的**有界采样逻辑**升级为可由受限Windows任务/守护进程持续续采的单实例机制。优先独立sidecar而非挤占 Engine tick。唯一所有权、PID+创建时刻、互斥锁/任务名/可执行文件指纹；允许明确运维启停、可观察的崩溃重启预算与指数退避，禁止重复实例和热循环；系统重启后自动恢复。运维按钮如需加入系统设置，走固定已审查的后端动作与token权限；不能由浏览器提交任意脚本路径。现网正常时幂等返回，不为演示停止模型/Engine。
4. 只读采集 WDDM GPU 利用率（明确**PID最忙engine**，不是整卡平均）、Dedicated/Shared显存、PID+process creation+LUID+PCI映射强度；端口8081/8083/8084状态，限制Get-Counter对象并发、poll成本与缓存；对CPU负担、权限拒绝、重启、进程PID重用、port调换、WDDM>100原值严格表示异常UNKNOWN。可选采集代理/网络只有可信现成指标，不接私有凭证。
5. 验证单次3点与持续周期20分钟以上真实采样，展示首尾asOf、间隔/p95与脚本CPU、latest snapshot与Engine GET `/api/v3/observability/performance/gpu` 的 **MEASURED一致性**及UI刷新、超期STale演示；本地采样首次成功已由用户给证据，不需要再要求用户人工启动121/241点。若平台CreateProcess前 `blocked by policy`，它是执行工具外部审批拒绝，不是采样脚本失败；继续实施代码/测试，并提供正常授权的主机执行途径，不包装绕过平台限制。

## P1 — 正式合并PR37的驾驶舱图表，并对现场财务事实进一步升级

### 最重要的上线原因

- `main` 的 `OverviewView.vue` 仍以资产表和文字为核心，PR37的 `CockpitOverviewTop.vue` 未合并，上线程序没有图表。
- **以最新已部署 PR39 精确源码为integration基线**建隔离worktree，在新功能分支选择性移植PR37经过复核的Vue组件/状态栏、accountRead接入及相关测试，解决与PR38/PR39冲突；要真实编译、可视化浏览器测试并部署，不是交一份PPT或重写相同设计。
- PR37旧组件存在`<PerformanceTrend v-if=...有效采样点>1`：页面新开且无历史时没有图表。新首屏必须立刻显示有事实依据的 **ECharts资金结构/分段阈值横向资金条、PnL瀑布/正负柱状结构图**（单点可显示），折线保留仅真实历史，缺2点显示明确空态和首点asOf，不画虚假线。

### 页面结构（专业运营/交易风控台；先财务、后风险和链路）

首屏导航标题 `Portfolio · 资金与收益`，响应式12栏、暗蓝+克制色系、紧凑银行级数字（千位分隔/等宽数字/正负号/币种单位/tooltip源/时钟），实用而非花哨。统一ECharts（PerformanceTrend/同设计令牌），desktop≥1440及mobile390可读、无横向滚动；表格转入折叠的“原始明细/对账”，不能删掉真实BTC及挂单真实性证据。

四到六个即时可见KPI：账户稳定币保证金权益（来自**同一新鲜账户估值**，不含BTC）/ USDT与USDC各自可用资金 / 全部可用资金估值（只在货币与汇率/会计定义可信时可算）/ 未实现盈亏 / 钱包基线变化（明确非交易PnL）/ 28仓与28签名TP独立进度（**不能把快照本地TP等同签名实时覆盖**）。页面顶部集成省空间状态灯：TESTNET黄、PRODUCTION绿、UNKNOWN/显式错误红；代理/交易所/私有同步/3模型红黄绿灰按实际新鲜证据，不显示“绿·黄·红·”字符。

#### 资金仪表图与阈值（必须可检验）
- 每币种独立 **AVAILABLE** 签名资产量，`<500` **红**、`500–<1000` **琥珀黄**、`>=1000` **绿**；缺失/过期/重复/无验证显示 **灰+—**，不可null=>0。阈值作用于**USDT/USDC原生可用额**，不是钱包余额、保证金权益或BTC；小于0异常也为红+标注。
- 每资产可用资金进度尺/刻度 + 余额组成（钱包、冻结/已使用保证金要有可审计来源，不能简单 wallet - available 当保证金义务）；本次用户签名样本：USDT wallet **6348.65196692**、available **897.73253986** → 黄色；USDC wallet **5171.46187975**、available **3764.21320535** → 绿色。以API实时样本为权威，以上只作测试fixture，不能写死到UI。
- 估值口径分清：USDT保证金权益4240.94 + USDC4671.27 = **8912.21 USD**；USDT/USDC钱包合计11520.11、可用合计4661.95（如汇率或现有估值源许可才显示美元），浮亏 **-2607.90 USD**；BTC的0.01及827.93USD不在稳定币两资产统计内，仍保留资产详情。
- 账户权益/已用保证金/可用资金 **资金结构图**、USDT/USDC双色对比、可用资金阈值条。严谨地区分钱包余额、保证金权益、交易授权可用、交易所`availableBalance`和Engine Entry实际许可，不能将可用总额当可建仓名义额。

#### 盈利、亏损、收益“科学”可审计展示
- **三个财务口径绝不合并**：
  1) **账户基线钱包净增**：现 +$1520.11，说明含手续费/已实现收益/资金费及潜在划转；不是交易净利润；USDT+$1348.65 / USDC+$171.46。
  2) **Binance交易所最近7天收入事实**：REALIZED_PNL+COMMISSION **+$1084.16**，funding **-$56.55**，合口径 **+$1027.61**；划转另列 $0.00，不与上述两项重复累加。对用户提供的数只用于回归fixture，必须校核真实实际API现值和asOf。
  3) **本地已闭合交易账本**（canonical完整周期34但Funding UNKNOWN34、Fee missing38、inconsistent48、unconserved133、unproven21）：无合法可计算值仍显示 `—` + coverage/缺口，不以 0 或钱包差替代，绝不把7天交易所收益冒充本地cycle净收益。
- 对最近24小时调用现有GET `/api/v3/trade-records/24h`，按 `byAsset.USDT/USDC` 的`grossProfit,grossLoss,netExFunding,totalFees,cycles,winningCycles,losingCycles`显示分别币种盈利/亏损双向柱、净PnL、手续费；缺少已证明周期要显示**无合格记录/覆盖率未知**，不是“0盈利”；7天必须基于现有具历史窗口的权威数据，否则只能卡片/标明确认范围。
- 盈亏颜色与资金可用灯分离：正收益绿色、亏损红、0中性灰；资金费绿色/红色以符号展示但资金费覆盖未知仍独立告警。
- 用一张瀑布图分解**同口径**7天交易所 REALIZED_PNL+COMMISSION、FUNDING、最终全口径净额；不要把钱包基线净增混入该瀑布；手续费已包含在前项，禁止二次扣除。
- 本地相同资产币种分开统计，USDT与USDC不应无依据按1:1加为同币种已实现PnL；如USD合计必须来自带asOf和来源的FX估值。收益曲线/权益曲线只用真实已有带时间戳的历史记录或有界浏览器会话采样，未证明7天历史不画所谓7天趋势。图上显示范围、首尾、样本数、掉点/缺口和最后新鲜asOf。

#### 风险、订单和账户覆盖的紧凑可视化
- 持仓28/签名TP28（以动作时来源严格区分签名和快照）、下单权限TESTNET、交易所确认建仓0、TP28、人工委托0、**本地未决UNKNOWN218**分别用风险状态图展示；不把218当真实交易所工作委托，也不把28TP与0建仓相加成“挂单”。
- 最近1h Entry fills406 / Exit fills43 / closedTrades0 / Net0 等**严格按原来源分层**；ENTRY方向fill总量≠新的已归因交易/已平仓完成周期/经营收益；归因OrderRegistry43与DurableOrderTable406分列、互不直接汇总。可在折叠明细内完整保留原八项执行真相、会计coverage、资金费UNKNOWN、手续费缺口和业务Pipeline，不牺牲排错。
- Exposure LONG34352.75/278.2%、SHORT13463.50/109.0%，不可与钱包资金或收益图合并成一份资产饼；独立风险条与净/总敞口（有来源才展示）。

### 数据管线、渲染与必过回归
- `GET /api/v3/account/assets` 是带证据的交易所签名资产只读缓存事实；修复Performance页面`financePerformance(snapshot)`只依赖snapshot.account.assets导致UNKNOWN。金额显示须按`status,asOf`/唯一行/60s freshness过滤，Engine时差≤10s容错，重名/负值/非法数据拒绝。过期后数值去可见性不留旧绿；不为了画图增加交易所REST轮询压力。
- UI读取单一15s read-only轮询/共享缓存，后台标签暂停+AbortSignal/超时+销毁清理；避免Overview原3s刷新叠加重复7天同步/SQLite/交易所请求。ECharts init/destroy/resize，no-canvas SSR/jsdom清晰test stub，不屏蔽浏览器真实可视化。
- 浏览器真实验收：1440x900、1920x1080、390px，测试首屏即时资金条与PnL柱状图，第二采样后真实趋势图；真实API注入/网络断开/重复资产/延迟/时钟前移/挂单UNKNOWN/空交易周期；console无 error、无NaN/Infinity/错误紫灯、tooltip有来源，截图与脱敏原始数据一一对应。不能把离线fixture截图当线上实证。
- 资金阈值边界：499.99 RED，500.00 AMBER，999.99 AMBER，1000.00 GREEN；真实样本USDT897.73 AMBER、USDC3764.21 GREEN。不要用红绿直接暗示可以交易或TP保护安全。
- 量化变化必须给render性能/CPU/请求增加上限和CPU sampling baseline；不能以UI美观改变Engine Entry/交易风险。

## P2 — 合并/CI/部署与实际验收

1. 从已部署 PR39源码和GitHub最新main重建干净独立worktree；先确认PR39最佳合并顺序和在线source差异；PR37只做**选择性集成**并解冲突，保留已验证PR39模型管理、token、正常执行策略/幂等、当前设置和模型PID。先修真实TypeScript/Vue端到端构建后完整`npm ci`、`npm run verify:ci`/S00、精确HEAD Windows CI，严禁跳测试。
2. 不为UI/采样器而强杀/重启当前 Scout25912、Review22880、Primary16772；新Engine是否需要一次受控Engine-only切换，要在**当前**签名全仓TP及双ID/cycle/qty/reduceOnly、私有同步、TESTNET、Production0、回滚、graceful机制门槛再评估，NO_GO则代码完成但不部署。保持系统原有投影、监控和真实订单管理。必要时以维护窗口切一次Engine但绝不重复启动已READY模型、动代理或更改交易所仓单。
3. 实际成功收据必须明确：GitHub commit/CI、部署版本和Engine实例、浏览器2+真实可见财务图与状态灯截图、实时签名USDT/USDC余额与颜色、历史采样边界、GPU MEASURED/STALE与独立Sidecar生命周期、实际模型PIDs、交易TP和Production0前后读回。
4. 提交 `docs/reports/v398-cockpit-visual-20261010/FINAL_DEPLOYED_VISUAL_AND_GPU_SAMPLER.md`、精确CI收据、脱敏日志和图表截图，更新`docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` / `docs/project-memory.md` / Issue#30/#35、PR#37/#39关系；**不要声称未验证功能已上线**。

安全红线：Primary唯一Entry、严格禁止补仓/加仓、HUMAN_MANAGED、交易所签名TP不可丢、Production零写。旧24h验收仍ABORTED，新24h保持NOT_STARTED/T0=null，不因这次改UI自行启动。
