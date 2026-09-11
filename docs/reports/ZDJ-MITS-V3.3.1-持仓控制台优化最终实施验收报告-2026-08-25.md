# ZDJ-MITS V3.3.1 持仓控制台优化最终实施验收报告

验收时间：2026-08-25 07:26（Asia/Shanghai）  
版本：ZDJ-MITS V3.3.1 POSITION CONSOLE  
范围：`Codex-5.6-Sol-ZDJ-MITS-V3.3.1-持仓控制台优化执行提示词.md` 与对应实施计划

## 1. 结论

本轮持仓控制台优化已实施完成，生产候选已重新构建、重启并通过真实页面验收与 15 分钟只读 Testnet 烟测，结果 PASS。

Engine 当前状态：READY；版本 3.3.1；行情流 LIVE；私有账户 READY；对账无错误；当前 29 个持仓全部存在 PROTECTED TP。系统继续运行于 `http://127.0.0.1:8080`。

## 2. 已实施内容

- 持仓主表将“当前 PnL”改为“浮动盈亏”，同时单独展示 ROE；正值绿色、负值红色、零值中性，并使用主题 token。
- 持仓详情升级为控制台布局：行情/图表主区约 70%，人工管理区约 30%，窄屏自动堆叠。
- 详情图表默认 15m，支持 1m、5m、15m、4h；数据由 Engine Market Data Hub 提供，包含收盘线及 Entry、Mark、TP 标线，不从前端直连 Binance。
- 新增 Facts、TP、Active Orders、TradeRecord、AI-EIP（只读）、Audit 六个下方标签。
- 新增人工减仓、同向加仓、人工限价、替换 TP、重建 TP、紧急平仓入口；紧急平仓在页面和服务端均要求确认。
- 新增 `ManualIntentSchema`、持久化人工 Intent/Order 投影、幂等键重放保护和审计事件。
- 人工写入统一经过 `ManualIntent → Validation → AccountExecutor → Exchange Adapter → Audit`；校验包括 Testnet 写入门、私有账户 READY、数量/价格精度、最小数量、最小名义价值、方向、reduceOnly、PostOnly 和持仓上限。
- 减仓默认 reduce-only + PostOnly Maker；加仓仅允许当前持仓同方向；紧急平仓先挂起 TP Guardian、撤销 TP、提交 reduce-only 市价单，再触发对账；已确认关闭时补写 MANUAL TradeRecord CLOSED。
- Orders 页面新增人工委托页签，当前标的人工委托可从持仓详情 Active Orders 查看。
- Engine 健康版本标记为 3.3.1；未改动 Market、Pool、AI 的既有架构和调度链。

## 3. 验证证据

### 自动化验证

- `npm run typecheck`：PASS。
- `npm run test`：PASS，14 个测试文件、30 个测试通过。
- `npm run build`：PASS，Dashboard Vite 构建与 Engine TypeScript 构建通过。
- 新增 Binance 手工减仓参数测试：验证 hedge mode 下 `positionSide`、`reduceOnly=true`、`timeInForce=GTX`。
- Mock Testnet 专项链路：验证人工减仓完成、持仓转为 `HUMAN_MANAGED`、同一幂等键重放不重复下单。

### 真实重启与运行状态

- 使用 `scripts/stop-v3.ps1` 停止旧 Engine，使用 `scripts/start-v3.ps1` 启动新构建；新 Engine PID 6200，健康检查 READY。
- 重启后行情流为 LIVE，私有账户为 READY，对账 `lastError=null`。
- 最终状态：29 positions、29 protected TP、5 HUMAN_MANAGED、0 active entry、29 active TP、0 manual active orders；审计事件达到持久化上限 10000。

### 浏览器验收

- 真实打开 `/positions`：确认“浮动盈亏/ROE”、正负颜色语义、默认 15m 图表、Entry/Mark/TP 标线和人工控制台可见。
- 切换 1m 周期成功。
- 打开 AI-EIP（只读）成功展示结果；对证据不足的 PNUTUSDT，页面明确显示 `UNAVAILABLE` 及“evidence missing”，不伪造证据。
- 打开 Facts、TP、Active Orders、TradeRecord、Audit 标签结构成功；减仓表单显示数量/价格/备注和服务端安全校验提示。
- Orders 页面人工委托页签成功显示，当前无活动人工委托。
- 未在真实生产候选页面提交人工交易写操作，避免对现有 Testnet 持仓产生未经必要确认的金融副作用；写链已由 Mock Testnet 专项和服务端参数测试覆盖。

### 15 分钟只读 Testnet 烟测

证据目录：`D:\MITS\data\acceptance-v331-position\20260825-071031`  

- 60/60 样本成功。
- failedSamples=0。
- badReadySamples=0。
- badMarketSamples=0。
- badProtectedPositions=0。
- terminalOrdersInActiveProjection=0。
- PASS=true。

## 4. 已知运行事实

重启前已存在 1 条外部未托管订单漂移；本轮仍按安全原则未擅自撤销，当前对账 driftCount=1、lastError=null。该事实已保留在运行审计和 V3.3.0 交付报告中，不影响本轮持仓控制台代码验收。

个别历史导入持仓可能没有完整 EIP 证据；前端现在明确显示只读 `UNAVAILABLE` 原因，不把缺失证据误报为 READY。

## 5. 交付文件

- 本报告：`D:\MITS\docs\reports\ZDJ-MITS-V3.3.1-持仓控制台优化最终实施验收报告-2026-08-25.md`
- 烟测摘要：`D:\MITS\data\acceptance-v331-position\20260825-071031\summary.json`
- 烟测采样：`D:\MITS\data\acceptance-v331-position\20260825-071031\samples.jsonl`
- 烟测脚本：`D:\MITS\scripts\run-v331-position-smoke.ps1`

## 6. 验收判定

**PASS：V3.3.1 持仓控制台优化已达到生产候选交付条件。**
