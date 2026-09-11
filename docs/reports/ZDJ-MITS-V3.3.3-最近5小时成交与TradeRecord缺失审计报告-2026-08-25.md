# ZDJ-MITS V3.3.3 最近 5 小时成交与 TradeRecord 缺失审计报告

审计时间：2026-08-25  
窗口：最近 5 小时  
来源：Binance Futures Testnet private REST facts（fills、income、orders、positions、open orders）  
证据：`D:\MITS\data\diagnostics\trade-audit-5h\20260825-105644\audit.json`

## 1. 原始事实

| 项目 | 数量 |
|---|---:|
| 成交 fills | 330 |
| income facts | 314 |
| orders | 61 |
| 当前持仓（审计时） | 21 |
| open orders | 23 |
| 系统可关联 fills | 318 |
| 外部/未关联 fills | 12 |
| Entry fills | 129 |
| Exit fills | 189 |
| commission income rows | 84 |
| commission absolute sum | 22.88021711 |

系统成交 Maker 比例为 316/318；全部成交 Maker 比例为 328/330。Entry 为 129/129 Maker，Exit 为 187/189 Maker。

## 2. 缺失根因

旧链路主要在理想化的 `onEntryFilled` 和 `onTakeProfitFilled` 路径创建/关闭 TradeRecord；Binance 私有 WS 的成交事件没有完整进入生命周期层，定时对账在发现仓位归零时也没有统一 finalize。重启后生命周期和成交事实缺少可恢复结构，手续费还存在以 0 代替未知值的风险，因此出现“交易所已经有成交，TradeRecord 仍为 0/不完整”的现象。

## 3. 处理规则

- 用 symbol + side + qty transition + order/client ID + local intent + exchange audit fact 重建周期。
- 仅接受 `entry_`、`tp_`、`manual_` 等系统可证明关联的成交进入自动修复。
- 外部/人工未关联成交不自动导入系统闭环。
- commission 没有可靠 income 对应时标为手续费不完整，不能伪造为 0。
- Entry 和 Exit 都有完整费用事实且数量闭合，才生成 `CLOSED + COMPLETE` 和 Experience。
- 修复可重复执行，按 trade/cycle ID 幂等 upsert；旧的错误 PARTIAL Experience 会被清理。

## 4. 审计修复结果

最新 `repair.json` 结果：

- `cyclesDetected=19`
- `cyclesRepaired=15`
- `completeCycles=8`
- `partialCycles=7`
- 其余检测周期没有满足完整 Entry + Exit/数量归零条件，不写成闭合完整记录。

8 条完整周期均进入净收益口径；当前完整记录总净收益约 `$133.64798966`，总手续费约 `$12.82917034`。未发现“毛收益为正但净收益为负”被错误标记为 WIN 的情况；Experience 当前 8 条，全部按净收益生成。

## 5. 结论

TradeRecord 缺失问题已从“仅依赖理想事件回调”改为“WS + 对账 + 可重启生命周期 + 一次性交易所事实修复”的闭环。外部成交不被伪造归因，手续费未知不被当作零，主收益和 Experience 仅使用事实完整的 COMPLETE 记录。
