# Codex C3 本地只读清点

目标：为主实现方接线 C3 提供精确事实。**本轮不改产品源码、不 commit、不 push。**

先 fetch 并 `merge --ff-only` 到 `codex/v396-final-convergence-20260922` 最新 HEAD；不得在 astra-handoff 分支工作。现网边界不变：不启停/热重载 Engine，不改 live Settings/DB，不部署，不做交易所写请求。

## 1. 枚举所有退出类交易所写边界

机械 grep + 调用链确认以下能力的全部生产调用点：

- `placeManualOrder` / `cancelManualOrder`
- `placeTakeProfit` / `cancelTakeProfit` / TP replace/rebuild
- 任何 reduce-only/close-position/exit submit
- `PositionExitCoordinator.requestExit/transition/markSubmitUncertain/observe`

输出：文件:行号、调用者、source=MANUAL/TP/AI、是否在 wire call 前已有 durable PREPARED、clientOrderId 来源、失败后是否按同 clientOrderId 查询。

## 2. canonical scope / cycle / owner 真源

逐条确认 manual、TP、未来 AI exit 当前使用：environment、account/credentialRef、symbol、positionSide、cycleId。重点查：

- 是否仍有 `resolveUnderlying(symbol)` 被用于 claim key；
- 是否存在 `${symbol}:${side}` 或其它第二身份；
- `executionScope(...)` 所有生产调用点；
- position `cycleId` 缺失时如何处理；
- OwnershipJournal/OwnershipRuntime 的 ownerState/ownerVersion 是否被退出 writer 读取，还是仅写入不消费。

## 3. durable journal 与能力矩阵

确认：

- `OwnershipJournal` 的实际 runtime DB 生命周期和路径；
- `v396_exit_tasks` / `v396_quantity_claims` 是否已经进入 runtime 打开的同一 journal；
- adapter 是否支持按 clientOrderId 查询 manual exit、TP、普通 reduce-only order；
- ONE_WAY/HEDGE 下 reduceOnly/positionSide 的真实 request 字段；
- cancel/replace 是否有原子保证，若没有必须标 UNKNOWN/先查实。

## 4. mandate/TP 单一真源

确认 `ProtectionMandate` 当前读端消费者、`TpGuardian` 是否读取 mandate；列出所有可能在人工撤销 TP 后重新建 TP 的路径。不能只看测试。

## 5. 建立临时敌意测试（不提交）

可在 worktree 临时新增 `c3RuntimeWiringHostile.test.ts`，验证现状并允许红：

1. MANUAL 与 TP 对同 scope/cycle/剩余 qty 不能同时获得全量 claim；
2. PREPARED 必须先于任何 exchange submit；
3. submit throw/ACK lost 后只能 UNKNOWN，并且 retry 使用原 clientOrderId 先 query；
4. HUMAN takeover 后 AI ownerVersion 旧任务不得提交；
5. human revoke mandate 后 Guardian 不得重建；
6. ONE_WAY 与 HEDGE scope 一致且不会把 reduce 变成增仓；
7. partial fill 后 claim 只剩真实 remainder；
8. crash/restart 后 PREPARED/UNKNOWN 必须进入 query list，不自动重发。

不要为了测试通过修改源码。记录红测 expected/actual。

## 输出格式

只回报：

- 当前 HEAD；
- writer 清单（文件:行号）；
- identity/scope 不一致清单；
- journal/adapter 能力事实；
- mandate 读端事实；
- 临时敌意测试通过/失败数；
- 最小接线点（按文件列，不提出新架构）；
- 任何真实 P0/P1。
