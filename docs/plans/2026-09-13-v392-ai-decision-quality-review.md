# ZDJ-MITS V3.9.2 AI 决策质量专项复核

## 1. 最近运行样本范围

只读读取 `D:/MITS/data/zdj-settings.sqlite`，窗口为 2026-09-12 23:47:27Z 至 2026-09-13 05:47:27Z（约 6 小时），对应当前稳定运行数据；运行事件 28 个不同 symbol。未修改 Engine、Prompt、参数或模型。

口径说明：V3.9.2 当前没有独立 candidate 表，`POOL_ANALYSIS_STARTED`/`PRIMARY_START`/`ENTRY_PREFLIGHT_EVALUATED` 作为候选链代理分母；事件可能因 WAIT 重触发，因此这是运行漏斗而非唯一候选数。`decision_episodes` 当前为空，故成熟的 15/30 分钟反事实与 MFE/MAE 只能做有限判断，不能宣称已完成统计验证。

## 2. 建仓决策漏斗

|阶段|数量|说明|
|---|---:|---|
|Candidate（Primary start 代理）|461|`CANDIDATE_LIFECYCLE_CHANGED reason=PRIMARY_START`|
|9B Scout 调用|0|实际 `ai_runs_archive` 与资源配置均无 SCOUT 调用|
|27B Primary 调用|461|其中 438 normalized completed、22 failed/no intent、1 仍 RUNNING（采样时）|
|Primary 明确 PLACE|10|PLACE_LONG 5、PLACE_SHORT 5|
|Primary 明确拒绝/无边际|421|`NO_DIRECTION_EDGE`|
|Primary WAIT|7|`WAIT_FOR_PRICE`；另有 WAIT 触发/保存事件 7|
|AI 想交易但系统 Gate 阻止|1|`ENTRY_DIRECTION_POLICY_BLOCKED`，XMRUSDT LONG 不符合 NEW_LISTING SHORT_ONLY|
|Entry Intent|9|PLACE 中 9 个通过 Intent；1 个被 Gate 阻止|
|PLACE/submit attempt|7|其中 1 次后续报价刷新/授权条件阻止|
|Binance Order created|6|含正常工作挂单|
|Fill|1|`ENTRY_FILLED`|

### 不交易分类

以 461 个 Primary-start 代理为分母：

1. AI 主动不交易：421/461 = **91.3%**（`NO_DIRECTION_EDGE`）。
2. AI 想交易但系统 Gate 阻止：1/461 = **0.2%**；主要原因 `DIRECTION_NOT_ALLOWED`。
3. AI 想交易但价格/时机未满足：7/461 = **1.5%**（`WAIT_FOR_PRICE`）。
4. 系统/数据/模型异常：约 25/461 = **5.4%** `ENTRY_ANALYSIS_FAILED`；另有 22 个 AI failed/no-intent 记录，部分与同一失败链重复，不能简单相加。主要可证据化原因是 schema validation（TP target/range 为 0）及 evidence missing/stale。
5. 正常挂单但未成交：5/6 个已创建 Binance order 尚未产生 Fill（**83.3%**）；4 个有 TTL close 事件。它们属于执行位置/短 TTL 未成交，不应归入 AI 拒绝。

结论：低频的第一原因是 **27B 主动拒绝**，第二原因是模型输出/证据失败；Gate 阻止不是主要瓶颈，未成交是 PLACE 后的另一段损耗。

## 3. 不交易真实原因 TOP 5

从 421 条 `PRIMARY_NO_ENTRY` reason 文本归并：

1. 1m/5m 与 15m 方向或动量冲突；
2. 缺少已完成、可引用的 timing event / pullback / breakout confirmation；
3. 方向虽明确，但价格位置靠近阻力/支撑，剩余空间不足；
4. 15m 为 RANGE/UNCERTAIN 或强度不足；
5. 1h/4h 背景与 15m 不一致，模型将其作为谨慎依据。

大量 reason 是模板化重复短句，说明主要不是随机沉默，而是 Prompt 规定的多层证据合同被保守解释。

## 4. AI 决策质量评价

27B 确实在使用输入事实：实际 payload 含闭合 15m/5m/1m EMA、MACD、BB、ATR、成交价、orderbook imbalance、4h/1h 背景、BTC/ETH、权限/风险、持仓与历史字段；输出也引用 `technical.*.confirmed`、`execution.recentTrades` 等 fact ID。其遵守“15m 决定方向、短周期择时”的意图，但拒绝理由反复把短周期冲突、4h 背景和“无已完成事件”合并为 `NO_DIRECTION_EDGE`，存在过度保守迹象。

代表 PLACE：BTCUSDT LONG、ONDOUSDT SHORT 均生成合法 Intent/order；XMRUSDT LONG 则被系统的 NEW_LISTING SHORT_ONLY 阻止，证明模型能提出可执行方向，但不会自动等于系统授权。唯一 Fill 样本不足以评价方向正确性、Entry、MFE/MAE 或 TP；`decision_episodes=0` 也意味着当前不能做可靠的拒绝后 5/15/30m 反事实胜率。

质量结论：**推理能力已发挥，但当前表现为“能读全量事实、能结构化输出、明显偏保守”，不是模型完全失效。**

## 5. 当前 Prompt 的主要问题

实际 27B Prompt 来自 `ai_runs_archive.payload.inputPreview`，不是旧文档猜测。其长度约 3.6k input tokens，输出约 430 tokens，规则密集且含多次“never/only/required”。没有发现 15m 与 1m/5m 角色定义的直接冲突：Prompt 明确 15m 是 direction，1m/5m 是 timing；但“PLACE requires completed/confirmed event”“无 honest bounded trigger 用 RESELECT”“NO_DIRECTION_EDGE allowed whenever direction evidence insufficient”与多项背景/位置否决组合后，天然扩大了拒绝面。Scout 信息在实际 Primary payload 中没有形成有效输入，因为 9B 未调用。

建议方向仅为 **OPTIMIZE**，本轮不改：保留 15m 主方向、事实引用、权限硬约束和不强迫交易；删除/压缩重复禁止语句与重复事实；强化“1m/5m 只负责择时，不得把正常回撤单独升级为方向否决”；降权 1h/4h、BTC/ETH 与 orderbook 为背景/反证，而非默认否决；将 schema 的 TP 非法零值作为代码/输出约束问题单独处理，不让它表现成交易判断。

## 6. 9B 为什么调用降低

这是设计/配置结果，不是 Primary 接管 Scout 工作的运行时调度证据：`ai_resources` 只有 `scout-b580` 与 `brain-7900-primary`，但实际 27B 资源 payload 为 enabled，运行 settings 的 `ai.scoutEnabled=false`；最近窗口 SCOUT calls=0、27B=461。没有“9B 生成结果但 Primary 未消费”的样本，也没有大量候选绕过 9B 的异常分支——当前链路直接由 Primary 承担候选判断。因而 B580 闲置不是 GPU 性能问题，而是 Scout 开关/触发策略未启用。

## 7. 27B 是否已经成为瓶颈

27B 平均延迟约 **18.05s**，P95 约 **21.80s**，459 个有效 latency 样本；平均输入约 3,636 tokens、输出约 430 tokens。`queueMs` 失败样本多为个位数毫秒，运行窗口没有持续 queue backlog、timeout 或因 Primary 等待错过窗口的直接证据。故“GPU 忙”不等于吞吐瓶颈；当前更明显的问题是每次 Primary 都承担原本可由 Scout 过滤/摘要的工作。

## 8. 是否需要第三个 27B

**NO。** 当前没有满足“持续队列、P95 等待升高、候选因等待错过窗口、27B 决策吞吐成为瓶颈且并发一致性可证明”的证据。不要为了利用第二块 7900 XTX 而增加模型。用户提到的“Qwen2.8 27B”在当前配置/实际 payload 中不存在；实际身份是 `qwen/qwen3.8-27b`，不要自行下载安装或替换。

## 9. 下一步最多 5 项优化（收益/风险排序）

1. **高收益/低风险：** 先修复并单独计数 AI schema/evidence failures（尤其 TP=0、stale/missing evidence），避免把模型异常混入拒绝率。
2. **高收益/中风险：** 离线做拒绝样本 5/15/30m 反事实与 PLACE/Fill 质量标注，先获得可证据化的“过度保守”基线。
3. **中高收益/中风险：** 对实际 Prompt 做最小化优化，明确 15m 方向优先级，短周期仅择时，压缩重复否决措辞；不以提高 PLACE 次数为目标。
4. **中收益/低风险：** 只读监控 9B Scout 开关、触发来源、结果消费率与 27B queue/P95；若启用 Scout，先隔离验证不增加无价值调用。
5. **条件触发：** 只有出现持续 Primary backlog/窗口损失后，才评估第二个 27B；届时必须先设计同候选/账户一致性与并发上限。
