# ZDJ-MITS V3.3.2 持仓浮动盈亏红绿颜色与行内控制台热修复验收报告

验收日期：2026-08-25  
验收结论：PASS

## 1. 范围与文档指令区分

本次实施以以下两个文档作为实施约束：

- `D:\MITS\docs\Codex-5.6-Sol-ZDJ-MITS-V3.3.2-持仓红绿颜色-行内控制台热修复提示词.md`
- `D:\MITS\docs\ZDJ-MITS-V3.3.2-持仓浮动盈亏红绿颜色-行内控制台修复实施计划.md`

文档要求聚焦前端热修复、保持 V3.3.1 后端和交易执行链路不变；用户本轮新增要求是“为持仓界面增加分页功能”。因此本次只修改 Dashboard 持仓展示/交互、样式和前端回归测试，没有改动 Market、Pool、AI、Scheduler、Entry、ManualIntent、AccountExecutor、Audit、Reconciliation、TP Guardian 或 TradeRecord 后端架构，也没有提交任何真实交易指令。

## 2. 红绿颜色根因与修复

### 2.1 真实浏览器根因

修复前通过真实页面 DOM、匹配 CSS 和 `getComputedStyle` 取证：

- 负浮动盈亏元素实际为 `<td class="neg">...</td>`。
- 在 Dunhuang Finance 主题下，负值 computed color 为 `rgb(72, 43, 30)`，没有呈现固定亏损红色。
- 最终覆盖来自主题规则 `.data-table td { color: var(--text) !important; }`。
- 该通用 `!important` 规则压过了 `.neg` 的语义颜色，造成主题文字色覆盖金融盈亏色。

### 2.2 实施内容

- 新增 `apps/dashboard/src/financial-semantics.css`：
  - `--financial-profit: #0f9f6e`
  - `--financial-loss: #cf3444`
  - `--financial-neutral: #758196`
  - `.financial-profit`、`.financial-loss`、`.financial-neutral`
- 将最终 PnL 与 ROE 数字 DOM 直接绑定上述金融语义 class。
- 移除主题 `.data-table td` 的颜色 `!important`，保留边框优先级，避免再次覆盖金融语义颜色。
- 正数、负数、零值、空值和 NaN 由 `financialClass()` 统一判定；生产页面没有人为伪造正数持仓，正/中性/异常值由组件测试覆盖。

### 2.3 五主题真实浏览器结果

PNUTUSDT、ZECUSDT、ETHUSDC 的负 PnL/ROE 在以下主题均保持：

| 主题 | PnL class | PnL computed color | ROE class | ROE computed color |
|---|---|---|---|---|
| Binance Noir | `financial-loss` | `rgb(207, 52, 68)` | `financial-loss` | `rgb(207, 52, 68)` |
| Dunhuang Finance | `financial-loss` | `rgb(207, 52, 68)` | `financial-loss` | `rgb(207, 52, 68)` |
| Institutional Blue | `financial-loss` | `rgb(207, 52, 68)` | `financial-loss` | `rgb(207, 52, 68)` |
| Quiet Morning | `financial-loss` | `rgb(207, 52, 68)` | `financial-loss` | `rgb(207, 52, 68)` |
| Burgundy Editorial | `financial-loss` | `rgb(207, 52, 68)` | `financial-loss` | `rgb(207, 52, 68)` |

## 3. 行内控制台与分页

- 新增 `apps/dashboard/src/components/PositionConsole.vue`，保留原详情控制台的图表时间周期、Entry/Mark/TP 标记、减仓/加仓/限价/止盈/重建/紧急平仓入口以及 Facts、TP、Active Orders、TradeRecord、AI-EIP、Audit 只读页签。
- 持仓详情改为当前表格行正下方的 full-width inline row，保持约 70/30 图表与管理区布局；窄屏自动堆叠。
- 同一时刻只允许一个控制台展开：点击同一标的收起，点击另一个标的替换并保持紧邻新标的；异步请求使用序列令牌，避免切换标的时旧响应覆盖新内容。
- 新增分页：默认每页 10 条，可选 10/20/50；页码切换会收起控制台并对页码边界进行约束。

真实浏览器证据：

- PNUTUSDT 位于第 0 行，控制台位于第 1 行。
- 切换到 ZECUSDT 后只有一个控制台，且控制台紧邻 ZECUSDT 行。
- 再次点击 ZECUSDT 可收起控制台。
- 第 2 页显示 10 条持仓。
- 浏览器 console error 数量为 0。

截图：

- [PNUTUSDT Burgundy 行内控制台](D:\MITS\data\acceptance-v332-position\inline-pnut-burgundy.png)
- [ZECUSDT Burgundy 行内控制台](D:\MITS\data\acceptance-v332-position\inline-zec-burgundy.png)

## 4. 自动化验证与重启

- `npm run typecheck`：PASS
- `npm run test`：PASS
  - core：3 个文件 / 12 个测试
  - dashboard：2 个文件 / 5 个测试，包含金融语义和展开/分页回归测试
  - engine：14 个文件 / 30 个测试
- `npm run build`：PASS
- 已停止旧 Engine 并使用新构建重启；当前 Engine PID 23700。
- 最终健康状态：`READY`；Market Stream：`LIVE`；Private Data：`READY`；reconnects：0；gaps：0。
- 最终快照：28 个持仓、28 个 TP 保护、0 个活动 Entry、28 个 TP；人工订单投影 0，Human 订单 1。

## 5. 只读 Testnet 稳定性巡检

巡检脚本：`D:\MITS\scripts\run-v332-position-smoke.ps1`  
证据目录：[D:\MITS\data\acceptance-v332-position\20260825-090552](D:\MITS\data\acceptance-v332-position\20260825-090552)

- 时长：10 分钟
- 采样：40 次，每 15 秒一次
- 失败采样：0
- READY 异常：0
- Market 非 LIVE：0
- Private 非 READY：0
- 未保护持仓：0
- 活动投影中的终态订单：0
- 结论：PASS

机器摘要：[final-summary.json](D:\MITS\data\acceptance-v332-position\20260825-090552\final-summary.json)  
巡检摘要：[summary.json](D:\MITS\data\acceptance-v332-position\20260825-090552\summary.json)

说明：健康接口的 Engine version 仍为 `3.3.1`，这是因为本次 V3.3.2 是 Dashboard-only 热修复，后端执行版本按要求未改动；Dashboard 可见标识已更新为 V3.3.2。

## 6. 已知状态

最终健康检查仍显示 reconciliation driftCount=1。该漂移为既有外部未托管状态，本轮未触碰交易执行链路，也未为完成 UI 热修复而擅自取消或修改外部订单；其余本轮验收指标均为通过。

## 7. 交付文件

- 本报告：`D:\MITS\docs\reports\ZDJ-MITS-V3.3.2-持仓浮动盈亏红绿颜色-行内控制台热修复验收报告-2026-08-25.md`
- 机器摘要：`D:\MITS\data\acceptance-v332-position\20260825-090552\final-summary.json`
- 巡检摘要：`D:\MITS\data\acceptance-v332-position\20260825-090552\summary.json`
