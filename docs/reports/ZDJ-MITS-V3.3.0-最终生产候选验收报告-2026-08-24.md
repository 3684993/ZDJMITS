# ZDJ-MITS V3.3.0 最终生产候选验收报告

验收结论：**PASS**

本报告对应最终修复后的完整 60 分钟 Testnet 自动验收窗口。验收期间未人工创建订单、未手工改库、未在窗口内重启引擎；验收脚本独立完成采样、下单链路审计、持仓/止盈核对和进程收尾。

## 1. 最终窗口

- 开始稳定时间：2026-08-25 01:47:59 +08:00
- 完成时间：2026-08-25 02:48:01 +08:00
- 实际窗口：60 分钟
- 采样：237/237 成功，fatal=0，脚本退出码=0
- 原始证据：[acceptance-60m 原始摘要](D:\MIT

## 2. 本轮真实修复S\data\acceptance-60m\20260825-014642\summary.json)
- 交付机器摘要：[summary.json](D:\MITS\data\acceptance-v330-final\20260825-014642\summary.json)

前两轮证据显示，共享 Binance WebSocket 在 ticker/盘口消息失活而其他消息仍到达时不会触发重连，恢复器随后每次只处理两个标的，导致一次约 3 分钟的 Pool 归零。已仅修改市场流恢复逻辑：分别记录 ticker 与 bookTicker 活性，任一关键流连续 45 秒无消息即终止当前 socket 并走既有退避重连；交易策略、选币、下单、仓位和 TP 逻辑未重构。

修改文件：[BinanceMarketStream.ts](D:\MITS\apps\engine\src\adapters\market\BinanceMarketStream.ts)

## 3. 基线与未完成项扫描

- `npm run verify`：PASS
- typecheck：PASS
- 测试：PASS，Engine 14 个测试文件、29/29 tests；Core 12/12；Dashboard 1/1
- 生产构建：PASS
- `apps/`、`packages/`、`scripts/`、`config/` 未发现真实 TODO/FIXME/PARTIAL/PENDING 开发遗留；发现的 PENDING/PARTIAL 均为业务状态枚举或记录状态。
- Mock 仅存在于 testing/test harness；生产启动路径使用 Binance/Testnet、AI 配置和真实私有数据适配器。

## 4. 60 分钟验收指标

### 行情、恢复与交易池

- quote freshness 平均：98.82%；最低：76.71%，仅 1 个采样低于 80%，最长连续低鲜度 1 个采样
- kline freshness：平均/最低均为 100%
- Pool book freshness 平均：99.84%；最长连续低鲜度 1 个采样
- Pool：目标 8，最小/最大/结束均为 8；Pool=0 采样 0
- Eligible：结束 39，最大 46；市场恢复采样比例 0
- gaps：0；websocket、quote、bookTicker、depthSequence、kline、timestamp、subscription 均为 0
- reconnect/backfill/recovery failure：0/0/0

### AI、选币与入口链路

- Scout：完成 85，fail-closed 5
- Primary：完成 88，fail-closed 1；无效模型响应未产生 Intent
- PLACE_LONG：1；REJECT_CANDIDATE：87；候选分析覆盖 27 个标的
- 已核实真实链路：`PLACE_LONG → ENTRY_INTENT_CREATED → ENTRY_ORDER_CREATED`
- Binance order id：`265542944`；随后交易所终态被系统对账，COLLECTUSDT 被导入为新持仓并完成 TP 保护
- 验收脚本摘要中的 active `placed=0` 是结束时 active 委托计数；本报告按审计事件确认窗口内实际创建订单 1 笔，结束时 active entry order 为 0

### 安全、持仓与 TP

- Primary overlap：0
- false reject / failed-to-intent 映射：0
- terminal order 进入 active projection：0
- 最终持仓：25；TP protected：25/25
- bad TP：0；missing、repairFailed、orphan、duplicate、qtyMismatch、wrongSide 均为 0
- 人管仓位：5，未与系统下单链路冲突

### TradeRecord、交易记忆与前端

- 60 分钟内没有自然产生新的 CLOSED TradeRecord，因此实时闭环等待后续自然交易验证；自动化集成测试已 PASS（29/29）。禁止通过手工造单补齐该项。
- 前端生产构建 PASS；已完成驾驶舱、智能选币、市场智能、AI 大脑、持仓、订单、交易记录、交易记忆、运行中心、系统设置 10 页只读抽查。最终重启后首页重新加载成功，展示 V3.3.0 FINAL、行情 FRESH、Pool 8/8、私有数据 READY、TP 25/25。

## 5. 最终重启与交付状态

- 生产引擎已重启并运行于 `http://127.0.0.1:8080`
- 当前 PID：19668
- `/health`：READY；market stream：LIVE；ticker/bookTicker 均持续有新消息；market snapshots=71
- 当前 pipeline：market FRESH、Pool 8/8、private READY、reconciliation service READY、TP 25/25
- 启动脚本的 30 秒等待窗口先返回超时，但引擎随后完成 bootstrap 并已由独立 `/health` 核验 READY；这是启动等待脚本窗口问题，不是引擎运行失败。

重启后对账还观测到 `driftCount=1 / unmanagedOrders=1`，只读核对为外部未托管的 `FXSUSDT LONG / exchangeOrderId=411671526`，且当前没有对应本地持仓。该订单未擅自撤销，以避免误伤可能的人管/外部订单；本轮安全门槛、订单终态投影和 TP 保护均 PASS。该外部未托管委托属于后续人工确认项，不改变本次 60 分钟最终候选验收结论。

## 6. 最终判定

**PASS。ZDJ-MITS V3.3.0 达到 Production-Ready Release Candidate。**

自本报告起冻结当前架构与验收通过版本；后续只允许处理明确生产故障、外部未托管委托确认或自然 CLOSED TradeRecord 闭环验证，不新增功能、不重构。
