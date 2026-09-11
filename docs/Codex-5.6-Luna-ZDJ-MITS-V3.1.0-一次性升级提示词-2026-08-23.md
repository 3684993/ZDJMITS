# Codex 5.6 Luna — ZDJ-MITS V3.1.0 一次性升级提示词

在 `D:\MITS` 继续开发 ZDJ-MITS。先读取当前真实代码、`docs/implementation-progress.md`、现有测试和本次 `ZDJ-MITS-V3.1.0-一次性全量升级实施计划-2026-08-23.md`。

本轮目标：**一次性完成 V3.1.0，不拆阶段，不完成一个子任务就停，不以写计划代替实施。**

先对实施计划逐项用真实代码判断 `ACCEPT / MODIFY / ALREADY_IMPLEMENTED / REJECT`；若计划细节与当前代码冲突，基于证据自行修正，但不得改变以下产品硬原则：

1. 正常系统运行彻底禁止 Mock 行情、Mock 账户、Mock 持仓、Mock AI、Mock 订单冒充真实数据。Mock 只能显式用于 test harness。
2. 没有真实数据时显示 `NOT_CONFIGURED / SYNCING / UNAVAILABLE / STALE` 和配置引导，禁止用 `0`、`10000 USDT` 或模拟持仓填充界面。
3. Settings 页面必须独立自举，不依赖 `/snapshot` 才能打开；API 异常时也必须显示设置框架、错误和重试，绝不允许空白页。
4. 系统设置完整实现：策略与执行 / Binance Testnet / SOCKS5H / AI模型资源 / 外观主题。
5. 六套主题一次实现并实时切换、持久化：Exchange Noir、USD Reserve、RMB Jade、Bullion Gold、Sapphire Quant、Graphite Pearl。所有页面只使用 design tokens，禁止组件硬编码主题颜色。
6. Binance REST/WS 全部强制 `socks5h://127.0.0.1:20081`；代理故障 fail-closed，禁止直接 fallback。127.0.0.1:8081/8084 AI 不走代理。
7. 当前 AI 拓扑只有 8081 Qwen3.5-9B Scout + 8084 Qwen3.8-27B PRIMARY_BRAIN；UI不得写死“三GPU/双主脑”。AI不可用时禁止 Mock AI 替代。
8. Binance Testnet private 写必须受 DPAPI凭据、代理、TESTNET endpoint、readiness gate 共同保护；Production private write 继续硬禁用。
9. Account/Positions/Orders 必须来自 Binance authoritative facts + User Data WS + reconciliation；私有数据未ready时不得显示“当前无持仓”，而是说明为什么不可用。
10. 删除 RuntimeState 默认 `10000 USDT` 假账户，账户字段允许 null，并带 source/asOf/freshness/reason。
11. 删除 `apps/dashboard/src` 下生成的 `.js` / `.vue.js` 等重复源文件，禁止陈旧 JS 抢先于 TypeScript 被 Vite 解析。
12. AI只负责入场判断和价格区间；Entry Manager负责最终Maker价；TP确定性管理；禁止新增任何自动止损链路。

必须一并完成：

- `GET /api/v3/settings/readiness` 统一 readiness projection。
- Binance public/private connection test 分离。
- DPAPI状态、credential masked状态、User Data WS、reconciliation状态进入Settings。
- Binance真实 account snapshot / balance / availableBalance / unrealized PnL projection。
- ACCOUNT_UPDATE/ORDER_TRADE_UPDATE 与REST reconciliation形成 authoritative read model。
- Overview/Positions/Orders/Operations 全部改成 provenance-aware UI。
- 顶部全局 READY / READ_ONLY / NEEDS_CONFIGURATION / DEGRADED / OFFLINE 状态。
- Settings 每一区独立 loading/error/retry/save feedback。
- theme 选择在点击时即时改变，并在刷新/重启后保持；localStorage仅用于首屏无闪烁，服务端设置为source of truth。
- root `package.json` 标准化 `dev / build / start / typecheck / test / verify / acceptance`。
- 新增 `scripts/start-v3.ps1`、`stop-v3.ps1`、`status-v3.ps1`；启动后明确输出 PID、Dashboard URL、readiness、Proxy、Binance、8081、8084。
- 版本统一改为 `3.1.0`。

正常用户命令最终必须是：

```powershell
cd D:\MITS
npm run verify
npm run build
npm start
```

Dashboard：`http://127.0.0.1:8080`

开发模式提供 `npm run dev`；Vue dev server 可使用5173并代理 API/WS 到8080。

实施过程中持续执行：

`调查真实链路 → 修改 → 定向测试 → typecheck → tests → build → 实际启动 → API/UI验证 → 修复 → 继续下一个未完成项`

**只要实施计划中的任一普通开发项仍未完成，就禁止结束。** 不要每完成一部分就给总结；把进度写入 `docs/implementation-progress.md` 后继续。

最终必须实际运行并验证：

- Settings `/settings` 能显示全部五区。
- 六套主题实时切换。
- 无凭据场景不出现任何假账户/假持仓/假订单。
- 公共行情真实 Binance 数据正常。
- Proxy test 正常。
- 8081/8084 health 正常。
- 有凭据时 private account/user WS/reconciliation 正常；当前会话若DPAPI被OS阻断，只将它作为唯一external gate，不允许阻塞其它实现。
- `npm run verify` PASS。
- `npm run build` PASS。
- `npm run acceptance` PASS。
- `npm start` 后 8080 Dashboard 实际可打开。
- 搜索确认 production runtime 没有 Mock fallback。
- 搜索确认没有自动止损执行链、没有Production私有写入口、没有Secret泄露。

最终只给一次简洁报告：版本、实际修改、Settings结果、六主题结果、真实数据来源、Mock清零结果、Binance/Proxy/AI readiness、测试/build/acceptance、启动命令、Dashboard地址、唯一external gate。

现在直接实施，不要先输出计划。
