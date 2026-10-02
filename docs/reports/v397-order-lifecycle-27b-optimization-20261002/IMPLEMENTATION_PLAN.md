# V3.9.7 订单生命周期 + GPU2 27B 模型资源与职责路由实施计划

日期：2026-10-02  
仓库：`3684993/ZDJMITS`  
适用范围：当前旧电脑 TESTNET 实例

## 1. 当前已确认的问题

### 1.1 AI 模型资源不是单纯 UI 缺陷

当前 `packages/contracts/src/ai.ts` 的 `AiResourceSchema.role` 只允许：

- `SCOUT`
- `PRIMARY_BRAIN`

当前 `apps/engine/src/api/runtimeSettingsResources.ts` 对写入同样硬校验这两个值，其他角色直接报：

`AI_RESOURCE_ROLE_UNSUPPORTED`

当前 `apps/dashboard/src/views/SettingsView.vue` 的 AI 资源角色下拉也只包含：

- SCOUT
- PRIMARY_BRAIN

并且新增资源默认写死为：

- role = SCOUT
- baseUrl = http://127.0.0.1:8081/v1
- model = qwen3.5:9b
- concurrency = 1

所以第二块 RX 7900 XTX 上已经加载的 qwen3.8 27B 即使服务真实存在，也没有适合的职责可以挂入系统。

### 1.2 当前 UI 结构混合了“物理资源”和“逻辑职责”

截图暴露的问题：

- 多个模型以一排小按钮显示，模型名/资源名/dirty 状态混在一起；
- “新增”后出现第三个资源，但角色只能选 SCOUT / PRIMARY_BRAIN；
- GPU 是自由文本，容易让用户误以为该字段会控制实际 GPU；
- 资源连接信息、职责、实时健康、队列、用途没有分层；
- 保存/取消/测试/删除按钮挤在同一行右侧，选中态和 dirty 状态不清晰；
- 同一 27B 如果既要处理待成交订单又要处理持仓，目前只能重复创建两条资源或错误复用 PRIMARY_BRAIN。

### 1.3 当前 Primary 不应被 GPU2 替换

用户明确：

- 有两块 AMD Radeon RX 7900 XTX；
- GPU1 已运行当前 Entry Primary；
- GPU2 已经加载 qwen3.8 27B；
- GPU2 的 27B 需要接入后台，用于建仓订单复核与持仓管理。

因此本轮目标不是替换当前 Primary，而是新增一个独立 AI 资源并给它独立职责。

---

## 2. 总体架构：资源与职责路由解耦

### 2.1 物理资源

将 AI endpoint 定义为物理资源：

```text
AiResource
  id
  name
  baseUrl
  model
  gpuLabel
  maxConcurrency
  enabled
  health/status
```

资源只描述“哪里有一个模型服务”，不再用单一 role 表示它只能做什么。

`gpuLabel` 只是资源元数据，真正的 GPU 绑定由本地模型服务启动参数决定。Dashboard 不得暗示修改该字段可以把已经运行的模型从一个 GPU 迁移到另一个 GPU。

### 2.2 逻辑职责

新增独立职责路由，例如：

```text
SCOUT_RESEARCH
ENTRY_PRIMARY
PENDING_ENTRY_REVIEW
POSITION_REVIEW
```

当前建议路由：

| 职责 | 资源 |
|---|---|
| SCOUT_RESEARCH | 现有 9B |
| ENTRY_PRIMARY | 当前 GPU1 Primary，保持不动 |
| PENDING_ENTRY_REVIEW | GPU2 qwen3.8 27B |
| POSITION_REVIEW | GPU2 qwen3.8 27B |

一个物理资源允许承担多个职责，因此 GPU2 27B 不需要复制两条完全相同的 endpoint。

不新增让模型直接写交易所的 `EXIT_EXECUTOR` 角色。AI 负责判断，现有确定性 Exit coordinator / adapter 负责实际交易所动作。

### 2.3 向后兼容

现有：

- SCOUT → SCOUT_RESEARCH
- PRIMARY_BRAIN → ENTRY_PRIMARY

迁移时必须保持现有 Entry Primary 的 endpoint、model、并发、运行行为不变。

旧配置可以继续读取；迁移后由 route map 成为新权威。

---

## 3. GPU2 27B 接入前的实际发现

Codex 在当前旧电脑上必须实际确认 GPU2 27B endpoint，不允许假设端口。

必须：

1. 检查当前本地模型服务进程及启动参数；
2. 确认哪个 endpoint 对应 GPU1 Primary；
3. 确认第二个 qwen3.8 27B 的实际监听地址；
4. 对候选 endpoint 调用 OpenAI-compatible `/v1/models` 或现有 probe；
5. 记录服务器实际返回的 model id；
6. 不修改 GPU1 Primary 的已工作配置；
7. 将 GPU2 endpoint 作为新资源加入 Settings；
8. 保存后做 server readback 和实际连接测试。

若 GPU2 服务没有独立监听 endpoint，则不能伪造“已接入”；应先根据本机实际模型服务配置建立独立 endpoint 后再接入。

---

## 4. 后端 Schema / Settings / API

### 4.1 Contracts

将单一 `AiResource.role` 重构为物理资源 + 路由。

推荐：

```ts
AiResource {
  id
  name
  baseUrl
  model
  maxConcurrency
  gpu
  enabled
}

AiDutyRoute {
  duty: SCOUT_RESEARCH | ENTRY_PRIMARY | PENDING_ENTRY_REVIEW | POSITION_REVIEW
  resourceId
  enabled
  priority
}
```

如为了兼容需暂时保留 legacy role，应明确标记 deprecated，runtime 不再以它作为唯一 routing authority。

### 4.2 Settings

增加版本化 `aiDutyRoutes` 或同等结构。

要求：

- 每个启用 duty 必须指向存在且 enabled 的 resource；
- ENTRY_PRIMARY 必须唯一；
- PENDING_ENTRY_REVIEW 与 POSITION_REVIEW 可以指向同一 GPU2 resource；
- 删除一个仍被 route 引用的资源必须拒绝或先要求重新分配；
- optimistic settingsVersion 冲突保护继续保留；
- 不因迁移自动改变现有 Primary。

### 4.3 Runtime Resource API

现有资源 API 需要支持：

- create/update/delete physical resource；
- list/save duty routes；
- test endpoint；
- readback model id；
- health/latency；
- active requests；
- queue depth；
- last error / last success。

测试资源时必须测试该资源自己的 baseUrl/model，而不是默认 Primary。

---

## 5. Runtime AI Router

新增或重构统一 AI routing 层：

```text
runDuty(duty, request)
   ↓
AiDutyRoute
   ↓
AiResource
   ↓
OpenAiCompatibleClient
```

### 5.1 GPU 隔离

GPU1：

- ENTRY_PRIMARY

GPU2：

- PENDING_ENTRY_REVIEW
- POSITION_REVIEW

GPU2 推荐 `maxConcurrency=1` 起步，避免同卡两个 27B 请求同时抢显存/计算。

### 5.2 优先级

同一 GPU2 上：

1. POSITION_REVIEW 优先；
2. PENDING_ENTRY_REVIEW 其次。

理由：已经持有的仓位需要优先管理，未成交 Entry 可以取消或等待，不能让大量候选复核饿死持仓复核。

这不是风险门禁，而是资源调度优先级。

### 5.3 故障行为

GPU2 27B offline / timeout 时：

- 不允许把请求静默转发到 GPU1 Primary，避免拖垮建仓主脑；
- Pending Entry 到硬生命周期上限仍由确定性代码取消/终态化；
- Position 仍保持 TP、确定性 Exit convergence 和现有 handoff；
- UI/readback 明确显示 GPU2 reviewer unavailable。

---

## 6. GPU2 27B：待成交建仓订单复核

27B 不直接 cancel/reprice/submit。

它只输出结构化判断：

- KEEP
- CANCEL
- REPLAN

可选附带：

- thesisValid
- directionStillValid
- targetStillReachable
- economicsStillValid
- reason
- nextReviewAt

### 6.1 输入

必须以当前远端订单身份为前提，包括：

- original EntryEconomicMandate；
- symbol / side；
- original price range / TP / horizon；
- current remote order status；
- current unfilled quantity；
- order age；
- current quote/book；
- 1D / 4H / 15m 新鲜 closed-bar facts；
- 1m/5m execution timing facts；
- 当前 fee-adjusted expected net；
- 当前 target reachability；
- original Primary thesis 与失效条件。

### 6.2 触发

不要每个行情 tick 都调用 27B。

由 Codex 按当前 scheduler 实际结构实现有界触发，至少覆盖：

- 新 Entry 挂单经过合理观察期仍未成交；
- 关键 15m bar / thesis facts 发生 material change；
- 价格偏离原授权带；
- 经济条件已明显变化；
- 接近 1h 硬生命周期上限。

### 6.3 1 小时硬上限

用户要求自动 Entry 未成交不得超过 1 小时无限存在。

1h 是确定性生命周期上限，不依赖 27B 是否成功返回。

到期：

- 先核验 remote exact/open-order truth；
- 若 remote 仍 active → deterministic cancel；
- 若 remote 已 absent/terminal → 本地收敛；
- 不因 AI timeout 延长旧订单；
- REPLAN 必须结束旧 identity，再产生新计划/新 identity，不能在旧 clientOrderId 下偷偷改方向/quantity/TP。

---

## 7. GPU2 27B：持仓 Review

GPU2 27B 用作 POSITION_REVIEW，输出：

- HOLD
- REDUCE
- EXIT
- HANDOFF

必要时可以输出 target/thesis 建议，但不直接写交易所。

### 7.1 输入

至少：

- physical cycle identity；
- side / quantity；
- entry VWAP；
- current price；
- current TP；
- holding duration；
- unrealized/realized economics；
- 1D / 4H / 15m；
- 1m/5m execution context；
- MFE/MAE / target reachability；
- fee/funding/depth facts；
- original Entry mandate/thesis；
- 当前 thesis invalidation facts。

### 7.2 与现有 Exit 的边界

- PositionReviewRunner 负责得到 AI review evidence；
- V396AiExitRunner / Exit coordinator 继续负责确定性执行；
- AI_EXIT_FACTS_INCOMPLETE 必须找到缺失事实的首因；
- 不允许为了让 AI Exit 成功而把 UNKNOWN 填 0；
- reduce-only、identity、quantity claim、exchange filters 保持现有约束。

### 7.3 HUMAN_MANAGED

Codex 必须核实现有大量 HUMAN_MANAGED 是否导致 Position Review 根本不运行。

需要明确：

- 哪些仓位允许 GPU2 review；
- review 是否只是建议；
- HANDOFF 后是否完全禁止 AI；
- 是否需要独立 `AI_REVIEWABLE` 与 `AI_EXECUTABLE` 权限，而不是用 HUMAN_MANAGED 一个字段同时控制分析和执行。

目标是：即使最终执行权仍有限制，GPU2 也应能产生可审计的持仓判断，不能因为 owner 状态让 27B 完全闲置。

---

## 8. AI 模型资源页面 UI 重做

当前一排模型小按钮 + 单表单布局重做。

### 8.1 桌面布局

建议双栏：

```text
┌──────────────────────── AI 模型资源 ────────────────────────┐
│ [+ 新增资源]   资源健康摘要                                 │
├───────────────┬─────────────────────────────────────────────┤
│ 资源列表       │ 资源详情                                   │
│               │                                             │
│ 9B Scout      │ 名称     [GPU2 27B Reviewer]                │
│ ONLINE        │ Model    [qwen3.8 27B]                      │
│               │ Base URL [实际发现 endpoint]                │
│ GPU1 Primary  │ GPU标识  [AMD RX 7900 XTX #2]              │
│ ONLINE        │ 并发     [1]   启用 [✓]                     │
│               │                                             │
│ GPU2 Reviewer │ [保存] [取消修改] [测试连接] [删除]          │
│ ONLINE        │                                             │
├───────────────┴─────────────────────────────────────────────┤
│ 职责路由                                                   │
│ Scout/Research      → 9B                                   │
│ Entry Primary       → GPU1 27B                             │
│ Pending Entry Review→ GPU2 27B                             │
│ Position Review     → GPU2 27B                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Resource card

左侧每张卡至少显示：

- display name；
- model；
- GPU label；
- ONLINE/OFFLINE/BUSY；
- endpoint；
- 当前 active；
- queue depth；
- duties；
- dirty 标识。

### 8.3 资源详情

字段：

- 资源名称；
- Model；
- Base URL；
- GPU/设备标识；
- 最大并发；
- 启用；
- 实际探测 model id；
- last health check；
- latency；
- last error。

GPU 字段明确文案：
“设备标识仅用于资源识别；实际 GPU 由模型服务启动配置决定”。

### 8.4 职责路由

不要再把 role 放在资源表单最上方作为单选。

单独显示“职责路由”：

- Scout / Research
- Entry Primary
- Pending Entry Review
- Position Review

每一行选择一个 resource。

### 8.5 交互

- 新增时打开空白资源编辑器，不自动假设 SCOUT/8081/9B；
- 可以提供“本机 OpenAI-compatible 资源”模板，但必须让用户填写/发现 endpoint；
- 保存后服务端 readback；
- 测试连接展示具体成功/失败；
- 删除被职责引用的资源时明确拒绝并指出哪些 duty 正在引用；
- dirty 状态只出现在对应 resource；
- selected 状态明显；
- 宽屏双栏，窄屏上下堆叠；
- 按钮不得挤在最右边无分组。

---

## 9. Orders 生命周期仍按上一版计划同步实施

本轮模型资源改造不能丢失上一版订单清理目标：

- 当前 remote Entry=0 时 Dashboard active Entry 必须=0；
- 自动 Entry 未成交 >1h 自动 final-check + cancel/terminal convergence；
- 普通 Orders 页面未成交历史只展示最近24h；
- >24h 未成交历史不进入正常计数；
- 不删除 fills/positions/TP/Exit/Closed Trade；
- restart 不复活已证明不活动的 Entry；
- cancel UI 有明确结果。

GPU2 Pending Entry Review 是增强判断层，不能替代这一确定性生命周期。

---

## 10. 实施顺序

### Phase 0 — 当前实例预检

- 记录 main SHA、runtime build、settingsVersion；
- 备份 Settings/关键 SQLite；
- 记录 GPU1 Primary 当前 endpoint；
- 找出 GPU2 27B 实际 endpoint/model；
- 记录当前 open Entry/TP/position/order truth。

### Phase 1 — Contracts / Settings migration

- physical AiResource；
- AiDutyRoute；
- legacy role migration；
- route validation；
- tests。

### Phase 2 — Runtime routing

- duty router；
- GPU1 Entry Primary 保持不变；
- GPU2 reviewer resource；
- priority/queue/readback；
- resource health；
- tests。

### Phase 3 — Pending Entry Review

- structured input/output；
- scheduler；
- KEEP/CANCEL/REPLAN；
- 1h deterministic hard deadline；
- exact order identity；
- tests。

### Phase 4 — Position Review

- GPU2 routing；
- review facts；
- AI_EXIT_FACTS_INCOMPLETE root-cause fixes；
- evidence → deterministic exit coordinator；
- resource starvation tests。

### Phase 5 — AI Resources UI

- two-pane resource manager；
- duty routing；
- health/status；
- responsive layout；
- version conflict；
- connection test；
- Dashboard tests。

### Phase 6 — Orders cleanup

- 1h active lifecycle；
- 24h display retention；
- startup/reconciliation convergence；
- cancel UX；
- tests。

### Phase 7 — Deploy

- full verify/typecheck/build；
- commit/push main；
- restart current TESTNET；
- identity closure 6/6；
- Production writes=0；
- runtime resource readback；
- confirm GPU1 Primary still works；
- confirm GPU2 review calls are routed to actual GPU2 endpoint；
- confirm orders/dashboard exchange truth parity。

---

## 11. 验收标准

### AI resources

- 当前 GPU1 Primary 配置/行为未被替换；
- 第二块 RX 7900 XTX 上 27B 作为独立 resource 出现在后台和 Web；
- resource 的实际 endpoint/model 可测试；
- Pending Entry Review → GPU2；
- Position Review → GPU2；
- 一个 GPU2 resource 可同时被两个 duties 引用；
- GPU2 concurrency=1 起步；
- Position review 不被 pending entry review 饿死；
- GPU2 failure 不拖垮 GPU1 Primary；
- Dashboard 不再只有 SCOUT/PRIMARY_BRAIN 单选角色。

### UI

- 资源列表和资源详情分栏；
- 职责路由独立；
- 新增资源不会自动制造错误 SCOUT；
- 保存/测试/删除/dirty/selected 状态清晰；
- 删除 route-in-use resource 有明确错误；
- 1024+ 宽屏和窄屏均可用。

### Order/position AI workflow

- 27B 不直接发送交易所请求；
- pending Entry AI decision 可追踪到 exact order；
- position review 可追踪到 exact physical cycle；
- 1h unfilled Entry hard deadline 与 AI 返回无关；
- AI_EXIT_FACTS_INCOMPLETE 余量可读回；
- reduce-only / identity / exact-once 不退化。

### Deployment

- tests/build/verify pass；
- TESTNET restart 到最终 build；
- identity closure 6/6；
- Production writes=0；
- local/remote main clean。
