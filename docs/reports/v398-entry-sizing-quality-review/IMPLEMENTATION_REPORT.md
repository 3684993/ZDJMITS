# V3.9.8 实施与发布记录

2026-10-09（Asia/Shanghai）。R2 先于源代码实施：研究与计划提交 `5a4d158a07e93f655fb838440b24e9366e12859b`，归档闭合提交 `2b0143e5dc112266437da2e14c7eb808f51d9869`；152 项远端 blob 哈希全部通过。失败过的首次 readback 与两次失败的本地完整验证均保留，未伪装成成功。

## 交付范围

**离线实现 READY_FOR_REVIEW；新风险参数校准仍为 INSUFFICIENT_EVIDENCE。** 用户本次另行明确授权最终升级、启动当前停止的 TESTNET 8080 并持续运行。该生命周期授权仅在 I2 发布、当前 CI、本地检查及新鲜 TESTNET 事实闭合后执行；本文初始提交时尚未启动。没有人工下单、改 Settings、代理/模型重启、强迫自然成交或写回交易历史。

1. `noSeparateAdd.ts` 在冻结候选之前公布 `NO_SEPARATE_ADD_V398`。同一账户、symbol、positionSide 有物理持仓、有效 pending 授权或原始 durable authorization 时，不向 Primary 提供另一个独立建仓候选。数量或持久化事实损坏明确拒绝，HUMAN handoff 拒绝新 wire。该政策是预先声明的授权边界，非 Review 或主观风险第二次否决。
2. `noAddOriginLedger.ts` 使用 SQLite 部分唯一索引，将 TESTNET/account/symbol/side 的唯一原始 intent、clientOrderId、初始数量上限持久化。原始授权与 submission journal 在同一个 `BEGIN IMMEDIATE` 中获取；跨连接竞争不能产生第二个 wire。独立授权失败只释放自己的 reservation，不破坏原订单身份。
3. JIT 继续验证既有 frozen candidate/TradePlan/quantityUnits/交易所过滤器和真实资金；最终 wire 前仅重查 no-add/owner/immutable cap。WS/REST 同 clientOrderId 的 UNKNOWN 恢复仍是查询，原订单 partial fills 不会被当成独立补仓。原生 PUT amend 保留总授权量与原订单累计成交，不使用 cancel/recreate 放大数量。
4. 新周期开放必须有：时间有界的全量仓位和挂单 readback、原订单 exact terminal、零未决订单、以及已成交时的 exact indexed CLOSED/CONSERVED cycle 数量。TTL、`-2013`、UNKNOWN 或缺档都不能释放。最多检查 256 个活跃 origin；超过界限保守不释放。相同 symbol 的任何未决 open order 均暂阻释放，属于明示的保守限制。
5. 服务端 HUMAN `ADD` 在 owner takeover、行情、TP、REST 之前拒绝；控制台补仓按钮禁用。历史 ADD 的审计展示和退出保护保留，人工明确 reduce-only limit/TP/close 行为保持原有授权。
6. `v398RiskQuantityBounds.ts` 是**无 live 调用者的纯影子函数**：五个已测 quantity 上界取 min，再向下按 stepSize 取整；下界冲突产生 NO_FEASIBLE_QUANTITY，不强行增量。每项资产和观测时间必须匹配决策 cutoff；缺失、跨资产、look-ahead 或非有限事实返回 UNKNOWN。没有上线任意周线位置、CVaR、stress、portfolio multiplier。
7. 五个 workspace manifest、lock 和 RELEASE_VERSION 统一为 3.9.8。API_VERSION 保持 V3.9.7 兼容；持久化 envelope 新增可选政策字段，严格 schema 不放宽其他键。Primary 仍是唯一 Entry candidate 选择 authority。

## 真实验证

|验证|结果及证据|
|---|---|
|最终主要定向验证|8 files / 93 tests PASS；`v398-targeted-final.log`|
|strict envelope 持久化兼容补充|2 files / 35 tests PASS；`v398-envelope-schema-targeted.log`|
|完整 `npm run verify`|PASS；contracts 1/2、core 8/59、dashboard 24/124、engine 207/1878，共 240 files / 2063 tests；`v398-full-verify.log`、result JSON|
|新增工具后的机械 S00 复核|PASS；`v398-s00-final.log`；未放宽 isolation rules|
|diff / 新 JS / PowerShell 语法|PASS；最终 publication gate 日志保留|
|并发/重启/UNKNOWN|真实临时 SQLite 双连接互斥、重开数据库、immutable cap、零额外 mock wire、终结/闭合后才开放新周期|
|单调性/资产/PIT|1001 个递增同向 exposure 点不能增加 concentration bound；资产混合、缺项和未来 cutoff 拒绝|

第一轮完整验证失败 6 项：旧版本断言和旧同向二次建仓允许场景。保留旧资金策略测试，但把**无关风险历史**放到另一 symbol，并新增同向占用在 Primary 前拒绝的测试。第二轮失败 3 项揭示新 envelope 字段缺少严格 Zod schema，已补齐兼容可选字段。最终完整验证成功。初次 SQL placeholder 错误也由原始定向测试捕获并修复，日志保留。

R2 GitHub Actions 两个 run 失败；run `37784329961` 的 job readback 证明失败 step 为 “Verify current S00 identity and isolation”，之前 deps/scripts/release 成功，后续步骤 skipped。对应 jobs 的原始 log 下载 API 未获得权限，标明 HTTPError，未猜测日志内容。I2 使用当前机械 S00 清单修复 inventory drift，实际新提交 CI 状态另存。

## 保持的界限与未决事实

TPGuardian、PositionReviewRunner、PositionService 和默认 Settings 相对 R2 基线保持不变，source audit 逐文件证明。P0 canonical、funding UNKNOWN、owner/protected TP、F04/F10/F11、Reactivity 独立工作没有被借本任务扩展。**实际 fresh R2 交易所为 17 个非零持仓**、16 个 open orders；18 是更早本地持久化视图，不能混为同一时点。

研究的 ETH/AVAX native 数量守恒是物理订单证据，不补造旧 Primary 权利。旧 PRIMARY archive、历史 portfolio as-of、完整 funding/退出路径、正式 EV/CVaR/机会损失校准仍 UNKNOWN。八方案表中的示意缩量不是可上线最优系数。新 policy 的真实自然新建仓/partial fills/跨重启样本未发生时必须 UNKNOWN，mock 测试不能代替。

## 发布与当前实例

I2/运行后状态在后续小节记录，明确代码提交、远端 hash、CI run、一次 MANUAL_START、/health + closeout、IDENTITY_CLOSED 六项、TESTNET 与 production-write 实际读数。运行实例使用保留的 `D:\MITS\data`，原 dirty checkout 的六项变更不 reset/stash/switch/commit。8081/8083/8084 辅助服务保持原 PID，不部署生产环境。长期运行使用 detached 非重启 host，没有退出定时器；不承诺尚未观察到的未来可用性。

提交 whitespace gate 曾发现两个 stdout 日志的尾部多余空行；原字节另存 `.original.gz`，plain log 仅规范末尾换行，保留完整输出内容和失败检查日志。secret scanner 的两个 cookie 报警证实是 package-lock `packages.dependencies.cookie` 的 npm semver，限定结构验证后记录 exemption，没有豁免真正 cookie。
