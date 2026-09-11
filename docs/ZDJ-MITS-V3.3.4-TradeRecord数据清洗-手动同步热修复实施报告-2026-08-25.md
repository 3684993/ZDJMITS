# ZDJ-MITS V3.3.4 TradeRecord 数据清洗、去重、分类、手动同步热修复实施报告

实施日期：2026-08-25  
实施范围：TradeRecord 数据可信度、清洗、分类、去重、交易记忆闭环、手动同步控制台。  
明确未改动：Market、Pool、AI 决策、Entry、TP 策略和 Binance 下单逻辑。

## 一、实施结果

已完成以下能力：

1. TradeRecord 增加 COMPLETE、PARTIAL、IMPORTED、EXTERNAL、DUPLICATE、CONFLICT、INVALID 分类，以及 canonical、duplicateOf、cycleId、repairSource、linkedFillIds、missingFacts、integrityFlags 等审计字段。
2. 关闭记录无 Exit 成交事实时不再计算虚假毛收益、净收益或 ROI；手续费未知时保持 `null`，界面显示 `—`，不显示为 `$0.00`。
3. 清洗器会识别旧的固定 ±2000% ROI 哨兵值、缺失 Exit、缺失手续费、缺失保证金事实，并将不可信记录排除出主收益和交易记忆。
4. 新增手动同步 Preview → Confirm → Apply 流程，支持近 1 小时、近 5 小时、近 24 小时、自定义窗口，以及 100/300/500/1000 条成交上限。
5. Apply 使用 SQLite 事务、同步历史和执行前数据库备份；默认只纳入可识别的系统 Entry/TP/Manual 成交，外部成交默认不写入。
6. 交易记忆只从 canonical、CLOSED、COMPLETE、手续费完整的 TradeRecord 生成，避免重复 Experience Sample。
7. TradeRecord 页面增加 COMPLETE、PARTIAL、IMPORTED、EXTERNAL、ISSUES 页签、分类统计、手动同步面板、关联成交事实和完整性详情。
8. Binance 私有签名请求增加短期 server-time offset 缓存，降低同步窗口的请求往返；仍保留 Binance 时间戳校验和交易写入隔离。

## 二、实际数据结果

同步前数据库经过完整性分类：52 条记录，其中 COMPLETE 8、PARTIAL 8、IMPORTED 36，主收益只统计 COMPLETE 记录。

首次真实 5 小时 Preview/Apply：

- 新增记录：18 条
- 新增 COMPLETE：12 条
- 新增 PARTIAL：6 条
- 修复已有 PARTIAL：3 条
- 新增交易记忆：12 条
- 生成数据库备份：`D:\MITS\data\backups\trade-record-sync-sync_1787635142381.sqlite`

第二次使用同一 Preview 执行 Apply：

- 新增记录：0 条
- 新增交易记忆：0 条
- 跳过：18 条
- 修复已有记录：9 条

重复执行未产生重复 TradeRecord 或 Experience Sample，验证了幂等性。

最终数据库状态：70 条记录，其中 COMPLETE 20、PARTIAL 14、IMPORTED 36、EXTERNAL 0、DUPLICATE 0、CONFLICT 0、INVALID 0。14 条 PARTIAL 和 36 条 IMPORTED 均保留原始事实，不通过猜测补齐手续费、Exit 或保证金。

## 三、验证结果

- `npm run typecheck`：通过。
- `npm run test`：通过，core 16、dashboard 5、engine 39，共 60 个测试通过。
- `npm run build`：通过，Dashboard 和 Engine 生产构建完成。
- `npm run verify`：通过。
- 浏览器实际检查：交易记录页面、分类页签、未知手续费 `—`、同步面板、Preview 和 Apply 结果均已验证。
- 重启：生产 Engine 已重启，当前监听 `127.0.0.1:8080`。
- 只读稳定性烟测：10 分钟、38 次轮询全部通过；重启初始 2 次为 SYNCING，随后 36 次保持 READY；COMPLETE 20 / PARTIAL 14 全程稳定。

烟测脚本：`D:\MITS\scripts\run-v334-traderecord-smoke.ps1`

## 四、已知事实边界

当前仍有 PARTIAL/IMPORTED 记录，是因为交易所没有提供足够的可关联 Exit、手续费或保证金事实；这些记录已从主收益和交易记忆中隔离。后续只有在 Binance 私有成交事实可取得并能与系统周期关联时，才应再次执行手动同步，不应人工填写估算值。

## 五、主要交付文件

- `apps/engine/src/services/tradeRecordIntegrityService.ts`
- `apps/engine/src/services/tradeRecordSyncService.ts`
- `apps/engine/src/api/router.ts`
- `apps/engine/src/services/positionService.ts`
- `apps/engine/src/config/settingsStore.ts`
- `apps/dashboard/src/views/TradeRecordsView.vue`
- `apps/dashboard/src/api/client.ts`
- `scripts/run-v334-traderecord-smoke.ps1`

## 六、同日复核结果

按本轮再次指定的 V3.3.4 提示词复核并重启后，Engine/Private 均恢复 READY，浏览器页面、分类页签、同步入口和未知手续费展示正常；`npm run verify` 通过。

重启后的 10 分钟只读烟测全部通过（39 次轮询）：COMPLETE 20、PARTIAL 14、sync history 1 条保持稳定。Engine 启动时对当前仓位执行正常首次观察，新增 4 条 IMPORTED 记录，因此当前 SQLite 分类为：总计 74、COMPLETE 20、PARTIAL 14、IMPORTED 40、EXTERNAL 0、DUPLICATE 0、CONFLICT 0、INVALID 0；当前 canonical 净收益为 `$335.14111037`，Experience 为 20 条并与 COMPLETE canonical 记录一一对应。

该 4 条 IMPORTED 记录不是新的 Apply，也未进入收益或交易记忆；它们保留为首次观察事实，待后续有可关联交易所 Exit/Fee 事实时再通过手动同步处理。

本轮用户文字请求仍按 V3.3.4 执行；附带的 V3.3.5 人工减仓/紧急平仓提示词和实施计划属于独立范围，本轮未修改人工下单链，也未执行人工减仓或紧急平仓操作。
