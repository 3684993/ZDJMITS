# ZDJ-MITS V3 连接、代理、交易所与 AI 模型持久化补充方案

日期：2026-08-23  
状态：V3 强制基础设施补充规范

## 1. 结论

V3 已经具备统一“系统设置”页面、`GET /api/v3/settings`、`PUT /api/v3/settings`、运行时 `SettingsStore` 和 `data/settings.json` 持久化，但当前主要覆盖智能选币、交易池、建仓质量、方向参考、杠杆、AI策略、Entry Manager、TP 与组合限制。

V3 还必须新增三类生产设置：

1. **交易所连接设置**：Binance USDⓈ-M、环境、Base URL、API Key/Secret、时间同步、recvWindow、连接测试。
2. **代理设置**：SOCKS5H 地址、强制代理策略、DNS 通过代理解析、连接健康检查、故障时 fail-closed。
3. **AI 模型资源设置**：B580 / Qwen3.5-9B Scout 与单个 RX 7900 XTX / Qwen3.8-27B PRIMARY_BRAIN 的 endpoint、model、enabled、并发、超时与健康状态。

从此禁止依赖 `.env` 作为系统配置来源；代码中的 `process.env.*` 只允许保留极少数开发测试开关，生产连接信息必须全部来自持久化设置服务。

---

## 2. 本机默认运行配置

### 2.1 Proxy

- Enabled：`true`
- Type：`SOCKS5H`
- Endpoint：`socks5h://127.0.0.1:20081`
- Force Binance REST Through Proxy：`true`
- Force Binance WebSocket Through Proxy：`true`
- Proxy DNS：`true`
- Localhost Bypass：`true`（127.0.0.1 AI endpoint 不走代理）
- Fail Closed：`true`

原则：只要配置为强制代理，任何 Binance REST / WebSocket 请求都不得绕过代理直连。代理不可用时停止新的交易所网络操作，并在 Dashboard 显示 `PROXY_UNAVAILABLE / TRADING_NETWORK_BLOCKED`。

### 2.2 Binance USDⓈ-M

- Provider：`BINANCE_USDM`
- Environment：`TESTNET`
- Production Base URL：`https://fapi.binance.com`
- API Key：已由用户提供，必须以加密 Secret 保存
- API Secret：已由用户提供，必须以加密 Secret 保存
- API credentials 不写入源码、JSON默认文件、日志、trace、浏览器 LocalStorage 或 `.env`

**重要环境约束**：`TESTNET=true` 时，系统必须使用测试环境的有效交易端点；`https://fapi.binance.com` 只能作为 Production Profile 的默认 Base URL 保存，不能在 Testnet 模式下用于私有真实下单请求。环境和有效 Base URL 必须由后端统一解析，前端不能自行拼接。

### 2.3 AI Resources

#### Scout

- ID：`scout-b580`
- Role：`SCOUT`
- Enabled：`true`
- Endpoint：`http://127.0.0.1:8081/v1`
- Model：`qwen/qwen3.5-9b`
- Max Concurrency：`1`
- GPU：Intel Arc B580
- 权限：只读分析、摘要、缺失证据识别；无交易权限

#### Primary Brain

- ID：`brain-7900-primary`
- Role：`PRIMARY_BRAIN`
- Enabled：`true`
- Endpoint：`http://127.0.0.1:8084/v1`
- Model：`qwen/qwen3.8-27b`
- Max Concurrency：`1`
- GPU：AMD Radeon RX 7900 XTX
- 权限：最终 `PLACE_LONG / PLACE_SHORT / REJECT_CANDIDATE` 及 AI 价格区间判断

#### Second Brain

当前默认：`disabled`。  
因此 `secondBrainReview` 默认必须调整为 `OFF`。将来第二个 27B endpoint 启用后，再切换为 `SELECTIVE`。

---

## 3. 持久化设计：不使用 .env

### 3.1 推荐存储

使用本地：

`data/zdj-settings.sqlite`

至少包含：

- `settings`：普通系统设置 JSON/结构化字段
- `secrets`：加密后的敏感值
- `connection_profiles`：交易所、代理和 AI endpoint 配置
- `settings_audit`：修改时间、字段、旧值摘要、新值摘要、来源

### 3.2 Windows SecretStore

API Key / Secret 使用 Windows DPAPI `CurrentUser` 保护：

`plaintext -> DPAPI Protect -> ciphertext -> SQLite`

运行时：

`SQLite ciphertext -> DPAPI Unprotect -> memory only`

约束：

- `GET /api/v3/settings` 永远不返回 Secret 明文。
- UI 只显示 `已配置 · ****xxxx`。
- 修改凭据使用独立写接口。
- 日志自动 redaction：`apiKey`, `apiSecret`, `signature`, `Authorization`。
- Dashboard state、WebSocket、AI EIP、AI prompt 中不得出现 Binance Secret。

### 3.3 非敏感默认值

Proxy URL、Base URL、AI endpoints、model 名、enabled、超时等可以直接写入默认设置 seed；首次启动时自动写入 SQLite，之后全部从 SQLite 恢复。

API Key/Secret 虽然用户希望作为默认账户长期可用，但物理存储不能硬编码到代码包。首次在目标 Windows 主机执行 V3 初始化时，由初始化器把用户提供的值写入 DPAPI SecretStore；此后重启无需再次输入。

---

## 4. SystemSettings Schema 扩展

建议增加：

```ts
connections: {
  proxy: {
    enabled: true,
    protocol: 'SOCKS5H',
    url: 'socks5h://127.0.0.1:20081',
    forceBinanceRest: true,
    forceBinanceWs: true,
    proxyDns: true,
    bypassLocalhost: true,
    failClosed: true
  },
  exchange: {
    provider: 'BINANCE_USDM',
    environment: 'TESTNET',
    productionBaseUrl: 'https://fapi.binance.com',
    testnetBaseUrl: '<由生产接入阶段按官方当前支持端点确认>',
    credentialRef: 'binance-primary',
    recvWindowMs: 5000,
    autoTimeSync: true
  }
},
aiResources: [
  {
    id: 'scout-b580',
    role: 'SCOUT',
    enabled: true,
    baseUrl: 'http://127.0.0.1:8081/v1',
    model: 'qwen/qwen3.5-9b',
    maxConcurrency: 1
  },
  {
    id: 'brain-7900-primary',
    role: 'PRIMARY_BRAIN',
    enabled: true,
    baseUrl: 'http://127.0.0.1:8084/v1',
    model: 'qwen/qwen3.8-27b',
    maxConcurrency: 1
  }
]
```

---

## 5. Dashboard 设置页面扩展

现有“系统设置”继续保留交易策略参数，并新增三个一级分组。

### 5.1 交易所

显示：

- Binance USDⓈ-M
- TESTNET / PRODUCTION 切换
- 当前 Effective Base URL
- API Key：掩码
- API Secret：仅显示“已配置/未配置”
- `测试连接`
- Server Time 偏差
- Account API 状态
- ExchangeInfo 状态
- Futures permission 状态

保存 Secret 时要求后端加密，前端不可缓存。

### 5.2 网络代理

显示：

- Enable Proxy
- SOCKS5H URL
- 强制 REST
- 强制 WS
- Proxy DNS
- Localhost bypass
- Fail closed
- `测试代理`
- `测试 Binance 经代理连接`
- 最近延迟 / 最近错误

### 5.3 AI 模型

每个资源显示卡片：

- GPU
- Role
- Endpoint
- Model
- Enabled
- MaxConcurrency
- Health
- `/models` 探测
- Chat completion smoke test
- 最近 latency / tokens / error

默认只显示两个启用资源：B580 9B + 7900 27B。

---

## 6. API 扩展

保留：

- `GET /api/v3/settings`
- `PUT /api/v3/settings`

新增：

- `GET /api/v3/settings/connections`
- `PUT /api/v3/settings/connections`
- `PUT /api/v3/settings/exchange/credentials`
- `POST /api/v3/settings/proxy/test`
- `POST /api/v3/settings/exchange/test`
- `GET /api/v3/ai/resources`
- `PUT /api/v3/ai/resources`
- `POST /api/v3/ai/resources/:id/test`

Secret 写接口返回：

```json
{"configured":true,"last4":"****"}
```

绝不返回 Secret。

---

## 7. BinanceTransport：强制 SOCKS5H

必须新增统一 `BinanceTransport`，成为所有 Binance 网络流量唯一出口：

```text
Market Data Adapter ─┐
Private REST Adapter ├─> BinanceTransport ─> SOCKS5H ─> Binance
User Data WS ────────┤
Market WS ───────────┘
```

规则：

1. 禁止各模块自己 `fetch('https://fapi...')`。
2. REST 与 WebSocket 共享 ProxyPolicy。
3. SOCKS5H 必须让域名解析通过代理，避免本地 DNS/分流导致证书域名错误。
4. 代理不可用且 `failClosed=true` 时，不允许 fallback 直连。
5. localhost AI endpoint 明确 bypass proxy。
6. 健康状态必须进入 `/api/v3/snapshot` 与 Dashboard Runtime Health。

---

## 8. 启动顺序与重启恢复

V3 启动：

```text
打开 zdj-settings.sqlite
→ 解密 SecretStore
→ Validate Settings Schema
→ 创建 ProxyPolicy
→ Proxy health check
→ 解析 Binance effective environment/base URL
→ Binance server time / exchangeInfo / account health
→ 探测 8081 Qwen3.5-9B
→ 探测 8084 Qwen3.8-27B
→ 初始化 Market Data Hub
→ Reconciliation
→ Dynamic Pool
→ Entry Pipeline READY
```

任一关键交易所前置条件失败：

- Dashboard 可以启动；
- 市场/AI状态可继续观察；
- 自动 Entry 必须 `BLOCKED_BY_INFRASTRUCTURE`；
- 不能偷偷绕过 SOCKS 直连。

这样保证 Windows 重启后不依赖重新设置环境变量，也不依赖手工重新输入 API Key。

---

## 9. 当前 V3 必须删除/改造的环境变量依赖

当前基础包仍存在以下生产不合规用法，必须改造：

- `ZDJ_BINANCE_MARKET_BASE`
- `ZDJ_AI_API_KEY`
- `ZDJ_DATA_MODE`
- `ZDJ_AI_MODE`
- `ZDJ_TRADING_ADAPTER`

以及 `.env.example`。

目标：生产连接配置全部由 `SettingsRepository + SecretStore + ConnectionProfileService` 提供。

允许保留的仅是开发启动类开关，例如 `NODE_ENV=test`，且不得包含交易凭据、代理、交易所 URL 或模型 endpoint。

---

## 10. Codex 5.6 Terra 插入任务

将本补充任务放在正式 Binance 私有交易接入之前完成。

### Prompt

请在 ZDJ-MITS V3 主线实现“持久化连接配置层”。

不可改变 V3 的选币、EIP、AI权限、Entry、Position/TP 状态机。先调查当前 `SystemSettingsSchema`、`SettingsStore`、`SettingsView.vue`、`OpenAiCompatibleClient`、`BinancePublicMarketDataProvider`、runtime 启动链和所有 `process.env` 使用点。

必须实现：

1. `data/zdj-settings.sqlite` 持久化设置；
2. Windows DPAPI SecretStore 保存 Binance API Key/Secret；
3. System Settings UI 增加“交易所 / 网络代理 / AI模型”三个区域；
4. 默认 SOCKS5H `socks5h://127.0.0.1:20081`，Binance REST/WS 强制代理，fail-closed，localhost AI bypass；
5. 默认 Scout `http://127.0.0.1:8081/v1` + `qwen/qwen3.5-9b`；
6. 默认 Primary Brain `http://127.0.0.1:8084/v1` + `qwen/qwen3.8-27b`；
7. 当前只有一个 PRIMARY_BRAIN，默认 `secondBrainReview=OFF`；
8. Binance environment 默认 TESTNET，生产 Base URL profile 保存为 `https://fapi.binance.com`，但 TESTNET 时绝不可对生产私有交易端点发送订单；
9. 新增连接测试/健康状态 API；
10. 所有 Secret 在日志/API/WebSocket/AI prompt 自动脱敏；
11. 删除生产连接对 `.env` 和 `process.env` 的依赖；
12. 重启进程后必须从持久化设置恢复全部连接，不需要重新输入。

验收必须证明：

- 无 `.env` 交易配置；
- 全仓搜索不存在生产代码读取 Binance Secret/Proxy/AI endpoint 的 `process.env`；
- 断开 SOCKS 后 Binance 请求 fail-closed，无直连；
- 恢复 SOCKS 后连接健康恢复；
- 8081/8084 探测正确；
- Secret API 不返回明文；
- 重启后 settings 与 credentials 可恢复；
- typecheck/test/build 全通过。

