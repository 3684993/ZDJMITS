# V3.9.7 订单生命周期 + GPU2 27B 模型资源与职责路由：一次性实施提示词

> 本轮不是继续讨论方案，而是按照已经形成的详细实施计划直接实施。
>
> 当前用户新增事实：
>
> - 机器上有两块 AMD Radeon RX 7900 XTX；
> - GPU1 已承担当前 Entry Primary；
> - GPU2 已经加载 qwen3.8 27B；
> - GPU2 模型服务尚未正确加入系统后台；
> - 当前“AI 模型资源”页面只允许 SCOUT / PRIMARY_BRAIN，无法正确表达 GPU2 27B 的订单复核与持仓管理职责；
> - 当前资源管理 UI 布局与交互不合理；
> - 上一版订单生命周期清理、1h 未成交终止、24h 未成交历史保留目标继续有效。
>
> 必须保留现有 GPU1 Primary，不得为了接入 GPU2 而替换当前已工作的 Entry Primary。

---

## 1. 先阅读实施计划

完整读取并以此为本轮主要实施依据：

`docs/reports/v397-order-lifecycle-27b-optimization-20261002/IMPLEMENTATION_PLAN.md`

同时阅读：

- `docs/reports/v397-profitability-loop-web-final-implementation-20261002/IMPLEMENTATION_RESULT.md`
- 当前 `packages/contracts/src/ai.ts`
- 当前 `apps/engine/src/api/runtimeSettingsResources.ts`
- 当前 `apps/engine/src/config/aiResourceLoader.ts`
- 当前 `apps/engine/src/services/aiFabric.ts`
- 当前 `apps/engine/src/services/positionReviewRunner.ts`
- 当前 `apps/engine/src/services/v396AiExitRunner.ts`
- 当前 `apps/dashboard/src/views/SettingsView.vue`
- 当前 Orders/reconciliation/Entry lifecycle 相关代码。

---

## 2. 已确认的代码问题

当前代码已经确认：

1. `AiResourceSchema.role` 只允许 `SCOUT | PRIMARY_BRAIN`；
2. runtime resource API 也只接受这两个角色，否则 `AI_RESOURCE_ROLE_UNSUPPORTED`；
3. Dashboard role select 同样硬编码这两个值；
4. 新增 AI resource 默认生成 SCOUT + 8081 + 9B 模板；
5. 单一 role 模型不能合理表达一个 GPU2 27B 同时承担：
   - Pending Entry Review；
   - Position Review。

所以不要只新增一个下拉 option 作为表面修复。

---

## 3. 必须实施的目标架构

### 3.1 物理资源与职责解耦

把 AI resource 作为物理 endpoint：

- id
- name
- baseUrl
- model
- gpu label
- concurrency
- enabled
- health/runtime metrics

把 AI duty 独立成 route：

- SCOUT_RESEARCH
- ENTRY_PRIMARY
- PENDING_ENTRY_REVIEW
- POSITION_REVIEW

允许一个 resource 被多个 duties 引用。

### 3.2 当前机器目标路由

必须先在当前机器实际发现 endpoint，不允许猜端口。

目标：

- SCOUT_RESEARCH → 现有 9B；
- ENTRY_PRIMARY → 当前 GPU1 Primary，保持原样；
- PENDING_ENTRY_REVIEW → GPU2 qwen3.8 27B；
- POSITION_REVIEW → GPU2 qwen3.8 27B。

GPU2 先使用 maxConcurrency=1。

同 GPU2 上优先级：

1. POSITION_REVIEW
2. PENDING_ENTRY_REVIEW

GPU2 故障不得静默抢用 GPU1 Primary。

---

## 4. Pending Entry Review

GPU2 27B 只判断，不直接调用交易所。

结构化输出至少：

- KEEP
- CANCEL
- REPLAN

必须绑定 exact Entry order identity。

输入必须包含原始 economic mandate、当前远端 order truth、age、当前行情、1D/4H/15m、1m/5m timing、TP/horizon、费用后 economics 与 thesis invalidation facts。

用户的硬规则继续成立：

- 自动 Entry 未成交超过 1 小时不得继续无限活动；
- 1h 到期不依赖 AI 是否返回；
- 到期后必须 final remote verification；
- remote active → deterministic cancel；
- remote absent/terminal → local convergence；
- REPLAN 必须终止旧 identity，再产生新计划。

---

## 5. Position Review

GPU2 27B 用于持仓判断：

- HOLD
- REDUCE
- EXIT
- HANDOFF

AI 不直接执行订单。

必须接入现有 PositionReviewRunner / AI Exit evidence chain，并保持：

- V396AiExitRunner / Exit coordinator 做确定性执行；
- reduce-only；
- exact cycle/quantity/owner identity；
- fee/funding/depth UNKNOWN 不伪造；
- AI_EXIT_FACTS_INCOMPLETE 必须找首因并尽可能修复事实供应链。

必须核实 HUMAN_MANAGED 是否阻断“分析”本身。如果当前一个 owner 字段同时控制 review 与 execution，需要拆清“可分析”和“可执行”语义，而不是让 GPU2 27B 对所有持仓永久闲置。

---

## 6. AI 模型资源 UI 必须重做

不要保留当前“一排模型按钮 + 单角色下拉 + 挤在右边的动作按钮”作为最终交互。

实施计划要求：

### 左侧资源列表

每个资源显示：

- display name
- model
- GPU label
- endpoint
- ONLINE/OFFLINE/BUSY
- active
- queue depth
- 当前 duties
- dirty 标识

### 右侧资源详情

字段：

- 资源名称
- Model
- Base URL
- GPU/设备标识
- 最大并发
- 启用
- 探测到的 model id
- health
- latency
- last error

GPU 字段注明：
“仅为资源标识，实际 GPU 由模型服务启动配置决定”。

### 独立职责路由区域

每一项选择 resource：

- Scout / Research
- Entry Primary
- Pending Entry Review
- Position Review

不再把 role 做成单一资源属性。

### 交互

- 新增 resource 打开空白编辑器，不自动造 SCOUT/8081/9B；
- 保存后 server readback；
- 测试连接显示具体结果；
- 删除被 route 使用的 resource 必须拒绝并指出引用 duty；
- selected/dirty/save/cancel/test/delete 状态清晰；
- 宽屏双栏，窄屏上下堆叠。

---

## 7. Orders 生命周期继续实施

不得因为 GPU2 任务而跳过上一版目标：

- remote Entry=0 时 Web active Entry 最终=0；
- 自动 Entry >1h 未成交必须 final-check + terminate；
- 普通 Orders 页面未成交历史只显示最近24h；
- >24h 未成交 Entry 不进入普通计数；
- 不删除真实 fill / position / TP / Exit / Closed Trade；
- restart 不复活已终结 Entry；
- cancel 按钮有明确结果。

---

## 8. 实施流程

不要再停下来等待用户批准。

按以下顺序一次性完成：

1. 当前实例 preflight；
2. 发现 GPU1 Primary 与 GPU2 27B 实际 endpoint/model；
3. 备份配置/数据库；
4. contracts/settings migration；
5. AI duty routing；
6. GPU2 resource 接入；
7. Pending Entry Review；
8. Position Review；
9. AI_EXIT_FACTS_INCOMPLETE 首因修复；
10. AI Resources UI 重做；
11. Orders 1h/24h lifecycle；
12. API/readback/dashboard；
13. tests/typecheck/build/verify；
14. commit + push main；
15. stop/start/restart 当前 TESTNET；
16. identity closure；
17. runtime readback。

禁止任何 Production 写入。

---

## 9. 验收

最终必须证明：

- GPU1 Primary 仍是当前 Entry Primary；
- GPU2 qwen3.8 27B 已作为独立 resource 加入；
- GPU2 实际 endpoint/model 测试通过；
- PENDING_ENTRY_REVIEW route 指向 GPU2；
- POSITION_REVIEW route 指向 GPU2；
- 一个 resource 可被两个 duties 引用；
- GPU2 review 实际 runtime metrics 可见；
- GPU2 failure 不拖垮 Primary；
- UI 不再只有 SCOUT / PRIMARY_BRAIN；
- UI 布局满足实施计划；
- Entry >1h 自动终止；
- Orders 24h history retention；
- exchange truth 与 Dashboard active count 一致；
- full verify/build/tests pass；
- TESTNET 运行最终 build；
- identity 6/6；
- Production writes=0。

---

## 10. 最终报告

完成后更新/生成：

`docs/reports/v397-order-lifecycle-27b-optimization-20261002/IMPLEMENTATION_RESULT.md`

必须汇报：

- 最终 SHA；
- runtime build；
- GPU1 Primary resource；
- GPU2 27B resource；
- GPU2 endpoint/model/gpu label；
- duty route readback；
- Pending Entry Review runtime readback；
- Position Review runtime readback；
- AI_EXIT_FACTS_INCOMPLETE 剩余原因；
- Orders 1h/24h lifecycle；
- UI 改造结果；
- tests/build/verify；
- identity；
- Production writes；
- 仍未验证的自然行为。
