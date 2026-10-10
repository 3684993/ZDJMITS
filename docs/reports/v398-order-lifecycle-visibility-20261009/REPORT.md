# Issue #15：UNIUSDT 终态取证与订单生命周期可视化交付

## 结论

`UNI_TERMINAL_VERIFIED / CANCELED_UNFILLED`：用户所述北京时间 2026-10-09 15:20:34 的 Primary Run 确实提交了 UNIUSDT SHORT LIMIT GTX，数量 135，价格 7.442。随后 Review 给出 CANCEL，交易所确认撤单，成交数量 **0**。15:24 的活动 Entry 为 0 与这条历史提交并不矛盾。

实施基线为 main `7c9c94e9807c8c8ab1a9e0c8b205e391974493ec`，继承指定计划分支 `fe6456c`；独立实施分支 `codex/v398-order-lifecycle-visibility-fix-20261009`。

本报告、脱敏证据、完整测试日志随独立 PR 存放 GitHub。没有将凭据、SQLite、原始账户响应、提示词或完整私有订单身份上传。唯一身份均以 SHA256 指纹记录在 [uni-forensics.json](uni-forensics.json)，原始数据库和历史不改写。

## 真实时间线（北京时间）

| 时间 | 证据与行为 |
|---|---|
| 15:20:34.985 | 唯一 PRIMARY_BRAIN 开始，非相同 Symbol 的其他历史 Run |
| 15:21:37.286 | Primary 完成 PLACE_SHORT；原生预算 input20595/output804、input预测差值0 |
| 15:21:40.611 | Reservation / Intent 身份建立，授权到期15:22:40.611 |
| 15:21:42.274 | Intent 创建事件持久化 |
| 15:21:47.805 | TESTNET submit attempted |
| 15:21:51.207 | Binance 原始 order.time：创建订单 |
| 15:21:51.447 | 适配器提交响应：真实 exchangeOrderId 与 clientOrderId |
| 15:21:52.610 | ENTRY_ORDER_CREATED 持久化 |
| 15:21:54.478 | User Data WS 确认 WORKING、fill0 |
| 15:22:10.003 | 独立 REVIEW_BRAIN 完成 CANCEL |
| 15:22:11.199 | Binance 精确订单 updateTime：CANCELED、executedQty0 |
| 15:22:12.510 | User Data WS 确认同一身份 CANCELED、fill0 |
| 15:22:13.263 | Coordinator 发布 CANCEL ACTION_CONVERGED，confirmed=true |
| 15:32:21.927 | 本次独立只读 GET：exchangeOrderId 和 origClientOrderId 两条查询一致，CANCELED、origQty135、executedQty0；该 orderId 的 userTrades=[]，UNI 当前 openOrders=0 |

四次账户查询均为 signed GET；另外 GET exchange clock。只读 SQLite 使用 `mode=ro/query_only`。结论依赖**精确订单状态及身份核验**，没有以空 open-orders 推断撤单。

Review 原始说明包含：授权过期、价格位置、15m UP 对 SHORT 的不利动量和经济条件失效。其数字解释有错误：授权到期15:22:40.611，比模型声称的观察时间15:21:51.207和实际撤单15:22:11.199都晚；7.442也不等于其引用的上界7.4525741459。因此“模型声称过期”不能作为确定性 TTL 到期证据。真实行为是 **模型 CANCEL → Coordinator 精确核验/撤单 → 交易所确认**。本次不更改 Review 策略或交易执行权限。

## 已证实的源码错误

以下行号对应上述 main 基线：

- `apps/engine/src/services/runExecutionOutcome.ts:380`：只要 orderId 非空就 SUBMITTED；`:144` 固定文案“已挂单”。没有消费后续订单终态。
- `apps/engine/src/api/router.ts:47`：列表把事件限制为最后决策后5分钟，长期订单终态可能被截掉。
- `apps/engine/src/api/router.ts:191`：详情只 fold decisionChain.events；Review 使用独立 runId，部分订单事件只有 orderId，不能假定属于该 Primary 的 chain。现场详情返回 EXECUTING，但 orderFact 已 CANCELED。
- `apps/engine/src/api/router.ts:653` 和 `apps/dashboard/src/views/OrdersView.vue:40`：历史仅 UNKNOWN，正常撤单/成交/过期不可查。
- `apps/dashboard/src/views/OrdersView.vue:16`：仅挂载时读取，无刷新与自动更新。

## 实施内容

1. 新增纯只读 `entryOrderHistory`。按 durable order owner / exact internal、client、exchange 身份派生，绝不按 Symbol 或相邻时间归属；Review runId 不冒充 Primary runId。状态和事件投影不修改账本。
2. 历史提交 `wasSubmitted/submittedAt` 与当前 `lifecycleStatus/statusAuthority/freshness/lastExchangeVerifiedAt` 独立。新增 CANCELED、CANCELED_PARTIAL_FILL、EXPIRED、REJECTED、SUBMITTED_BUT_REMOTE_UNKNOWN。本地 TTL + remote ABSENT/UNKNOWN 独立显示 LOCAL_TTL_EXPIRED_REMOTE_UNKNOWN，不伪造交易所 EXPIRED。
3. 真正未知的提交不显示“曾成功提交”；未知成交数量不冒充0。真实资金/JIT拒绝仍保留原 NOT_SUBMITTED 和 blockReasons。
4. 延迟活动状态不能覆盖已确认终态，较弱 durable 状态不能覆盖已确认 WS 终态。保留各 exchange attempt、REPLAN、改价事件；相同身份重复 fill 更新不重复汇总。旧 REPRICE 事件缺新身份时明确标记证据缺口，不能恢复未记录的身份。
5. Run 列表和详情共用同一投影；读取终态至当前，详情额外按已证实 order owner 拼接终态时间线。Brain 提交统计使用历史 wasSubmitted，不因撤单丢掉成功提交事实。
6. `/orders` 向后兼容新增 `entryHistory`，默认7天、可选1–30天、每页50/上限100、独立状态筛选、总数和较早隐藏数。最新生命周期事件有100000上限和截断标记。历史派生不调用 Binance；只对当前分页读取 Review 归档理由。
7. 全部 Entry 历史展示创建/提交/更新、首次/最后成交观察、撤销/终止观察时间、数量/剩余、核验来源与新鲜度、TTL原因、Review、AI Run、脱敏身份、每次订单尝试和改价。确有 trade executionTime 时展示成交执行时间；否则明确为持久事件观察时间，不伪造精确成交时间。
8. 页面提供手动刷新、可见时15秒刷新及焦点恢复刷新，卸载清理定时器；历史没有提交/取消操作。活动 Entry 仍只来自原完整 open-orders 快照，STALE 禁用前台取消，后台 `entryCancelEligibility` 原样保留。

## 验证与部署边界

完整执行 `npm ci` 和 `npm run verify`，最终退出码0；250个测试文件 / 2125个测试全部通过。最终逐项结果、运行时身份及日志摘要在 [validation.json](validation.json)，完整输出在 [verify.log](verify.log)。此前回归失败已修复，最终结论以最终验证记录为准。

新增测试覆盖撤单fill0、部分成交后撤单、成交、交易所过期、本地超时远端未知、独立Run归属、Review独立Run、错client身份、REPLAN、重复fill、多次改价缺身份、ownership冲突、延迟状态、证据等级、分页筛选、刷新、STALE取消禁用及关联Run审计。隔离 SQLite HTTP GET 测试证明历史读取 `total_changes()` 不增加。

真实 UNI 本地数据库离线回放见 [uni-offline-replay.json](uni-offline-replay.json)：修复投影为 CANCELED，“曾成功提交 · 已撤单（成交0）”，一个 exchange attempt，SQLite变化0、exchangeWrites0。这是离线源码验收，不能冒充部署后的页面运行验收。

`UI_LIFECYCLE_READY / NOT_DEPLOYED`。当前运行的 TESTNET Engine PID18100，运行原 build `3.9.8-6cd926abca3eec24392e`；当前 Engine、三个模型、代理均没有启动/停止/重启。Entry 授权、Settings、TP Guardian、资金策略、真实历史未改变。WER保留。独立 PR 未自动合并，未覆盖稳定发布目录。

后续生效需要单独批准加载新版 API/dashboard 的发布；先重新核对构建身份、账户TP和备份，再执行批准的受控生命周期。当前任务没有部署授权，不执行切换；不会把离线PASS报告为线上修复已生效。
