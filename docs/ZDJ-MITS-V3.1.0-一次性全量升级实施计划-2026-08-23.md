# ZDJ-MITS V3.1.0 一次性全量升级实施计划

日期：2026-08-23  
目标版本：`3.1.0`  
实施方式：**一次性完成，不拆 Stage，不以局部完成为结束条件**

## 1. 本次版本目标

V3.1.0 的目标不是继续增加功能数量，而是把当前系统从“功能骨架可运行”收敛为“配置可用、数据真实、界面可信、启动方式明确、可以直接进行 Binance Futures Testnet 运行观察”的完整产品版本。

本次升级完成后必须同时满足：

1. 系统设置页任何情况下都能打开，绝不出现空白页。
2. 系统设置包含交易策略、Binance、SOCKS5H 代理、AI 模型资源、主题外观五大区域。
3. 主题可以实时切换、服务端持久化、刷新和重启后保持。
4. 正常运行模式彻底禁止 Mock 行情、Mock 账户、Mock 持仓、Mock AI、Mock 订单冒充真实数据。
5. 未配置或连接失败时，Dashboard 显示“未配置/不可用/等待真实数据”，不得显示 10000 USDT、虚假持仓、虚假订单或虚假交易池。
6. Binance 公共行情、私有账户、持仓、订单、User Data WS、Reconciliation 都有明确来源、时间戳、freshness 和 readiness。
7. 所有 Binance REST/WS 必须经过 `socks5h://127.0.0.1:20081`，代理失败时 fail-closed，禁止自动直连。
8. 本地 AI：8081 Scout、8084 PRIMARY_BRAIN，localhost 请求不走代理；AI 不可用时禁止使用 Mock 决策替代。
9. 生产启动命令统一为 `npm run build` + `npm start`，并提供 `npm run verify`、`npm run dev`、`npm run acceptance`。
10. Dashboard 8080 由 Engine 同源托管生产构建；开发模式 Vue 为 5173，API/WS 代理到 8080。
11. 版本号统一升级为 `3.1.0`，所有 package、health/version、UI version 一致。

---

## 2. 对当前 `MITS.tar` 的代码审查结论

### 2.1 已符合目标的基础能力

当前代码已经具备以下可继续保留的核心：

- Vue 3 + Pinia + Vue Router + ECharts 的 Dashboard 框架。
- Engine 同源托管 Dashboard `dist`。
- `/api/v3` 与 WebSocket 基础边界。
- SQLite 设置、运行状态、审计与 WAL 基础。
- Windows DPAPI SecretStore 接口。
- Binance SOCKS5H Transport。
- Binance Shared Market WS、User Data WS 的基础实现。
- Binance Testnet 私有签名适配器、GTX Maker Entry/TP、撤单、改价、杠杆、Open Orders、Position Risk。
- Universe、Dynamic Pool、EIP 3.0、9B Scout、27B PRIMARY_BRAIN、Maker Pricing、TP、Reconciliation。
- 自动止损路径不存在，继续保持。

### 2.2 当前必须修复的产品级问题

#### A. 正常运行仍以 Mock 为默认事实源

`config/settings.default.json` 当前：

```json
"marketDataMode": "MOCK",
"executionMode": "MOCK",
"aiMode": "MOCK"
```

这会导致系统即使没有真实 Binance/AI 配置，也能产生看似正常的行情、账户、持仓、Entry 与结果，和实际产品要求冲突。

**V3.1.0 要求：Mock 只允许测试代码显式依赖注入，禁止成为正常应用运行模式。**

#### B. RuntimeState 默认账户是假数据

当前存在：

```ts
account = { equityUsd: 10000, availableUsd: 10000, realizedPnlUsd24h: 0 }
```

因此没有连接 Binance 私有账户时，总览仍可能展示 10000 USDT，这属于错误产品事实。

V3.1.0 必须改为可用性驱动的 nullable account projection；没有真实账户数据时显示 `—` 和明确原因。

#### C. Settings 页存在结构性空白页条件

当前 Settings 页面根节点使用：

```vue
<div v-if="draft">
```

`draft` 又依赖全局 `/snapshot` 中的 settings。只要 snapshot 尚未加载、发生错误或没有 ready，整个页面没有 loading/error/fallback，于是用户只看到空白内容区。

这形成配置 UX 反向依赖：**恰恰在系统连接未配置时，设置页面最容易无法使用。**

V3.1.0 必须让 Settings 使用独立设置 API 自举，不依赖交易 snapshot。

#### D. Dashboard `src` 中存在重复生成 `.js` 文件

当前 `apps/dashboard/src` 同时存在：

- `main.ts` / `main.js`
- `router.ts` / `router.js`
- `api/client.ts` / `api/client.js`
- `stores/system.ts` / `stores/system.js`
- 多个 `.vue.js`

这会产生模块解析歧义和陈旧代码被优先加载的风险。Vite 默认解析顺序中 `.js` 可能先于 `.ts`。

**V3.1.0 必须清除 src 内生成 JS，只保留 TypeScript/Vue 源码；生成文件只能进入 `dist`。**

#### E. 私有账户事实不完整

当前 Adapter 有 Open Orders 和 Position Risk，但 Runtime account 没有来自 Binance Account API 的真实权益/可用余额/保证金事实，User Data ACCOUNT_UPDATE 也没有形成完整账户 projection。

必须补齐：

- Account information snapshot
- walletBalance / availableBalance / marginBalance / unrealizedPnl
- position/order/account user stream 更新
- REST + WS authoritative merge
- reconciliation 后才把账户标为 READY

#### F. UI 仍把当前机器描述成“三 GPU / 双主脑”

当前实际启用只有 8081 Scout + 8084 单 PRIMARY_BRAIN。页面标题必须动态读取资源，不允许写死“三GPU”或“双 PRIMARY_BRAIN”。

---

## 3. 正式运行模式重新定义：真实数据优先，禁止假数据

### 3.1 删除普通运行的 Mock 模式选择

系统正常运行只保留：

- `marketDataProvider = BINANCE`
- `aiProvider = OPENAI_COMPATIBLE`
- `executionState = READ_ONLY | TESTNET_ENABLED`

Mock Adapter 继续存在，但只能由：

- unit test
- integration test
- acceptance fixture

通过构造参数显式注入，不能从 Dashboard 设置中打开，也不能作为启动 fallback。

### 3.2 Fail-Visible，而不是 Fake-Success

任何真实数据不可用时：

| 情况 | UI 行为 |
|---|---|
| Binance Public 未连接 | 市场/Universe 显示“行情未就绪”，提供设置入口 |
| API Key 未配置 | 权益/可用资金/持仓显示 `—`，显示“请配置 Binance Testnet 凭据” |
| DPAPI 不可用 | 凭据区域显示 BLOCKED，禁止 EXTERNAL 写入 |
| Proxy 不可用 | Binance 全链路 OFFLINE，禁止直连 fallback |
| 8081 不可用 | Scout OFFLINE，候选决策暂停或按明确策略阻断 |
| 8084 不可用 | PRIMARY_BRAIN OFFLINE，禁止产生 Entry |
| Reconciliation 未完成 | Positions/Orders 显示 SYNCING，不宣称 authoritative |
| 数据 stale | 显示 STALE，不继续使用为新 Entry 证据 |

### 3.3 数据来源与新鲜度

DashboardSnapshot 为所有重要区域增加：

```ts
source: 'BINANCE_TESTNET' | 'LOCAL_PERSISTENCE' | 'UNAVAILABLE'
asOf: number | null
freshness: 'FRESH' | 'STALE' | 'SYNCING' | 'UNAVAILABLE'
reason?: string
```

账户、持仓、订单、市场、AI、Reconciliation 都必须有 provenance。

---

## 4. 系统设置页彻底重构

### 4.1 设置页必须独立自举

SettingsView 不再依赖 `snapshot.settings`。

页面 mount 时分别调用：

- `GET /api/v3/settings`
- `GET /api/v3/settings/connections`
- `GET /api/v3/settings/readiness`
- `GET /api/v3/themes`

使用 `Promise.allSettled`，任何一个请求失败都必须显示对应区域错误，页面框架仍可操作。

必须包含：

- loading skeleton
- zone-level error state
- retry
- server unavailable state
- save success/error feedback
- 未配置 CTA

### 4.2 五大设置区域

#### ① 策略与执行

- 智能选币模式
- Universe Top N
- Pool Target / Max
- Entry Profile
- Direction Reference
- Leverage
- Entry Margin
- Entry TTL / Reprice / Reachability
- TP
- 自动止损禁用说明

#### ② Binance Futures Testnet

- Environment（默认且当前只允许 TESTNET 写）
- Effective REST URL
- Effective WS URL
- Credential configured/masked
- API Key / Secret 输入（不回显）
- DPAPI 状态
- Server time
- Private account auth
- User Data WS 状态
- Reconciliation 状态
- 测试公共连接
- 测试私有连接
- 保存凭据

#### ③ SOCKS5H Proxy

默认：`socks5h://127.0.0.1:20081`

显示：

- Enabled
- Force REST
- Force WS
- Proxy DNS
- Fail Closed
- localhost bypass
- latency
- DNS/证书目标验证
- 最近错误
- 一键测试

#### ④ AI 模型资源

动态显示当前资源，不写死 GPU 数量：

- Scout / 8081 / qwen3.5-9B
- Primary Brain / 8084 / qwen3.8-27B
- enabled
- model
- endpoint
- `/models` health
- JSON schema completion health
- latency
- queue/active/total/failures

#### ⑤ 外观与主题

新增持久化设置：

```ts
appearance: {
  theme: ThemeId,
  density: 'COMFORTABLE' | 'COMPACT',
  numberFont: 'SYSTEM' | 'TABULAR'
}
```

主题选择后立即实时变化，并保存至服务端；同时把 theme id 缓存在 localStorage，在 Vue mount 前应用，避免刷新闪白。

---

## 5. V3.1.0 内置高级主题

所有主题均采用三主色 + 语义色分离。涨跌颜色仍为独立语义 token，不强行等于主色。

### Theme A — Exchange Noir / 暗金交易所

- Obsidian：`#101318`
- Bullion Amber：`#E8B923`
- Cloud Gray：`#F2F4F7`

定位：暗色专业交易终端，高级但不工业。

### Theme B — USD Reserve / 美元储备

- Federal Navy：`#0B1F3A`
- Treasury Green：`#13795B`
- Ivory：`#F5F2E8`

定位：美元、银行、资产管理风格。

### Theme C — RMB Jade / 人民币玉玺

- Deep Crimson：`#A61B2B`
- Jade Green：`#0F6B5B`
- Porcelain：`#F7F2EA`

定位：人民币、高级东方金融风格；避免大面积高饱和红色。

### Theme D — Bullion Gold / 黄金资产

- Carbon：`#151515`
- Bullion Gold：`#C9A227`
- Champagne：`#F4E9C9`

定位：贵金属、家族办公室、财富管理。

### Theme E — Sapphire Quant / 蓝宝石量化

- Midnight：`#0E1A2B`
- Sapphire：`#2F6BFF`
- Silver：`#E8EDF5`

定位：现代主流专业量化 SaaS。

### Theme F — Graphite Pearl / 石墨珍珠

- Graphite：`#1C222B`
- Slate：`#64748B`
- Pearl：`#F8FAFC`

定位：极简、长期监控、低视觉疲劳。

### 主题实现要求

所有组件只允许引用 design tokens：

```css
--bg
--surface
--surface-elevated
--text
--text-muted
--line
--accent
--accent-soft
--positive
--negative
--warning
--info
--shadow
```

禁止页面组件硬编码主题颜色。

---

## 6. Overview / Position / Order 的真实数据修复

### 6.1 Account 不再默认 10000

修改 RuntimeState：

```ts
account: {
  status: 'UNAVAILABLE' | 'SYNCING' | 'READY' | 'STALE',
  equityUsd: number | null,
  availableUsd: number | null,
  walletBalanceUsd: number | null,
  unrealizedPnlUsd: number | null,
  realizedPnlUsd24h: number | null,
  source: ...,
  asOf: number | null,
  reason?: string
}
```

### 6.2 Binance Account Adapter

新增/完善：

- `fetchAccountSnapshot()`
- server-time signed account query
- normalize USDT/USDC assets
- availableBalance / walletBalance / marginBalance
- totalUnrealizedProfit
- positions
- User Data WS `ACCOUNT_UPDATE`

必须由 Codex 根据当前 Binance Futures Testnet 官方接口实际验证字段，不得凭记忆硬编码未经验证的 schema。

### 6.3 Reconciliation 启动门

Engine 启动：

```text
Settings loaded
→ Proxy readiness
→ Binance public readiness
→ Market bootstrap
→ AI readiness
→ Credential status
→ Private account bootstrap（若已配置）
→ User Data WS
→ Reconciliation
→ Runtime READY
```

如果没有凭据：

- 系统可以 READ_ONLY 运行真实公共行情 + AI健康
- Account/Positions/Private Orders = NOT_CONFIGURED
- Entry 写入严格禁止
- Dashboard 明确引导设置

### 6.4 Overview UI

账户字段不可用时显示：

```text
账户权益     —
Binance Testnet 凭据未配置
[前往系统设置]
```

禁止 `?? 0` 把无数据变成 `$0.00`。

Positions 无 private readiness 时：

```text
尚未加载真实持仓
请完成 Binance Testnet 凭据和代理连接验证
```

不是“当前无持仓”。

只有 authoritative private sync 完成且确实 0 positions，才显示“当前无持仓”。

Orders、Memory 同理区分：

- 无配置
- 同步中
- 真正为空

---

## 7. Connection Readiness 统一模型

新增服务端 projection：

`GET /api/v3/settings/readiness`

示例：

```json
{
  "overall": "NEEDS_CONFIGURATION",
  "proxy": {"status":"READY","latencyMs":22},
  "market": {"status":"READY","source":"BINANCE_TESTNET"},
  "credentials": {"status":"NOT_CONFIGURED"},
  "privateAccount": {"status":"BLOCKED","reason":"credentials missing"},
  "userDataWs": {"status":"BLOCKED"},
  "scout": {"status":"READY"},
  "primaryBrain": {"status":"READY"},
  "reconciliation": {"status":"WAITING_PRIVATE_AUTH"},
  "trading": {"status":"BLOCKED"}
}
```

Dashboard 顶部增加全局状态条：

- READY
- READ_ONLY
- NEEDS_CONFIGURATION
- DEGRADED
- OFFLINE

点击可直接进入 Settings 对应问题区域。

---

## 8. 启动、构建与脚本规范化

当前 `MITS.tar` 没有包含根目录 `package.json`、`scripts/`、`docs/`，因此无法从 tar 独立证明当前根命令定义。V3.1.0 必须把启动约定标准化并纳入仓库。

根 `package.json` 至少提供：

```json
{
  "scripts": {
    "dev": "...启动 Engine dev + Dashboard Vite...",
    "build": "npm run build -ws --if-present",
    "start": "npm run start -w @zdj/engine",
    "typecheck": "npm run typecheck -ws --if-present",
    "test": "npm run test -ws --if-present",
    "verify": "npm run typecheck && npm run test && npm run build",
    "acceptance": "powershell -ExecutionPolicy Bypass -File scripts/run-acceptance.ps1"
  }
}
```

### 用户最终只需要记住

首次/代码更新后：

```powershell
cd D:\MITS
npm install
npm run verify
npm run build
npm start
```

正常日常启动（已经 build）：

```powershell
cd D:\MITS
npm start
```

访问：

```text
http://127.0.0.1:8080
```

开发模式：

```powershell
npm run dev
```

开发 Dashboard 默认：

```text
http://127.0.0.1:5173
```

### 启动脚本

新增：

- `scripts/start-v3.ps1`
- `scripts/stop-v3.ps1`
- `scripts/status-v3.ps1`

`start-v3.ps1` 必须：

1. 检查 20081 / 8081 / 8084。
2. 检查 8080 占用。
3. 如果占用者不是 MITS，不擅自 kill，明确报错。
4. 确认 dashboard dist 存在，否则 build。
5. 启动 Engine。
6. 等待 `/health`。
7. 输出唯一实际 Dashboard URL、PID、模式和 readiness。

---

## 9. 前端工程清理

必须删除：

- `apps/dashboard/src/**/*.js`
- `apps/dashboard/src/**/*.vue.js`
- source tree 中的生成文件
- `tsconfig.tsbuildinfo` 不应成为交付源码的一部分（可 gitignore）

保留：

- `.ts`
- `.vue`
- `.css`

增加 lint/build 检查，发现 src 生成 JS 时失败。

---

## 10. UI 产品化修正

### Sidebar / Topbar

- 当前导航结构可保留。
- 品牌区适配所有主题。
- 顶部显示全局 readiness，而不是仅 selection mode。
- AI 资源标题动态化，不写死三 GPU。

### Settings 空白保护

即使 Engine API 完全不可达，Settings 页面仍必须渲染：

```text
系统设置
服务端暂不可用
[重试]

本机期望地址：http://127.0.0.1:8080
```

不得空白。

### Empty State 语义

统一三种：

1. `NOT_CONFIGURED` — 去设置
2. `SYNCING/LOADING` — 等待事实
3. `EMPTY` — 真实已确认为空

禁止混用。

---

## 11. API / Contract 变更

更新 `@zdj/contracts`：

- AppearanceSettings
- ThemeId
- RuntimeReadiness
- DataProvenance
- AccountProjection（nullable）
- PrivateDataStatus

DashboardSnapshot 增加：

```ts
readiness
provenance
accountStatus
```

设置 API：

- `GET /api/v3/settings`
- `PUT /api/v3/settings`
- `GET /api/v3/settings/connections`
- `PUT /api/v3/settings/connections`
- `GET /api/v3/settings/readiness`
- `PUT /api/v3/settings/exchange/credentials`
- `POST /api/v3/settings/proxy/test`
- `POST /api/v3/settings/exchange/public/test`
- `POST /api/v3/settings/exchange/private/test`
- `POST /api/v3/ai/resources/:id/test`
- `GET /api/v3/themes`

所有 Secret API 永不返回 secret 原文。

---

## 12. Mock 禁用的代码级硬门

### 正常入口禁止

`EngineRuntime.create()` 正常调用不再依据持久化设置创建 Mock adapter。

建议工厂：

```ts
EngineRuntime.createProduction(...)
EngineRuntime.createTestHarness({market,exchange,ai,...})
```

生产入口只能调用 createProduction。

### 自动验收

增加测试：

- production runtime source scan 无 `new MockMarketDataProvider`
- production runtime source scan 无 `new MockExchangeAdapter`
- production AI 无 MockAi fallback
- credentials missing => no account numbers / no positions / no entry writes
- proxy failed => Binance requests blocked

---

## 13. 必须补充的测试

### Dashboard

1. Settings 在 snapshot 失败时仍显示。
2. connections API 失败只影响对应区块。
3. theme 点击实时生效。
4. theme reload 后保持。
5. NOT_CONFIGURED 不显示 `$0.00`。
6. READY + 0 positions 才显示“当前无持仓”。
7. resource title 不写死 GPU 数量。

### Engine

1. Account 默认不可用而非 10000。
2. no credentials private gate。
3. private account REST normalization。
4. User Data ACCOUNT_UPDATE projection。
5. reconciliation authoritative merge。
6. proxy fail closed。
7. no mock fallback。
8. readiness state transitions。
9. settings/readiness API。
10. appearance persistence。

### End-to-end

至少覆盖：

```text
No credentials
→ Dashboard loads
→ Settings loads
→ Public Binance data visible
→ Account unavailable with correct CTA
→ Save credentials
→ Private test ready
→ Restart
→ DPAPI decrypt
→ Account/Positions synchronize
→ Dashboard updates
```

---

## 14. 一次性实施完成标准

Codex 不得以“完成一部分”为结束条件。只有以下全部成立才允许结束：

- [ ] 版本统一为 3.1.0
- [ ] Settings 页面不再空白
- [ ] 五区设置完成
- [ ] 六套主题完成并实时切换/持久化
- [ ] src 重复 JS 清理完成
- [ ] Mock 从正常运行链完全移除
- [ ] 账户默认假 10000 删除
- [ ] Binance Public/Private readiness 完成
- [ ] Overview/Positions/Orders 不再用假数据或 `??0` 掩盖缺失
- [ ] private account projection 完成
- [ ] User Data / reconciliation 事实接入完成
- [ ] 全局 readiness / 配置 CTA 完成
- [ ] 代理 fail-closed 且 localhost AI bypass
- [ ] 8081/8084 动态健康状态完成
- [ ] root build/start/dev/verify/acceptance 命令标准化
- [ ] start/stop/status PowerShell 完成
- [ ] typecheck 全通过
- [ ] tests 全通过
- [ ] production build 全通过
- [ ] run-acceptance.ps1 PASS
- [ ] 正常启动 `npm start` 后 Dashboard 8080 可访问
- [ ] 没有任何 Secret 泄露
- [ ] 没有自动止损路径
- [ ] 没有 Production private write

若 DPAPI 当前执行会话仍因 OS profile 无法完成真实 Secret round-trip，仅此一项允许标为 external gate；但所有代码、UI、接口、测试必须完成，不得因此停止其它工作。

---

## 15. 最终交付报告格式

只输出一次最终报告：

```text
Version: 3.1.0
Build: PASS/FAIL
Typecheck: PASS/FAIL
Tests: PASS/FAIL
Acceptance: PASS/FAIL
Dashboard: URL
Engine PID:
Runtime readiness:
Proxy:
Binance Public:
Binance Private:
Scout 8081:
Primary Brain 8084:
Mock production paths: 0
Settings page: PASS
Themes: 6/6
Account provenance:
Position provenance:
Remaining external gates:
```

