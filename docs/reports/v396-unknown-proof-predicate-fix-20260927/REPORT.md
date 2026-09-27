# V396 UNKNOWN proof predicate one-pass source fix

**V396_UNKNOWN_PROOF_PREDICATE_FIXED_LOCAL_PASS**

本轮依据 `CODEX-V396-UNKNOWN-PROOF-PREDICATE-ONE-PASS-FIX-20260927.md` 完成 source trace → canonical validator → producer/renewal/hydration/consumer 修复 → 当前 persisted snapshot 影响分析 → negative-control → 完整本地门禁。新的 one-pass 授权已经取代 plan-only，本轮没有停在实施计划或再次请求 occupancy/claim 授权。此前 Astra closeout 的 B1 在源码/本地验证层面已关闭。

## 根因与实际修复

| 根因 | 修复文件和行为 |
|---|---|
| `Number(null)`、numeric string 可通过旧时间检查；缺 sources/class/时间顺序/TTL 校验 | `entryRiskOccupancy.ts` 新增唯一 `validateNoActiveRiskProof`，检查真实数值类型、正有限安全整数时间、checkedAt <= now < validUntil、原 5/15/30 分钟 tier TTL、identity、零 fill、完整唯一来源集与合法 class。 |
| release 消费者语义分散，durable claim 不覆盖 terminal-UNKNOWN | 同文件将 hasVerified、occupancy、claim release/active、historical eligibility 与 deferral/retained-proof 统一到同一 validator；terminal-UNKNOWN 保持 fail-closed。 |
| `released_at` 永久释放 latch 覆盖失效 proof；旧 `active=0` 可绕过新 claim 检查 | `settingsStore.ts` 保留 released_at 历史/idempotency 含义，但按当前 validator 计算 effective claims；同 scope 所有行在 BEGIN IMMEDIATE 内复核，再决定是否能取得新 claim。 |
| 同 scope 多个旧 proof 失效会与唯一 active index 冲突 | 保留所有 payload 与现存 index owner，读/claim guard 统计并阻断全部 effective risks；不改 schema、不删除历史、不把冲突行当作已释放。 |
| terminal 历史快速分支可在缺完整 proof 时释放 | `reconciliationService.ts` 排除 needsRiskVerification 的 terminal-UNKNOWN，必须走完整核验或维持占用。 |
| producer 可从缺失/coerced createdAt 构造不足的历史窗口；旧异步结果可能覆盖更新事实 | 同文件要求真实有效创建时间，写入显式 proofClass/proofTier，release 前调用 canonical validator；旧 exact/proof I/O 不覆盖已更新的 row；有效续期使用既有观察时间和 tier，invalid 旧 proof 不提供晋级依据。 |
| coordinator 恢复真实订单后仍可能携带旧 absence proof | `entryCoordinator.ts` exact recovery 清除过时 proof 并记录真实 active/terminal risk state，后续 UNKNOWN 不能复用旧 release。 |
| P0 release audit 有第二套宽松判断 | `p0EntryIntegrity.ts` 在 event.ts 调用同一 validator，保持历史事件时点语义；exact-query timeout 保留有效 proof 时的事件 release/proof metadata 与真实占用及 R1 保持一致。 |

只存在两种真实 producer class：四个共有订单/成交 absence 来源，加 `BINANCE_LONG_SHORT_POSITION_ZERO` 或 `POSITION_PRESENT_PROVEN_OTHER_CYCLE`。没有任意添加 source quorum，也没有接受“sources 非空就够了”。旧 evidence 缺新增 class/tier 字段仍可按完整 sources + 原 remoteAudit tier 验证；null/字符串不会被当成有效数字。原 tier TTL、风险限额、Settings、治理和策略没有放宽或改动。

Hydration 保留原始 UNKNOWN/evidence 字节语义，所有 release 消费按当前时间重新验证，不把 JSON.parse 成功当成可信。没有 DB migration，没有删除 UNKNOWN，没有把旧异常证明直接改写成 no-risk；正常 reconciliation 仍能在真实完整事实恢复后产生新 proof。正常 confirmed terminal/reprice 与已释放旧 intent 不重提的行为继续由回归覆盖。

完整追踪：[source-trace.md](source-trace.md)、[source-producer-consumer-map.json](source-producer-consumer-map.json)。实际补丁：[corrective-source.diff.txt](corrective-source.diff.txt)、[changed-files.tsv](changed-files.tsv)。共 5 个产品文件，另含针对本次 contract 的测试修订和 2 个新增回归文件；未修改 core/contracts/Primary schema、Settings 或风险配置。

## 当前 persisted data：同一快照、同一时点的前后影响

只读 SQLite `readOnly + query_only + BEGIN` 事务采样，时点 **2026-09-27T11:23:49.879000+00:00**。同时读取 `entry_execution_tasks`、`runtime_state` 及其 `runtime_entities` 分离存储。仅保留 allowlist order/evidence 字段，未输出凭据或完整 Settings。输入指纹 `9dbc5e1c9e29130dc9d4474e1bad8bd6ce3210f5011f26cb7546cf9c9fd4ca80`。

| 比较对象 | UNKNOWN/terminal-UNKNOWN 行数 | old valid → new valid | predicate/occupancy 分类变化 | 旧 inactive 位会被视为 active |
|---|---:|---:|---:|---:|
| durable task 副本 | 45 | 42 → 42 | 0 | **3** |
| runtime checkpoint 实体 | 47 | 47 → 47 | 0 | 0 |
| 按现有 startup 新旧行优先级合并后的 durable | 45 | 45 → 45 | 0 | 0 |

3 条 durable proof 在采样时已过期，但 stored active=0、release history 存在：旧 latch 掩盖了它们；新 effective-claim 规则会将其计为占用。它们的 runtime checkpoint 已有较新有效 proof。实际 startup 规则在 45 条 durable 中选用 7 条较新的 runtime 行，合并后这 3 条得到已有新证明，所以该离线合并模型下新增 active 为 0。**没有重启、没有执行合并写入**。不能简单把“3 条副本差异”说成当前线上有 3 条新增风险。

两套持久化副本重叠，不相加作 unique order 总数。运行时已有的 47 条 proof-valid historical UNKNOWN 在同一时点全部满足严格 contract；没有为了保住数量放松规则。该时点没有检出 null/partial/future 来源异常行，源码缺陷由 synthetic negative-control 证明，而不是虚构 live 污染。将来过期必须重新判断，不能把这份快照当作未来部署的放行凭据。

[输入快照](persisted-proof-input.json)、[完整逐行影响 JSON](persisted-proof-impact.json)、[可重跑只读脚本](audit-persisted-proofs.mjs)。脚本默认只对保存快照进行旧/新 predicate 比较；`--capture` 才做只读现场采样。

## Negative-control 与回归

旧 Astra 6 个控制中有 3 个 false accept（null checkedAt、空 sources、future/inverted time）。[before](negative-control-before.json) 原样保留。[最终 formal build 上的 after](unknown-proof-negative-control.json) 为 **6/6 PASS、exit 0、blockers=[]**；所有无效情形同时满足 proof=false / occupiesRisk=true / durableClaimActive=true。有效、过期、identity mismatch 控制也符合预期。

新增 validator matrix **47 项**，覆盖所有任务书指定类型/时间/source/class/TTL 反例，以及 terminal-UNKNOWN 和 fill/identity冲突。新增 hydration/producer/consumer **13 项**，覆盖 reopen/原始证据保留、无 save 的过期重占用、同 scope 多 claim、自然续期、R1 一致性、旧异步覆盖、真实订单恢复、缺失 createdAt。更新旧缩略 positive fixtures 为真实来源集；原先要求过期后永久释放的测试按本次明确授权改为 fail-closed。

## 最终源码树的全部本地门禁

以下最后一次执行全部 exit 0，开始/结束 source diff SHA256 均一致为 `e7405c0c0b63703b560da41114bedbeee2359741a67a93ca0fa642f047b2eba3`；最终提交再次校验源码 patch 与其一致。中间失败/早期版本的日志保留，未覆盖成虚假的全绿记录。

| 门禁 | 最终结果 |
|---|---|
| UNKNOWN / R1/R2/R3 / journal / projection 定向 Engine | 20 files / **261 tests PASS** |
| 受影响 dashboard | 1 file / 17 tests PASS |
| 完整 Engine | **176 files / 1493 tests PASS** |
| 完整 core | 8 files / 58 tests PASS |
| 完整 dashboard | 14 files / 63 tests PASS |
| contracts | 按 package policy `--passWithNoTests`，exit 0 |
| workspace typecheck | PASS |
| verify:deps / verify:scripts | PASS / PASS |
| full npm run verify | PASS，含再次 typecheck/build/全量测试 |
| formal workspace npm run build | PASS |
| S00 T01–T06/static isolation | PASS，176 test files、隔离 store 测试，未使用 live port/data |
| storage coverage + OS-temp backup self-test | PASS |
| final-build negative-control | 6/6 PASS |
| read-only persisted-impact | PASS |
| diff / staged / committed-tree check | PASS |

[gate-results.json](gate-results.json) 记录 exact commands、attempt、时间、exit code 和源码 hash；所有 TXT 原始门禁输出随仓库保存。[run-local-gates.mjs](run-local-gates.mjs) 可复跑。早期失败仅包括新测试构造 fixture 不完整或把测试 audit tier 改动混入 tier-0 断言；最终没有绕过测试。首轮完整门禁后补充了直接相关 race/lifetime 回归，因此最终树重新执行了完整一轮。Node 实验特性、既有 dashboard 测试 stub、Vite chunk 告警已保留，不影响实际 exit 0。

## Source/build/runtime identity 与权限边界

起点 isolated main clean，fetch all 后从 `30045e5` fast-forward 到 `d2ca73334f86d35910283d67b1f2f12fd8e11a02`。所有改动均在现有 isolated main worktree；未创建长期分支，未切换/清理/stash/commit 原 v395 worktree。

候选 build **3.9.6-08575adfc68a25f6c874**，source hash `030ab076b704dafc941da04f8222091b36cb7c4c0a86e69f9fbb68ddd1427f55`，artifact hash `08575adfc68a25f6c874b7546a81c21175695b34af879f67cc81501c118252ba`。[identity manifest](source-build-identity.json) 包含逐文件 hash 和与 runtime 相同算法的 tree hash；该 source hash 按现有算法包含测试源码和原始字节/换行。

运行中仍是旧 build `3.9.6-fa4fbc8660ef12849644`，PID **18644**，instance `e0919ffb-a97e-4eb6-b4bb-09818a489150`，Settings **219**；前后采样一致。旧 on-disk artifact/source 与 loaded receipt hash 匹配，但新源码没有加载。当前 Testnet 写入状态保持原状；审计没有停止运行、改锁或调用 exchange。DB snapshot hash 是读取结果的加密摘要，不是静止全库镜像或进程出具的 cryptographic attestation。

[runtime-vs-source.json](runtime-vs-source.json)、[runtime-before.json](runtime-before.json)、[runtime-after.json](runtime-after.json) 明确现场与候选的边界。[protected-v395-worktree.json](protected-v395-worktree.json) 确认原 branch/HEAD 和 **48 条 status** 与此前保存状态一致；对该 worktree 仅使用 no-optional-locks Git 只读观察。

**DEPLOYMENT_NOT_AUTHORIZED**；Engine lifecycle **NOT_RUN**；runtime acceptance **NOT_RUN_EXTERNAL**；GitHub Actions **NOT_RUN_BILLING_LIMIT**。没有 Settings/限额/杠杆/治理/Primary/数量方向目标horizon/执行策略修改。没有 live DB 写入、迁移或 exchange 写入。本地隔离测试例外仅使用临时目录、mock 和随机 loopback 测试端口。

## 交付结论

无剩余源码/本地验证 blocker。本轮完成实现与本地验收后停止，不运行 runtime acceptance。后续若部署，必须另行取得明确生命周期授权，并按新的 commit/artifact identity 重新核验运行实例；本地 PASS 不能冒充已部署。

全部源码、测试、报告、JSON、TXT/TSV、脚本、patch 和 identity manifest 正常 commit/push 至 GitHub main。交付 SHA 与远端一致性见随后的 `git-delivery.json`；无 squash/rebase/force。
