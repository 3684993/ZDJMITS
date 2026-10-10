# 2026-10-10 交易24小时盈亏 + Exit provenance 第一轮提交

状态：`GITHUB_SOURCE_COMMITTED / GITHUB_CI_PENDING / NOT_MERGED / NOT_DEPLOYED / NOT_RESTARTED`

## 仓库核实
GitHub main 为 `b55f427eeda150c7cdc7b8beaaaddfd39aa9e6e1`。三个 Draft PR 均在用户报告指定 HEAD 有 exact-head 成功 CI：
- PR31 ae39b390e8d1900c91c76582d3c7ad9166df3386 / 38022877309 success，包含GPU驾驶舱与资金收益分币种趋势；
- PR33 402b850f73fd10018fb03db0b5deaeda493dd499 / 38018026331 success，原子slot lease，但两27B不等价、生产借用默认OFF；
- PR32 6ac46f8a93c096b5764bc05508ba47aa015bf381 / 38018034694 success，TP_TARGET_REVIEW_DRY_RUN，无签名事实provider/真实改单。

**旧24小时** main `docs/reports/v398-engine-cutover-20261010/acceptance/state.json` 当前已经是 `ABORTED_SAFETY_FAILURE / LOCAL_TP_GATE_NOT_CLOSED`，2026-10-10 08:34:00.270+08，中途local TP14/15 missing1；旧尝试**不存在正在运行的有效24小时**、不能续算。后续 09:34只读local24/24、02:10Z历史signed25/25不是当前部署门禁。用户授权有条件的单次重启和新的24h T0，但 ChatGPT 此会话仅有 GitHub 写权限，无Windows宿主机安全Shell/本地部署入口，不得虚称已重启或停机。

## 真实源码路径
- `apps/engine/src/services/trade24hReadModel.ts`, `.test.ts`：按 `closedAt` 滚动24h、唯一 physical `cycleId` 及已有 `ledgerClosedComplete` 资格确认每笔完整交易。按 native USDT/USDC分别给盈利笔数、亏损笔数、零收益、正盈利合计、负亏损合计、合计已实现不含资金费净收益、已计入的手续费、完整funding证据覆盖。不同资产不混算也不当USD1:1；未对账的closed/observedFlat另计为 excluded/UNKNOWN，不能把不存在历史事实当0。对窗口之外记录仅做轻量cycle去重，减少无关P0追溯CPU。
- `apps/engine/src/api/router.ts` GET `/api/v3/trade-records/24h`，纯读，无Binance请求、DB写或同期自动同步。
- `apps/dashboard/src/api/client.ts` + `views/TradeRecordsView.vue`：新“最近24小时”分币种账务，盈利/亏损/净额/手续费、sync ERROR与更新时间、未确认周期不混入正式全口径收益。
- `apps/engine/src/services/exitProvenance.ts` + `exitProvenanceConflictReasons.test.ts`：保持既有 fail-closed 红冲突，只添加有来源的实际 conflictReasons、数量越界和证明状态，避免隐藏错误。
- `apps/dashboard/src/views/tradeClosePresentation.ts`：显示冲突原因 tooltip；交易详情区显示证据、退出身份和数量覆盖，页面注明退出来源冲突与“账本分类 conflict=0”是不同概念。

## 样例和证据边界
用户截图的六条示例 WLDUSDT +4.82、USELESSUSDT +4.96、BRUSDT +1.12、POLUSDT +2.50、GRASSUSDT +1.95、AVAXUSDC +1.85 都是界面展示的历史子集，不能代替完整过去24小时的收益。页面中32个完整周期 ExFunding 总汇“—”是混USDT/USDC时后端按FX_UNPROVEN隔离，**不是收益为0**。顶部完整性分类重复/冲突/无效0与行内 `closeProvenance=CONFLICT` 口径不同，无法通过截图确认是否重复、不同role同identity、registry与local映射不一致或者缺乏原始身份。

真实六笔订单需要 Codex 在 Windows 主机只读逐 fill 对比 scoped registry + client/exchange双ID + cycle，GitHub只推匿名hash/role/布尔证明。真实来源冲突不容改为TP；不同独立精确TP/人工组合应 MIXED_TP_MANUAL；未完整取证则UNKNOWN。

## 不能跳过的本轮闭环
1. 在隔离Windows工作树先运行 targeted + full verify:ci 和 S00，自动Github CI在本PR HEAD上成功（本ChatGPT会话未在本机跑测试）；
2. Codex 读本branch的新指令 `docs/prompts/CODEX_V398_TRADE24H_CONFLICT_AND_CONTROLLED_DEPLOY_20261010.md`，证实六个cycle根因、修实际误报、完整合并四个PR并在**整合代码**上跑full CI；
3. 用户已授权有条件受控重启，但每次必须 action-time signed全部TP、Production0、TESTNET/账户合法性/身份 6of6、no-add、人管/私有同步、DB备份/回滚。任一NO GO则**不重启保护性Engine**。旧24h已中止，新一次必须从真实新T0重头开始；
4. 完整Code/验证/脱敏报告与新部署收据或NO_GO阻断全部推 GitHub，不保留仅本机版。
