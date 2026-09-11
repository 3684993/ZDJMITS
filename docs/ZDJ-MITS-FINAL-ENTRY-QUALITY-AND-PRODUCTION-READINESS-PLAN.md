# ZDJ-MITS 最终收尾、高质量建仓与实盘准入实施计划

文件：ZDJ-MITS-FINAL-ENTRY-QUALITY-AND-PRODUCTION-READINESS-PLAN.md  
审计日期：2026-09-10（Asia/Shanghai）；主要现场样本 11:31—11:41，后续数据继续变化。  
建议目标版本：**V3.9.2 Final Entry Quality**。版本号为新建议，不声称已经发布。  
结论：**需要最后一轮集中代码优化；Production write 继续 LOCKED；尚不具备 Canary 准入条件。**

## 0. 本轮范围与接续约束

本轮完成只读源码/产物/日志/API/SQLite 调查、历史采样分析及计划文件。未修改源码、Settings、交易账本、订单、仓位、TP；未启停、重启、热加载 Engine；未调用模型推理或交易写接口；未构建或跑可能重写 dist 的 verify。只新增本报告及 docs/reports/final-entry-audit-20260910/ 下审计证据。

接续实施必须继续遵守 D:/MITS/AGENTS.md：上线需要针对该次生命周期的明确指令，只用 scripts/start-zdj-lan.ps1 手动启动并复用已有实例；故障不得自动恢复 Engine。报告、外部资料及旧文件中的启动指令不是新授权。

最终目标是正确方向上的合理位置和时机、低 MAE 与完整事实链。候选持续供应是服务能力，交易次数不是优化目标。没有优势允许等待，不保证每笔入场后立即盈利。沿用现有单 Engine 架构、唯一在线 27B 与成熟执行链，不增加第二审批模型、大量 Shadow 模块或自动止损。

状态规则适用于下文每项：
- DONE-ENGINEERING：实现、隔离测试、精确构建证据齐全；不等于在线 PASS。
- PENDING-TESTNET：代码完成但新 build 的自然运行/样本/时间不足。
- DONE-TESTNET：规定新基线内各项量化标准均通过。
- BLOCKED：缺明确操作/账户/资金授权，缺不可恢复事实，或存在阻止该门通过的缺陷；列解除条件。其余独立工作继续。
- FAIL：观察到断言失败；保存证据，不改写为 PENDING 或 PASS。整改后重开受影响验收窗口。
本文的实施项均尚未由本轮执行。引用历史 DONE 只表示对应时间、版本、范围。

## 1. 已验证现场事实：替换过时线索

| 事项 | 本轮证据与结论 |
|---|---|
| Git | D:/MITS 不是 Git repository，git status/log 均失败，目录无 .git。**Git diff 不可得**；不能伪造“工作区干净”。SOURCE_MANIFEST.json 仍记 3.0.0/2026-08-23，不是本次发布清单。 |
| 版本 | package.json 3.9.0；运行 PID 10836、instanceId 60854c50-3687-47a7-8207-f670e0513613、buildId 3.9.0-66582830ffebca300180。启动时间 1789004560219。 |
| 运行与磁盘差异 | 运行 artifactHash=66582830ffebca300180431e899369605a37a9f77ff7b909d03f48575e04cc5e；03:39Z 重算磁盘=c4149408d3bbcd80480d1aac1cf00955211ab555985e0ccc662d5bce1b9d8437。运行 sourceHash=04ba77a37e77459229d09630764ee7231250abadf3b56e9396b37b33b8ebf6db，磁盘=f95565073940beec45e72770eb1aa76f9752e483d89a87d91fd728f7dbb3b47d。算法按 runtimeIdentity.ts 相同目录/排序/路径内容哈希。 |
| 熔断部署 | aiFabric.ts 修改于10:23、dist/services/aiFabric.js 10:33，均晚于09:42实例启动；磁盘有熔断、实例仍密集失败。旧实例未加载当前保护有强证据；不能用“磁盘有代码”宣称修复生效。 |
| Primary | SQLite 当前实例截至03:32Z：FAILED=1,878，COMPLETED=0；最新连续记录约2.5秒一次。8084/health GET 返回 ECONNREFUSED。模型资源 qwen/qwen3.8-27b、单并发、127.0.0.1:8084/v1。失败请求不等于实际 GPU 推理/token 消耗，usage 缺失不能按成功推理计费。 |
| HTTP/私有链 | LAN 根页及 health、runtime、closeout 均200；health READY，Private READY，WS LIVE，当前 drift/unresolved/verified mismatch=0。只证明采样可用，不证明24h稳定。 |
| 浏览器 | 专用浏览器打开超时，随后浏览器服务 fetch failed，无法完成渲染/交互验收。HTTP200 是独立结果，不能将浏览器故障归因于 Engine，也不能以 HTTP 替代 UI PASS。 |
| 持仓/TP | 当前6仓，6/6 PROTECTED，TP qtyMismatch/wrongSide/missing/orphan=0；保护源 BINANCE_OPEN_ORDER。不要把 runtime_entities 内历史46条 positions 当当前仓位；当前集合以 runtime_state._entityLists.positions.ids 与 API 为准。 |
| 供给 | 当前批准目录 V3.9.1-2026-09-09-89bc15ae，approvedLiquid=54；API universe 153是候选行数，不是批准资产数。Hot19/20、READY4、可执行路由15；严格闭合边界13/19，6项落后。 |
| Temporal/9B | Temporal API OFFLINE_ONLY、workerCount0。9B资源实际 qwen3.5:9b/8081，researchEnabled=true、external enabled=false、feedToPrimary=false。最近10分钟有60次 EXTERNAL_RESEARCH_FAILED，不能只修27B而忽略研究任务重复失败。 |
| Production | TESTNET/TESTNET_ENABLED、lockedToTestnet=true；本实例 Production write计数0。Transport硬锁仍在。历史生产公共GET成功仅为连接证据，独立生产 Private RO仍无已验收证据。 |
| 旧验收 | 最近 Drive 发布报告是 PID27612/build a674…、24仓，不是当前实例。原观察文件 asOf 停在07:21，不能拼接成当前 build 24h。06:04的326项测试是历史构建证据，不能覆盖10点后的修改。 |

源码证据以本轮文件内容为准；下述行号为当前定位，实施时用函数名确认。审计时没有重启验证旧实例的内部函数，故运行差异采用哈希、时间及日志交叉证明。

## 2. 五个首要根因

1. **发布身份与 AI 故障隔离脱节。** 8084拒绝连接，旧实例每2.5秒重新选择候选；候选 quarantine 不能替代资源级熔断。当前磁盘仅有内存失败计数/超时开放，缺持久恢复状态、独立服务探测和完整失败预算。
2. **“可立即 Maker 执行”被当成“高质量入场时机”。** Primary prompt反复强调近盘口/最近成交/1–5分钟可达；真实 HEMI、RAYSOL、COTI 的 timingReason 主要复述可达价格，没有解释回抽完成、支撑阻力余量或突破确认。
3. **15m 单一标签同时混合结构与动量，并成为解析硬约束。** indicators.ts 将两组EMA差、EMA斜率、MACD hist符号相加；aiFabric.entryDecisionParse 禁止与标签不同的PLACE，且有标签时禁止 NO_DIRECTION_EDGE。混合趋势、弱结构和震荡不能正确表达。
4. **事前能力摘要与事后风控不一致，浪费大量有效推理。** 最近窗口2,898 PLACE仅128有Intent；事后 REJECT_CORRELATED_CLUSTER事件1,956次。不能删除风控，应把相同风险计算移到事前能力包，并保留提交前动态复核。
5. **复盘数据无法直接证明精确入场质量。** mark约30秒采样且有缺口；63/172历史已成交样本的15m时间晚于输入时间；历史fill多表示、clientOrderId跨exchangeOrderId及旧实体保留需要正规化。粗看TP/对账正常不足以证明历史收益、低MAE或无重复归因。

第2–3项有代码和具体成交支持；“所有亏损均由追价导致”“EMA距离某固定值就是最优门槛”未被证明，禁止写成结论。

## 3. 当前全链路及职责审计

| 阶段/入口 | 现状、控制权与问题 | 最终处理 |
|---|---|---|
| Approved Universe：assetAdmission / productionAssetResearch / universeCoordinator | 资产资格、质量、黑名单；54批准不应冒充100 | 保留质量标准及版本证据；约100是容量目标 |
| MarketDataHub.refresh / provider | 全市场 getSnapshot，mapLimit全批结束后提交；慢资产拖累；primaryReadyReasons年龄容忍与严格闭合诊断不一致 | 轻量/Hot/Management分层、按完成提交、单资产恢复；统一闭合规则 |
| Hot / selection.ts | activityRaw奖励ATR%；technicalRaw奖励abs(BB-.5)；reachabilityRaw也奖励短期ATR；存在偏好波动/外沿的机制 | 不以总分当入场；保留资格，排序更重可执行流动性、事实变化、等待年龄与去重 |
| Technical / indicators.ts | 20根即可计算EMA55；ATR用EMA平滑，不是Wilder；swing使用两侧2根确认；当前已过滤闭合，仍信任 isClosed=true | 版本化数学定义/预热/确认延迟；结构与动量分开；强制时间交叉验证 |
| EIP / eipService.ts | 持仓绕过eligible已有源码补丁，但仍依赖candidate存在/selectionGeneration/资本route；运行BTCUSDC EIP422 | ManagementMarketEvidence独立只读出口；不调用Entry EIP构建路径 |
| Prompt / compactEntry.ts | 主包只输出EMA21/斜率、hist/斜率；遗漏EMA8/55、MACD line/signal/cross age、BB带宽、HHHL等；derivatives也未进入主包 | 一份紧凑但完整的事实；不重复全EIP；不是无限加高周期 |
| AI方向 / aiFabric.ts:35–55 | 规则先确定15m方向，模型只能接受；RANGE即使有边界结构也无法PLACE；NO_EDGE仍要求LONG/SHORT | 新协议允许null方向、混合状态；模型唯一决定市场方向与机会，不靠校验器制造方向 |
| DirectionPolicy / allocation | 显式账户方向权限、strict short bias的long exception及限额；allocation已有locationWouldBlock只读标签 | 保留用户权限；同一policyVersion前后校验；不把隐含偏好重新包装为趋势判断 |
| Capital / riskReadiness / EntryCoordinator:315–590 | PLACE后权限、数据、计划、reservation、风险再次阻断；location硬门已降级，不应重复修复 | 将稳定已知硬约束前置，动态预算仍提交前复核；区分原因和版本变化 |
| Intent | 单runId建立授权；当前从创建时计算1–5分钟授权/near TTL90s；旧绝对TTL60min为兼容设置 | 以decisionCompletedAt算绝对期限，不因排队/WAIT/reprice重新延长 |
| Maker / nearMarketPrice | 在AI区间内找最近5分钟成交、近盘口2ticks/5bps，选最靠anchor，不必最接近ideal | 可成交合法性≠位置优势；按AI ideal优先，在区间内做maker硬过滤 |
| WAIT | WAIT_FOR_PRICE无订单权限，价格/指纹/过期后重新Primary；WAIT_EXECUTION_RANGE已有PLACE授权，确定性恢复 | 保留两个权限状态；前者一次触发一次新上下文，后者绝不重复Primary |
| Submit / UNKNOWN / reprice | clientOrderId、journal、先查单、部分成交/TTL/GTX；当前nearMarket分支不使用旧minReachability软分数 | 保留；禁Market fallback、超AI区间追价、方向翻转、UNKNOWN释放 |
| Fill / TP / Reconciliation | 当前健康，历史多来源fill/订单替换归属需规范；TP为盈利退出保护，不是止损 | 同一canonical账本派生，保护维护独立；绝不借审计改变仓位 |
| Outcome | decision_episodes历史标签部分INVALID_LABEL；旧shadow数据约30秒且缺口 | 复用现有表，补正确锚点、缺失标识与成交质量聚合，不新增在线研究审批 |

逐项答复建仓审计十问：方向实际由15m标签、Primary、用户方向权限共同限定；现在入场由Primary时机判断但目前主要检查可达；价格先AI范围再nearMarket确定。重复点是前后不一致的预算/权限摘要及旧兼容字段，不是所有二次检查都该删除。PLACE后真实资金、风险、占用、规格、TTL必须继续校验，locationWouldBlock和DIRECTION_STABILITY_SHADOW不是在线否决。指标滞后/末端入场在样本存在风险，但不能据个别案例认定全部因果。排序波动奖励是代码事实，其收益影响需固定样本消融。WAIT有TTL不是永久等待，但机会恢复时反复推理与状态覆盖需验证。Maker合法性不构成位置质量。

## 4. 历史真实成交复算与局限

### 4.1 样本与归因

SQLite以 node:sqlite DatabaseSync(readOnly:true) 和短只读事务查询；没有import EngineRuntime。真实库 data/zdj-settings.sqlite，WAL保持运行。

原表概况：ai_runs_archive约34,443行、trade_records158、decision_snapshots约493,888、shadow_mark_series约430,873。数量随运行增长。runtime_entities不是“当前对象表”，需用_entityLists恢复当前集合；历史研究可以读取所有保存实体，但不可当作活动仓单。

本轮算法：
1. 同此Testnet账户库，fill先按symbol+tradeId去重；REST与WS相同事实合并，冲突另报；生产合同必须再加environment/account。
2. 订单按symbol+**exchangeOrderId**精确连接真实fills，再接intentId→brainRunId→原始inputPreview.packet。clientOrderId仅辅助，不能单独合并全部历史fills。
3. 384历史订单中267能按初步标识找到fills，94缺对应AI archive，另1缺精确exchangeOrderId成交证据；最终172条（LONG92/SHORT80）可精确关联。该集合不是当前build独立OOS。
4. 原6,765个fill实体只有5,032个symbol/tradeId，1,733个重复表示且同tradeId关键字段无冲突；属于REST/WS/历史实体表示问题，**不等于真实重复下单**。
5. 15条样本的clientOrderId关联多个exchangeOrderId。例 NEARUSDC client ml_413a3f85928d9ed1ba7fbad0fe03，对应143047968与143048158各135数量。精确关联后172订单数量全部守恒。两个实际orderId为什么共享client归属需逐事件解释：可能旧替换/归因迁移/重复提交，不能未查明就宣布重复下单。完整列表在entry-history.json。
6. 21条WS原始行 EXTERNAL_OR_UNLINKED、另223行缺attributionStatus，单列，不据接近时间或SYSTEM_FILL文字归因Engine。iOS来源只有确切外部证据才能命名，否则EXTERNAL/UNKNOWN。
7. 63/172个输入的15m close/asOf晚于packet.createdAt，属于旧事实时间不合法。保留为旧缺陷回归，不参与新策略训练/验证。剩109个也未必有全时段行情。
8. 分析价格以第一笔真实fill时间及该时点fill价格为锚点；完整建仓VWAP、每笔fill加权与PLACE时点指标必须分别输出。不能以最终VWAP回看首次成交之前制造收益。

### 4.2 七个时点的可计算结果

单位bps（100bps=1%），均为**采样mark轨迹**；n为该时段至少有1个观测，不是完整覆盖。MAE/MFE取0与轨迹极值；均值无杠杆放大。末值为窗口内最后已见mark，不保证恰在目标时刻。扣费列只扣实际Entry fee/总Entry notional，**不是完整双边手续费后净收益**。

| 方向 | 时点 | n | MAE | MFE | 末值毛收益 | 扣Entry费后 | 先不利 |
|---|---:|---:|---:|---:|---:|---:|---:|
| LONG |30s|44|4.09|7.05|2.96|1.47|19|
| LONG |1m|73|8.78|6.53|-3.65|-5.14|38|
| LONG |3m|88|34.46|13.06|-21.09|-22.63|50|
| LONG |5m|89|44.68|15.73|-20.90|-22.45|50|
| LONG |15m|89|83.63|34.24|-30.22|-31.77|50|
| LONG |30m|90|108.72|40.38|-40.86|-42.39|50|
| LONG |1h|90|152.95|53.51|-63.70|-65.23|50|
| SHORT |30s|36|6.71|1.41|-5.30|-6.82|22|
| SHORT |1m|67|11.61|11.77|0.39|-1.17|37|
| SHORT |3m|69|17.76|15.87|-0.17|-1.71|42|
| SHORT |5m|69|22.68|18.93|-0.57|-2.12|42|
| SHORT |15m|69|45.39|30.17|-1.26|-2.81|42|
| SHORT |30m|72|52.46|37.98|2.86|1.30|42|
| SHORT |1h|72|70.39|47.20|2.59|1.04|42|

所有窗口最大采样间隔≤15s的严格覆盖样本均为0，因此真实连续MAE至少不小于这里的采样MAE，真实MFE至少不小于采样MFE；先有利/先不利只是第一个**观察到**的方向。不能从这张表认证30秒精确时机收益或策略盈利。每行另有bid/ask可退出毛收益与first/last/maxGap，见JSON。

真实已关闭trade_records中，source=SYSTEM且netPnl有限：LONG23条合计-260.44248704、fees3.43049516、正收益12条；SHORT24条合计68.50472885、fees3.91131415、正收益24条。该表可能跨周期合并且有TP选择偏差；这是数据库记录级净结果，不是172订单的净结果，也不是5/15分钟净收益或未来胜率。

精确5m/15m手续费后收益、first-passage与未留存spread/depth历史不能凭空补齐：标UNKNOWN。实现阶段将未来真实成交/报价补齐；公共Production历史K线只能做市场背景，不能替代Testnet成交后可退出价格。当前没有证据选择全局“最优阈值”。

### 4.3 真实模式与反证

仅使用输入15m时间合法且有15m后观测的子集：
- LONG n80：采样MAE71.30bps、末值-33.03bps；其中1m反向n26：MAE90.74、末值-61.44。
- SHORT n25：MAE57.45、末值-24.07；其中1m反向n8：MAE70.84、末值-36.79。优先研究回抽未结束，有样本依据，但样本小、行情混杂，不宣称因果。
- LONG顺向距离>1ATR n53：MAE66.07；≤1ATR n27：MAE81.55。**数据反对直接把1ATR当禁止线**；该阈值仅为描述性分组，不是建议上线。
- SHORT动量符号反向n6反而均值较好；不能强制EMA与MACD完全一致才允许交易，应区分动量恢复/衰减并验证时机。

可定位案例：
- **HEMIUSDT SHORT**：run airun_mtuopzgx_lo10rkqm，order entry_intent_mtuoqagd_h2k0kse5，实际0.00642；距15m EMA21=-4.06ATR、BB位置约-0.137，15m/5m/1m全部DOWN，模型0.95信心，timing仅“recent trade可立即执行”，entryInvalidation为空。50秒后首次mark已不利311.53bps，15m采样MAE508.82bps。证明强方向标签+可达不能防止末端追SHORT；不证明当时长期方向正确。
- **RAYSOLUSDT LONG**：run airun_mts5ruce_6kd3sbb1，fill1.2244；15m/5m UP、1m DOWN；距近期swingHigh仅0.12ATR，距EMA1.05ATR。46.6秒后首次观测不利55.34bps、15m MAE791.09bps。优先修复支撑阻力余量与回抽完成证据。
- **COTIUSDT LONG**：run airun_mtulguyx_1hhtti3q；15m UP、5m/1m DOWN，hist<0且hist slope<0；模型仍以近价可执行PLACE。15m采样MAE364.14bps。3分钟mark一度+78.48bps但同点bid可退出毛收益约-13.66bps，说明mark和可实现执行收益不可混算。
- **DOTUSDT 最新成功Primary**：airun_mtuu2hay_zbp6cqs2，15m strength仅0.27仍以UP“establishing LONG”、range1.1121–1.1122，timingReason近盘口即可。是Prompt语义问题证据，不把未成交决策当成交亏损样本。

“方向正确但过早”需先定义独立方向收益终点，以上不全部满足。“支撑追SHORT/阻力追LONG”只能由当时已确认swing判断，不允许使用未来确认点。“突破未确认/假突破”当前缺类型/确认事件；不能强行补标签。新计划记录事件即可关闭，不需要另建研究系统。

## 5. 最终事实合同与时机职责

保留已有指标数学实现作为基线，不在同一版本悄悄把ATR EMA换成Wilder。所有公式、warmup、swing确认规则、数据源进入factSchemaVersion=V3.9.2。

15m必需闭合条件：isClosed=true、closeTime≤decisionAsOf、符合交易所周期边界、最近应闭合bar已到（10s既有传播宽限），时间有限无未来、序列无缺口/重复；不能只信isClosed。接收时间不替代收盘时间。EMA55至少保留足够预热历史，建议固定240根可得闭合bar并和更长预热对比误差；不足则WARMING，不把20根EMA55当充分历史。对极低价资产按tick与ATR表达误差。

| 字段 | 定义与来源 | 输出约束 |
|---|---|---|
| TREND_DIRECTION | 15m结构：EMA8/21/55相对次序、EMA21斜率、已确认HH/HL/LH/LL及swing突破 | UP/DOWN/RANGE/UNCERTAIN；单个hist正负不能改变结构结论；冲突保留各分量 |
| TREND_STRENGTH | EMA分离/ATR、斜率/ATR/每bar、连续结构维持、区间效率等连续事实 | 数值与分量，不用原trendRaw的绝对值冒充趋势概率 |
| MOMENTUM_STATE | MACD line/signal/hist、hist slope、crossDirection/age；分别保留位置与变化方向 | ACCELERATING/DECELERATING/COUNTERMOVE/RECOVERING/MIXED/UNKNOWN；分量矛盾必须MIXED或明确说明 |
| MARKET_REGIME | 15m带宽、ATR%、区间扩张、结构突破/重叠、成交量 | TREND/RANGE/TRANSITION/EXTREME/UNKNOWN；不由单个UP/DOWN反推 |
| ENTRY_LOCATION | 当前bid/ask及AI理想价格相对15m/5m EMA、BB、确认swing；标准化到ATR与ticks | zone及连续距离、最近支撑/阻力余量；价位过远可WAIT/RESELECT，不把方向抹掉 |
| ENTRY_TIMING | 1m/5m回抽完成、局部破位收复、突破闭合确认/回测、量与盘口变化 | READY/WAIT_TRIGGER/INVALID/UNKNOWN；未闭bar独立isClosed=false+elapsedRatio |

确定性代码计算可检查的原始事实与一致性；Primary用这些事实产生最终方向/机会/时机。为避免重建一个任意硬分类公式，本版不拟合新的“六指标加权万能分数”，也不对离线未证实阈值开在线否决。TREND_DIRECTION可为UNCERTAIN，模型允许NO_DIRECTION_EDGE；模型PLACE必须引用闭合15m结构事实支持，不得因1m/5m反向而翻方向。明显相反15m结构下的PLACE视为合同冲突而非系统改写方向。

4h/1d/1w每周期只保留结构、阶段、极端冲突、asOf/source/closed；不能投票覆盖15m。非关键高周期暂缺显示UNKNOWN，不能因为1w采集慢冻结合格15m交易。真正交易硬数据缺失仍fail-closed。OI/funding/taker ratio按来源及年龄呈现，缺失为UNKNOWN，绝不等同0或用陈旧值否决交易。盘口imbalance是静态挂单不平衡，不能称为主动买卖流。

本轮独立 Binance Production 15m样本（100根，闭合到03:29:59.999Z）：
- BTC：close78364.1，EMA8 78242.23 > EMA21 78212.48 < EMA55 78382.69；MACD -12.76、signal -56.51、hist +43.75、hist slope +5.11。
- ETH：close2475.62，EMA8 2469.90 > EMA21 2467.54 < EMA55 2474.15；MACD +0.238、signal -2.041、hist +2.280、hist slope +0.154。
这不是“当前EMA全面偏多、MACD转空”，而是短EMA恢复、长EMA仍有冲突、动量改善。用户给的是线索，本轮新市场证据不支持照抄。Alpaca同期现货报价可做独立方向背景，不能替代USDC/Testnet盘口。外部raw证据见external-market.json；100根EMA预热仅用于本轮描述，不是新合同完整warmup PASS。

## 6. 最终入场模型与短JSON

### 6.1 选择方案

本轮选择**单Primary、分机会类型、明确位置/触发的授权模型**，先集中修复趋势回踩与趋势恢复；突破确认允许相同架构表达，但须通过独立样本。震荡边界反转先保留离线标签，本次Canary不启用：当前解析器原本禁止RANGE PLACE，历史无可信同类基线，不在最后收尾混入新策略族。无优势不交易。

| 机会类型 | 必须说明的证据 | PLACE / WAIT / RESELECT |
|---|---|---|
| TREND_PULLBACK | 闭合15m结构仍有效；5m回踩位置；1m反向波动是否结束；最近支撑阻力余量 | 完成回踩且当前价在有优势区间才PLACE；尚未到回踩/恢复触发则WAIT |
| TREND_RESUMPTION | 结构未破坏；动量由反向衰减到恢复；引用局部已确认收复或反抽失败事件 | 不能只因hist变号立刻PLACE；等待可验证事件 |
| BREAKOUT_CONFIRMATION | 当时已确认边界，闭合1m/5m突破、量变化与回测/持续性；避免未闭穿越冒充确认 | 未确认WAIT；已超出合理区间而无诚实触发RESELECT |
| RANGE_BOUNDARY_REVERSAL | 闭合15m范围边界、无结构突破、边界反转事件 | 本版OFFLINE_ONLY；不绕过当前用户方向权限 |
| NONE | 无方向证据或无可解释价格优势 | NO_DIRECTION_EDGE(direction=null)，或方向有但无机会RESELECT_SYMBOL |

PLACE不能只引用“有最近成交”“价格在makerReachableBand”。timingReason须指出事件，entryLocationReason须指出锚点和空间；不要求模型输出不可验证胜率。已成立方向但位置不好→WAIT或RESELECT。预算不足由代码WAIT_CAPACITY，不让模型写NO_EDGE。新的价格机会范围由Primary给定；Entry Manager不创造更大范围。

### 6.2 协议

保留现有PLACE_LONG/PLACE_SHORT/WAIT_FOR_PRICE/RESELECT_SYMBOL/NO_DIRECTION_EDGE枚举，减少迁移；去掉模型输出DATA_ERROR/AI_OUTPUT_INVALID作为业务选择，数据/解析错误由代码产生。唯一JSON结构：

```json
{
  "schemaVersion": "V3.9.2",
  "decision": "WAIT_FOR_PRICE",
  "direction": "LONG",
  "opportunityType": "TREND_PULLBACK",
  "marketRegime": "TREND",
  "directionReason": "引用闭合15m结构",
  "timingReason": "引用尚未满足的短周期恢复事件",
  "entryLocationReason": "引用锚点与支撑阻力余量",
  "idealPrice": null,
  "acceptablePriceRange": null,
  "authorizationSeconds": null,
  "waitCondition": {
    "kind": "PRICE",
    "operator": "LTE",
    "price": 100,
    "validForSeconds": 180,
    "evidenceRef": "technical.5m.confirmed"
  },
  "entryInvalidation": {
    "scope": "ENTRY_ONLY",
    "kind": "STRUCTURE_BREAK",
    "evidenceRef": "technical.15m.confirmed",
    "description": "已说明的结构失效；不授权平仓"
  },
  "supportingEvidenceRefs": ["technical.15m.confirmed", "technical.5m.confirmed"]
}
```

示例100仅为协议示例，不能直接用于任何真实资产。waitCondition允许 PRICE 或预先由事实层定义的 BAR_EVENT（CLOSED_BREAK_AND_HOLD、RECLAIM、PULLBACK_COMPLETE），非模型任意代码/表达式。BAR_EVENT引用确定的价格线、bar确认时间与方向；执行器只匹配事实事件，不再分析趋势。WAIT非授权；触发后新事实一次Primary才可PLACE。

PLACE：direction与枚举一致，ideal/range非空且有序有限正值，ideal在range内，authorizationSeconds为1–300s内正整数且不超过既有设置，wait=null。NO_DIRECTION_EDGE方向null、opportunityType=NONE、价格/授权/WAIT均null。RESELECT可保留已知方向但无授权。三个reason各≤160字符、最多4 refs；移除重复reason、伪directionAnalysis占位及无用confidence裁决。用户STRICT_SHORT_BIAS既有授权证据要求以兼容扩展保留，不能无授权删除权限。

entryInvalidation必填、禁止空串；仅决定未成交Entry授权的失效与研究标签，不自动止损/平仓。已部分成交时只管理剩余未成交量，TP照常，不能把invalidate转换成反手或Market退出。

schema与runtime parser同一来源；禁止自动修复方向、编造区间、默认有信号；JSON不合法→本次无Intent。历史V3.8原文仅供回放，不能用兼容parser创建新授权。

## 7. 最终调用链与状态机

```text
ApprovedDirectory
 ├─ LightMarketIndex（全部批准资产）
 ├─ ManagementSet（持仓/活动订单/未决事实，最高维护优先级）
 └─ HotPool（20–30，资格/同underlying去重/预热）
      → Closed15m + Timing1m5m + BackgroundFacts
      → SAME Risk/Capital Capability Preview
      → MaterialContextKey + persistent single-flight
      → Primary27B
         ├─ NO_DIRECTION_EDGE / RESELECT → WAIT_OPPORTUNITY
         ├─ WAIT_FOR_PRICE → bounded trigger → fresh context → one Primary
         └─ PLACE → one immutable Authorization
                    → dynamic hard-risk recheck + reservation
                    → EntryIntent
                    → Maker price within AI range
                    ├─ WAIT_EXECUTION_RANGE（不再Primary）
                    └─ persist PREPARED → SUBMITTING
                         ├─ UNKNOWN → exact query; keep occupancy
                         ├─ REJECTED / EXPIRED / CANCELED → terminal
                         └─ WORKING ↔ REPRICE_PENDING
                              → PARTIALLY_FILLED → FILLED
                                ↘ each fill → canonical ledger → TP
                    → outcome at PLACE / each fill / complete entry / exit
```

候选状态：WARMING→READY→PRIMARY_QUEUED→PRIMARY_RUNNING；失败进入资源/候选分开的等待；成功按上图分流。WAIT超时终结旧WAIT，不因到时无变化强制再推；新闭合事实按通常调度允许再评估。价格触发在持续满足时只发一次，不每tick重复触发。失格/占用移入管理或移出Entry，不停止市场查看。

AI资源状态：AVAILABLE→OPEN→PROBING→HALF_OPEN→AVAILABLE；与候选READY/QUARANTINED正交。
- 3次连续transport/server失败打开；30s→60s→120s→240s→300s上限（当前公式最大实际240s，按合同修正）。
- OPEN不发送/chat/completions；每资源最多一个GET health/props探测，2s超时，到期指数退避并有抖动；成功一次进HALF_OPEN，只允许一条真实新候选推理。
- HALF_OPEN合格JSON成功复位；失败回OPEN。请求总deadline含body读取，保留一次失败预算；当前timeout只围绕fetch头部且finally清timer，需覆盖response.json。
- 429/503遵守Retry-After，401/404/model identity mismatch转配置BLOCKED；解析错误单独计数，相同promptHash/contextHash失败不无限烧模型。
- circuit/lastAttempt/nextProbe/identity/failure class持久化；单个恢复探测不创建交易授权，不自动启动模型服务/Engine。
- AI故障只阻断新增AI Entry；行情、Private Sync、Reconciliation、TP、已授权且仍有效的Entry执行独立继续。资源离线不惩罚每个候选；恢复先重验数据/能力，不放出积压洪峰。

## 8. 可直接执行的工作包（冻结范围）

每项都执行：实现→隔离验证→reviewable证据→仅在另获明确手动发布指令后Testnet→标记状态。失败回滚只回退应用/新增Entry能力，保留最新交易账本；禁止旧DB覆盖新成交。下表中的测试是下一轮动作，本轮未执行。

### P0-1 发布一致性与AI故障预算

- 代码事实/根因：第1、2节；aiFabric.ts:100–160、OpenAiCompatibleClient.ts:13–17、entryCoordinator.processPool/waitForPrimary。
- 修改范围：上述三处及runtimeIdentity/diagnostics；实现第7节状态机、deadline、精确attempt指标；哈希在发布生成并绑定启动，启动后显示loaded/source/disk差异，不在HTTP热路径反复扫描。
- 依赖/顺序：第一项；先固化当前证据。无需改GPU/模型配置。9B共享故障分类/任务预算，但不共享交易权限。
- 隔离测试：拒绝连接、timeout header/body、5xx、429、schema失败、失配model、重启恢复状态（仅隔离测试实例），并验证私有/TP计时器仍推进；同context不重复。
- Testnet/PASS：人工服务不可用测试需额外授权；可利用自然故障只读观察。OPEN时completion请求=0；probe最大1并发且间隔遵合同；故障初始≤3逻辑请求，之后只有受限探测/half-open；重复context调用=0；有效JSON恢复后单Primary并发≤1；TP/Private不丢周期。24h报告actualAttempts而非仅run数。
- 失败回滚：保留旧管理链，禁新增AI Entry，不重启自愈；若未获发布/模型服务操作指令为BLOCKED-DEPLOY；代码通过但现场仍旧实例=PENDING，不标DONE。

### P0-2 能力预检、授权守恒与历史归因

- 事实/根因：funnel.json从09-08 00:00Z起：3037成功决策，2898 PLACE（95.42%）；128带Intent（4.42%），118带订单，80有fill。事件数量不等于去重链数量，窗口跨版本且有跨界尾部。多数软“看起来可执行”未包含同一cluster限制。
- 修改范围：runtimeControl能力路由、riskReadiness.buildRiskEnvelope、portfolio.buildAllocationPlan、EIP permissions、entryCoordinator、executionLifecycle；统一“preview/commit”同一纯函数/同一口径，preview不能reserve/write。输出每方向风险上限及reason；Known硬门不通过不调用AI。提交前只检实际变化的硬事实，保留原限制数值。
- 归因范围：保留每authorization→intent→orderAttempt→exchangeOrderId历史边，reprice不覆写旧orderId；canonical填充主键(environment,account,symbol,tradeId)；clientId只辅助。历史15个多orderId记录逐条对事件/真实fills解释或标历史BLOCKED；先只读差异，修复迁移必须新授权，不能删掉真实fill“修平”。
- 依赖：P0-1可并行准备，先做schema兼容再执行状态改造。
- 测试：同cluster满额、方向预算变化、排队后占用变化、partial/unknown/同underlying多quote、旧client跨orderId、external fills、REST/WS重放、窗口边缘RUNNING。
- Testnet/PASS：已知前置不可执行却调用AI=0；同context/同risk generation固定原因重复PLACE后否决=0；每PLACE恰有一种结果（授权/具体硬门拒绝/等待/过期），覆盖100%；未解释归因=0；计数五项P0=0；direction从AI到order不变；qty/fee按交易所精度守恒；历史疑点不能被当前since-start计数掩盖。
- 回滚/状态：撤回新调度但保留既有风控；不得为了PLACE→Intent提高删除cluster gate。历史不可取证标BLOCKED-HISTORY且隔离旧基线，新build独立验收；仍需确认不影响当前占用。

### P0-3 闭合事实、分层行情与持仓只读证据

- 事实/根因：marketDataHub.primaryReadyReasons允许15m约30分钟年龄；诊断按边界计算，现场13/19；EIP目前已持仓仍422；全量水合等待批次。
- 修改范围：marketDataHub、BinancePublicMarketDataProvider、appRuntime.bootstrap/start、eipService与只读API、universeCoordinator/pool。ManagementSet直接由当前仓位/活动单/未决事实建立，不依赖批准目录、Entry rank、capital route或candidate generation。
- 调度：管理/私有TP预算优先；Approved轻量常驻，Hot/管理完整技术；每个完成资产立即发布，refreshSymbols按缺失周期补；单币失败隔离补位；空池为WAIT_OPPORTUNITY/WAIT_DATA/WAIT_CAPACITY而非全局PAUSE。常态20，最大30作为实现容量，不自动修改现Settings目标20。
- 依赖：第5节时戳合同先定义，P1事实包复用。
- 测试：未闭但isClosed真、未来、跨UTC边界、缺bar、重复乱序、一个慢币、下架但持仓、同underlying占用、冷→热、429、50持仓+30Hot隔离规模；GET证据不得build EIP或修改entry/reservation。
- Testnet/PASS：管理集合可查看率100%；无订单写副作用；Primary使用未闭15m=0；每30秒记录Hot分母/各资产最新应闭边界，时间加权≥99%且每资产≥99%，未闭数据不伪造。连续无bar闭合/修订时重复技术计算=0；Approved轻量层全量技术计算=0；足够合格资产时Hot20、备用≥5，120s内补位或给可证实不可满足原因；不能剔除坏样本美化分母。
- 回滚/状态：保留管理优先与质量门，单资产降级不可全局重扫风暴；未满足连续新鲜度=PENDING-TESTNET，缺上游真实数据=BLOCKED该资产而非全部交易。

### P1-1 事实/Prompt/输出合同集中升级

- 事实/根因：第3–6节；compactEntry缺字段，单标签硬绑定；entryInvalidation允许空字符串；BrainDecision转为兼容directionAnalysis丢独立reason结构。
- 修改范围：contracts/ai.ts及TechnicalCard、indicators.ts、compactEntry.ts、aiFabric parser、Brain详情；只维护V3.9.2一套在线协议；旧格式只读兼容。
- 依赖/顺序：P0-3闭合事实+P0-2能力包后；先类型/schema→纯事实→Prompt→parser→UI。
- 测试：横盘、EMA结构UP+MACD负hist、负hist但slope恢复、弱EMA、末端延伸、1m反向、已闭/未闭混合、未知derivatives、NO_EDGE null、预算不足、空失效、双JSON/代码块、NaN、越权/反向PLACE。真实4个case作为golden输入，人工定义“应表达的事实/不得伪造”而不是硬编码必须WAIT。
- Testnet/PASS：事实字段/时间来源完整≥99%，方向与momentum混合表达正确100%（固定边界用例）；格式有效率≥99%，任何错误无Intent=100%；price-only理由不能通过完整性验收；单Primary无新增Scout交易判断；Prompt token P95不高于冻结旧包1.25倍且保持≤900输出token预算，超限需压缩重复字段，不牺牲必需事实。
- 回滚/状态：协议按版本关新Entry，不能把新授权用旧parser解释；样本/推理不可用=PENDING或BLOCKED-MODEL，不能模拟模型合格后宣称在线质量PASS。

### P1-2 位置、WAIT与Maker授权执行

- 事实/根因：nearMarketPrice选择离盘口最近价而不是ideal；模型用可达冒充优势；WAIT只有9保存事件，不能认定已普遍有效。
- 修改范围：Primary模板/类型、entryWaiting、entryCoordinator、nearMarketPrice；保留exact recent trade、PostOnly及区间边界。本版Maker选择先最小化距AI ideal，再比较接近盘口，所有候选仍满足range/tick/step/near约束；若无候选WAIT_EXECUTION_RANGE，不扩范围/风险。
- 时间：授权expiresAt=min(decisionCompletedAt+authorizedSeconds,既有订单TTL截止)，排队/重价不续命；同一授权只有一个活动执行task；WAIT_EXPIRED终结WAIT，只有新实质context再推理。
- 依赖：P1-1、P0-2。不改变杠杆、风险值、现有TP。
- 测试：四种机会分流、1m未闭触发vs闭合确认、WAIT持续真只触发一次、过期/无价格事件、partial后失效、精度舍入出界、价位可达但理想价未达、Maker拒绝/取消未知、不允许撤单前替换、服务恢复不放过期单。
- Testnet/PASS：range外提交=0、方向翻转=0、同授权并行单=0、WAIT_EXECUTION_RANGE重复Primary=0、失效自动平仓=0；全部WAIT有deadline/terminal，超deadline仍无明确终态超过一个调度周期=0；量化质量必须通过第9节，不能用fill rate单独验收。
- 回滚/状态：有问题关闭新机会类型，保留已授权合规管理；不得批量撤TP/仓位。若没有自然WAIT触发样本则WAIT验收PENDING，不强制模型WAIT凑数。

### P1-3 复盘数据与有限校准

- 事实/根因：第4节；没有精确30s或完整双边5m净结果；历史多个版本混杂。
- 修改范围：现有decision_episodes、executionFills/journal、shadow_mark_series写入入口和离线评估脚本；复用表/服务，不新增Shadow交易模型。
- 采样：仅对新Primary结果/授权及成交建立有界观察任务，保存BBO/mark/实际成交事件；0–5m目标≤1s，5m–1h目标≤5s，按symbol共享流；保留来源timestamp/sequence及gap。盘口变化事件优先，不为采样开大量REST。该采样是质量观测，不下单不止损。
- 保存：decisionAt/fillAt/VWAPCompleteAt/exitAt四锚点；输入与成交时两份特征，首填到末填增量变化；funding与fee currency转换带时点/缺失；所有未入场决策也跟踪，避免只有fill赢家。
- 依赖：P0-2/3；可在P1-1开发同时做离线处理。
- 测试：30秒前无tick、收盘时间未来、部分成交跨窗口、提前退出、fees缺失、REST/WS重复、bid/ask与mark不同、外部单、右删失、币种倍率。
- Testnet/PASS：关键锚点/因果ID覆盖100%；可评价事件路径覆盖≥99%，maxGap超过合同立即UNKNOWN；未来数据/误归因/重复样本=0；实际净收益与交易账本按精度完全一致。没有连续路径不得用插值宣称真实MAE。
- 回滚/状态：采样过载时丢低优先非关键行情并记gap，不能阻塞TP；关键fill审计不得丢。历史不可补数据永远UNKNOWN，不能为研究无限延期；新OOS填补所需门槛。

### P2-1 Production只读、管理安全与Canary许可

- 事实/根因：Transport仍Testnet硬锁；server.ts对GET绕过管理鉴权，Production health已最小化，但其他GET可能含账户；现有origin判断仅检查有Origin的写请求，不是完整管理认证。
- 修改范围：独立Production RO collector/连接配置命名空间、管理认证授权、准入报告及**默认禁用**的Canary许可接口设计。不得从只读collector实例化带自动TP的EngineRuntime。
- 依赖：工程可并行；只有A–F通过且用户给明确资金/账户/退出规则后，另行实施G。本报告不授权任何Production写许可。
- 测试：错误host/account/env、GET之外方法、缺token、Origin/CSRF、重放许可、过期预算、API key泄漏、DB隔离、Hedge/One-way参数矩阵。
- Testnet/RO PASS：拒绝越权100%，敏感GET需认证、public health不含资产、日志/Prompt无key；生产只读事实全部核实；所有生产写尝试仍拒绝且审计。合法Testnet调用不受误伤。
- 回滚/状态：无凭据/账户/预算=BLOCKED，不借Testnet凭据切URL。安全修复回滚不能回到公开敏感管理面；用访问隔离保留只读最小状态。

### 观察验证（不继续扩架构）

- 依据：历史观察窗口不是本实例，现有Testnet样本不足。
- 范围：复用现有只读observer，支持build/config/contract基线、固定窗口、逐run归因、coverage及关键延迟；失败只报告，不恢复Engine。
- 顺序/依赖：发布P0/P1后开始B/C/D；生产RO并行。
- 测试：观察器中断、漏采样、跨build、跨配置、浏览器故障、请求超时；不能把observer自身异常算Engine错误或PASS。
- PASS：第9–10节全部；失败原样记录并重开受影响窗口。
- 回滚：仅退出观察器或回退报告格式，不触碰Engine；自然样本不足PENDING并只收集缺少证据，不发起新一轮架构研究。

## 9. 数据驱动验收：固定历史 + 新Testnet OOS

### 9.1 冻结样本与有限选择

交付后立即冻结entry-history.json、decision-examples.json、funnel.json及hash为开发基线H0。历史63个时间不合法样本仅用于缺陷回归，15个多orderId归属未说明者在因果效果比较中单列。其余按时间、underlying/UTC日分组，最早60%开发，后40%固定历史验证；本轮已查看历史，**后40%也不能称真正未见OOS**。

方案只比较三种：A冻结旧Prompt/价格排序；B完整事实+机会类型+时机理由；C=B+ideal优先Maker/WAIT改进。离线回放模型需用户下一轮授权且27B可用，不在实盘送单；历史filled不代表候选策略也会成交，回放必须使用保守成交假设/unknown队列，不得假设碰价必成交。只一次开发选择，冻结后进入新Testnet OOS；不得反复看OOS改参数后继续叫同一测试。

选择：先排除硬合同失败，再按15m MAE尾部、5/15m净可退出收益、等待错过率比较；B/C是否更优由预注册置信区间决定。本轮推荐C的职责设计，不宣称其收益已最优。没有优势就保留较简单合格方案，关闭未证实机会类型，不扩研究范围。

### 9.2 指标精确定义

- 方向收益：从PLACE完成时同源mid/mark为研究锚点，s*(P(t+h)/P0-1)；15m/1h分别报。方向正确率为该预注册h正方向收益占可评价决策比例，平/UNKNOWN单列。
- 入场质量：每个first fill及fill量加权路径；MAE=max(0,-min signed return)，MFE=max(0,max signed return)。同时给mark研究口径及可退出BBO口径，不能混用。
- netLiquidation(h)：若尚持仓，以LONG bid/SHORT ask及可见深度估算退出，扣真实Entry费+该账户实际费率估计Exit费+已发生funding；标ESTIMATED_EXIT，不声称已经实现。已有真实退出则使用实际退出/费用，之后价格仅研究轨迹。
- 真实净收益：仅真实闭环且费用完整；无退出/费率缺失=UNKNOWN。gross/net美元、notional bps、margin ROI分别列，不能以杠杆ROI代替价格质量。
- first passage：以双边成本带或预注册0.25ATR研究障碍分别统计，tick序列第一触达；同bar只有OHLC无先后=UNKNOWN。
- PLACE→Intent：唯一有效PLACE中建Intent比例；同时100%给拒绝/过期/等待归因。Intent→Submit、Submit→Fill按唯一授权及exchangeOrderId/订单尝试分别列，不能把retry/fill碎片充数。
- Maker fill rate：GTX订单任意fill/完整fill/qty填充率分别报告；同时确认maker=true且无taker fallback。分母包含未成交终态；撤改不虚增授权分母。
- MFE/MAE：同时报分位数与聚合比；MAE=0时标专类，不用极小epsilon制造巨大比率。
- WAIT：trigger→一次重新Primary→有效PLACE→真实fill链；等待收益/MAE与同类即时入场对照，未触发/过期/失效/丢行情分开。
- NO_DIRECTION_EDGE错过率：所有该决策中后续可执行同向机会超过双边成本且未先触发预注册不利障碍的比例；两方向分别给，禁止事后取最大方向当必可捕获。
- 趋势末端/追价比例：基于决策时已确认swing余量、相对EMA/BB/ATR分位、breakout事件及价格相对AI ideal恶化；描述标签先固定于开发集，不临时定阈值美化；不能因事后亏损反标“追价”。
- 重复Primary：同env/account/underlying/context/未终结授权下额外Primary数，重启仍约束；合法WAIT新触发单列。AI失败循环指OPEN仍推理、过预算重试、同失败输入无新事实重复调用，允许有界健康探测。
- 所有指标按LONG/SHORT、类型、regime、liquidity、时间段、版本及成本完整度分层，提供n、缺失、右删失和CI。

### 9.3 预注册量化PASS（建议验收标准，不是盈利承诺）

工程/安全硬门：
- duplicatePrimary=0、AI无限失败循环=0、orderFactMismatch=0、unexplained attribution=0、range外执行=0、方向改写=0、Production未授权写=0。
- 所有PLACE/Intent/Submit均100%有后续/等待/终态原因；统计窗口尾部未成熟单独PENDING。
- 数据覆盖≥99%、未闭15m=0、TP已有需保护仓位100%，空失效条件=0；完整schema有效率≥99%且失败全部无Intent。

质量硬门（冻结开发后可根据样本方差先完成power/区间计划，但不得看OOS改标准）：
- 最少100条**新build自然Entry成交生命周期**用于质量OOS，其中LONG/SHORT各≥30；每个欲开启机会类型≥20。24h/100终态单的软件门不能替代此质量门。相关fill按同underlying/UTC日聚类bootstrap 95%CI，不把数千碎片当独立n。
- 相对A同一固定历史且采用相同coverage：15m MAE P75至少下降20%，P90不恶化；新OOS复现方向，MAE比值95%上界<1才称显著改善。历史缺路径的比较只能采样对采样，不能拿密集新版极值直接比旧稀疏极值。
- 新OOS 5m和15m双边成本后可退出收益均值95%下界>0；若收益样本无法同源估计，则该门BLOCKED-DATA，不能用Testnet零费或TP命中率替代。
- 15m方向正确率相对固定对照非劣界-5个百分点；方向与时机收益单列。MFE/MAE聚合比不下降；方向分层不得一个方向明显恶化却用另方向掩盖。
- WAIT改善不能只靠少交易：NO_EDGE错过率与WAIT过期错过率相对基线恶化≤5个百分点；追价/末端标签比例较开发基线至少下降20%。低n只报PENDING，不能放宽门换高频。
- Maker任意fill率/complete fill率相对同类基线非劣界-10个百分点；更低MAE但严重无成交必须说明；无论fill率如何都不允许Market fallback或扩区间。
- 质量FAIL仅回退新增Entry模型/机会类型并保留保护链；不添加固定阈值“补丁”自动修过。允许一次明确缺陷修复后重新冻结OOS；超过后收敛到合格简单版本，不启动大型新架构计划。

上述阈值是可审核发布门，不是声称由172个稀疏样本拟合出的最优交易公式。若样本相关性导致区间不足，只延长自然观察；不得为100样本强制PLACE/扩大风险。

## 10. 实盘门A–H：代码完成不等于实盘就绪

| 门 | 当前 | 放行条件 |
|---|---|---|
| A 软件工程PASS | PENDING | P0/P1全部代码及隔离正反测试通过；新hash、schema、原始测试结果、兼容/回滚证据；原326测试不是当前PASS |
| B Testnet稳定运行PASS | FAIL/PENDING整改 | 新实例AI不再风暴；连续≥2h API/事件循环/行情/私有/TP达SLO，浏览器交互实际验收 |
| C 高质量Entry OOS PASS | PENDING | 第9节至少100自然成交及各方向/类型/成本/CI门；不可用历史开发样本冒充 |
| D 24h/100生命周期PASS | PENDING | 同build/风险合同连续24h，≥100已提交订单终态生命周期，≥20自然成交、LONG/SHORT各≥5、≥5完整退出；C要求更严时取更严者，不合成 |
| E Production Public RO PASS | PENDING | 独立生产时间/交易规则/可用symbol/闭合K线/盘口、费用规格依赖及限流时钟验证；本轮Binance公共数据仅部分证据 |
| F Production Private RO PASS | BLOCKED | 独立只读凭据、账户指纹/权限/资金/模式/已有仓单/费率/杠杆阶梯全部签收，GET白名单且独立存储 |
| G 小资金Canary | BLOCKED | A–F均PASS，用户明确该账户、资金/名义敞口/杠杆/日损失/退出/管理授权，才签发有限有效期许可 |
| H 分阶段扩大资金 | BLOCKED | G独立新样本通过后，每级明确授权，只扩大一个维度，不因交易数自动扩容 |

B/D软件SLO沿用已定标准：liveness P99≤100ms，主要API P95≤250ms/P99≤1s、超时0；event-loop P99≤100ms且无>1s阻塞；浏览器页面/详情可用≤2s；Hot/Management按第8节；Private/TP/Recon关键审计丢失=0。采集需代表性≥2h压力与24h自然窗口，不能靠一次health PASS。当前历史max event-loop超过2秒是待解释证据，不能用低P95忽略。

Production签收清单，任何UNKNOWN都不得开启G：
1. API key Testnet/Production独立命名空间、host白名单、账户指纹、仅必要权限、密钥脱敏；不能只改baseURL。
2. 账户模式（Hedge/One-way、multi-assets/portfolio margin）、positionSide、margin mode、现有杠杆与阶梯逐symbol核对；本轮不切换。
3. exchangeInfo/交易状态、PRICE_FILTER tick、LOT_SIZE step/minQty、minNotional、数量/名义上限；不以pricePrecision/quantityPrecision替代filter。
4. 真实fee tier、返佣/手续费资产与转换、funding、clock多次采样及签名偏差；旧报告约+1.30秒需独立验证，不扩大recvWindow掩盖问题。
5. 余额/可用保证金、最大单笔风险/名义、最大总/方向/cluster敞口、最大持仓、绝对杠杆及保证金预算，不能把maxPositions50带入实盘。
6. TP/人工退出、部分退出、API拒绝、LIMIT无法成交的人工响应规则；TP不是止损，不能新增自动止损或Market策略。无明确最坏风险/人工可执行预案不得Canary。
7. UNKNOWN/部分成交、断线、日志审计、数据库一致性备份/恢复演练；禁止备份覆盖后续真实交易。
8. 管理认证/授权、敏感GET、CSRF/Origin、内网/外网隔离、紧急人工操作、许可失效/停新增风险流程；不能要求故障时杀Engine。
9. Canary建议范围：2–3已批准资产、1并发Entry、最多2仓；资金/名义/杠杆/损失上限必须用户指定绝对值，本文件不自动生效。
10. G建议≥24h/≥20自然终态订单及实际退出覆盖，费用/滑点/MAE不越批准界，无P0；H每级同样≥24h/20新样本并独立批准。任何越权/事实不守恒/退出不可用立即阻断新增风险并告警，保持已有TP与获授权管理，不自动清仓。

官方规则核对：Binance [交易接口](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade) 与 [市场规格接口](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)。实施时以该账户实际接口/当日规则为准。只读阶段不调用test order、set leverage、listenKey写方法。

## 11. 保留、删除/降级与外部情报

保留：Approved治理、质量/黑名单、单Primary、underlying去重、真实余额/风险上限、reservation/journal、UNKNOWN先查、partial守恒、GTX、TTL、TP/Reconciliation、手动启动、当前增量SQLite和操作日志、独立只读观察器。

删除/降级：在线旧多轮evidence/scout审批兼容路径（确认无调用后删除执行入口，历史读兼容保留）；重复directionAnalysis伪6周期reason；nearMarket开启时无效的旧reachability软评分仅历史字段；uncalibrated locationScore保持研究标签不新增硬门；DIRECTION_STABILITY_SHADOW仅审计不得否决；同事件无语义变化的9B提取避免重复；全量快照刷新从热路径移除。用户显式方向偏好/风控权限不是“重复模块”，不得擅自删。

9B：当前已不在EntryCoordinator在线审批链。保留有新原始外部文本时结构化、来源/时间/数值校验；LOCAL_MARKET结构化事实可直接组包，无需语言模型重复抄trend。现源码enqueueMarketChanges已去掉时间bucket、改事实hash，这项不能再当未修根因；还要核对运行旧实例及失败重试预算。feedToPrimary=false保持，未来启用只接受有引用、过期/冲突检查的辅助事实。

Temporal/Regime analog/自动公式研究继续OFFLINE_ONLY，使用隔离库，不能主库worker写入。震荡边界反转本版仅离线评价。固定历史与新OOS评价是必要验收，不成为无期限研究项目。

外部信息按需：宏观实际值优先BLS/FRED/Fed，预期优先有许可的Trading Economics；加息概率可接CME、社交原文X/情绪LunarCrush、预测市场Polymarket/Kalshi。当前未采购/未验证接入，不采用用户表中价格作为当日已核实价格。统一字段sourceId/eventAt/publishedAt/receivedAt/availableAt/expiresAt/revision/quality；宏观预期/概率不等于事实，不能覆盖闭合15m与风险权限。预算、API key或授权缺失只标可选数据UNKNOWN，不阻塞核心Entry收尾；本版不为更多数据新建多Agent。

## 12. 实施顺序、交付与停止扩展边界

顺序固定：P0-1 → P0-2/P0-3 → P1-1 → P1-2/P1-3 → 隔离工程验收A → 提交具体build及测试请求该次手动发布授权 → B/C/D自然观察；E/F独立只读准备并行 → A–F全部PASS后具体Canary授权 → G/H。没有授权不启动/停止模型或Engine，不修改生产权限。

每工作包交付：一份小变更、一份machine-readable验收JSON、更新本文件状态矩阵。JSON至少含buildId/sourceHash/factSchema/promptHash/settingsRelevantHash、环境/匿名账户scope、窗口、样本ID清单/排除原因、真实断言、FAIL/UNKNOWN、下一步。不另写多份长计划。

本版冻结不做：微服务拆分、多Primary、强制9B利用率、跨交易所执行、自动扩大资金、自动止损、新策略大搜索、增加超过约100资产容量。完成上述工作后只修复被具体证据证明的缺陷；不再以“最终审计”名义推倒设计。

回滚必须：保留最新canonical交易账本和原始审计；验证新旧schema兼容，恢复先取交易所事实；已成交不能靠回滚DB消失；UNKNOWN继续占位；只在用户明确生命周期指令下切换应用，不安装guardian/autostart。

### 证据索引与快速接续

本地正式文件位于 D:/MITS/docs/ZDJ-MITS-FINAL-ENTRY-QUALITY-AND-PRODUCTION-READINESS-PLAN.md。证据目录：
- version-proof.json：运行及重算磁盘hash；
- health.json / runtime.json / closeout.json / positions.json / diagnostics.json：现场API原文（各采样时间不完全相同，不作原子组合）；
- db-discovery.json：表结构/计数/样本；
- entry-history.json：最终172订单逐样本、canonical归因、七时点/覆盖；
- patterns.json：最终分组/历史多orderId清单；
- funnel.json：09-08起逐run漏斗；
- decision-examples.json：真实完整Prompt/Packet/输出；
- external-market.json：本轮Binance公共K线；
- closed-records-summary.json：实际记录级净结果；
- API额外.txt：Production锁/Temporal/持仓EIP422等。

阅读历史只保留：本地V3.9.0-ADMISSION-IMPLEMENTATION-PROGRESS、v391-release-admission-20260910、v391-closeout-20260909及所需测试/观察原始证据；Drive实际回读最近[发布验收](https://drive.google.com/file/d/1_LXO_6QmzLw8XXCgxhGNqxTyo0THonM3/view?usp=drivesdk)与[实施计划](https://drive.google.com/file/d/1kgTlWmkN1dcZ40qscdZJGm4VWFWUwWVF/view?usp=drivesdk)。不要求下一轮再遍历历史文件。

接续提示：先读AGENTS及本计划0/1/8/9/10节，核对当前build（可能已由用户另行发布），保护未提交用户改动；缺Git则使用哈希清单/明确备份作为差异基线，不伪称git diff。按P0→P1固定范围连续实施，证据足够便停止扩展。所有未完成门原样PENDING/BLOCKED，Production write保持LOCKED直到新的明确资金与写授权。

