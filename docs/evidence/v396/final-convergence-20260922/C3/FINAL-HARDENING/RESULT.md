# C3 最终加固验证

输入：d77a62a。执行前补充计划：docs/plans/v396/FINAL-AUDIT-C3-HARDENING-20260922.md。

## 反证与修复

- 第一轮 6 个红测：跨 scope 同 cycle 任务覆盖、跨周期漏算 claim、FILLED 零成交释放、UNKNOWN 回到 PREPARED、异步能力查询穿越 revoke、真实人工替换已有 TP 占用不释放。均修复。
- 恢复轮 5 个红测：本地 FILLED 释放、错误 clientOrderId、错误 symbol、负成交量、未知交易所状态。均拒绝，不清空风险。
- 崩溃轮 1 个红测：TP 提交前运行投影/事件丢失协调器真实 clientOrderId。改为真实身份先持久化事件再发送。
- 确证拒绝修复：-2022 明确拒绝可确证释放并用新 intent 重建；超时/重复/未查到不释放、不换 ID 重发。
- 部分成交后撤单：终局状态优先于 PARTIALLY_FILLED，精确查询保留 filledQuantity；共用 claim 记录剩余量。UNKNOWN claim 在 OwnershipService 中仍计占用。
- 新 ID 为规范身份 SHA-256 截取 120 位（35 字符含前缀）；历史 ID 依已有 requestKey/任务回读保留，不改库、不重发历史任务。

## 最终验证

Engine 975/975 PASS；core 46/46 PASS；dashboard 17/17 PASS；contracts 0 项（passWithNoTests，不能叫契约测试充分）。contracts/core/engine/dashboard build 均 exit 0；engine/dashboard typecheck exit 0；S00 T01–T06 PASS，108 入口、0 blockers；diff check exit 0。

两条旧 S04 测试原来用本地状态跳转伪造 FILLED/CANCELED，现改为带确证成交量的 observe 事件，保留版本递增、终局不复活、预算守恒断言。

## 实际边界

只修改隔离 worktree，离线临时 SQLite/mock adapter；没有真实交易所调用、现网 Engine 生命周期、部署或 live Settings/DB 写入。构建产物位于本 worktree。全仓通过是此次补丁工程证据，不等于完整 S04/S05 或 V3.9.6 验收。S06–S10 离线缺口另列最终矩阵。
