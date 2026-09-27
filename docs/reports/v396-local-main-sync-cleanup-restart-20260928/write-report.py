from pathlib import Path
import json
out=Path('docs/reports/v396-local-main-sync-cleanup-restart-20260928')
def r(n):return json.loads((out/n).read_text(encoding='utf-8-sig'))
a=r('acceptance-summary.json');i=r('source-build-runtime-identity.json');l=r('lifecycle-receipt.json');x=r('runtime-final.json');g=next(v for v in a['authoritativeBook']['gates'] if v['name']=='MAX_GROSS_NOTIONAL')
text=f'''# 本地环境收敛、main 同步与一次受控重启

**{a['status']}**

本次依据[用户完整授权](authorization.md)执行。最终 canonical checkout 为 **D:/MITS**，branch **main**；D 盘根目录不再存在其它 MITS 开头目录，Git worktree registry 仅一个正式 checkout。最终 commit/push 后的 clean、HEAD==origin/main 与 GitHub SHA 由随后提交的 `git-delivery.json` 记录。文档交付提交不改变已部署产品源码或 artifact。

## 运行与源码 identity

| 项目 | 结果 |
|---|---|
| fetch 时最新 main | 48b3d8c4a438218367642879af7efb455dddede5；实际 fetch，无硬编码 checkout |
| 部署时 main SHA | `{l['gitSha']}`（期间仅增加本轮证据/脚本） |
| 产品修复基础 | `4d0d9ad655aae9cef991e3f98ebd8c0690d8c5a7`；Git 产品/test/build-input tree 未变 |
| old → new PID | 18644 → {l['newPid']} |
| old → new instance | `{l['oldInstance']}` → `{l['newInstance']}` |
| buildId | `{i['buildId']}` |
| sourceHash | `{i['source']['hash']}` |
| artifactHash | `{i['artifact']['hash']}` |
| artifact | D:/MITS 下 apps/engine、dashboard、packages/core、contracts 的 dist；逐文件 manifest 已入库 |
| dataDir | **D:/MITS/data**，原 convergence/data 是指向它的 junction，数据未迁移/删除 |
| Settings | **219 → 219**，payload SHA256 前后一致 |
| Ready / identity | READY / **IDENTITY_CLOSED，10/10** |
| lifecycle | **一次 stop、一次 MANUAL_START**；无 retry/recovery/autostart/hot reload |

[build-identity.json](build-identity.json)、[source-build-runtime-identity.json](source-build-runtime-identity.json)、[lifecycle-receipt.json](lifecycle-receipt.json)、[start.txt](start.txt)、[stop.txt](stop.txt)。构建时间见门禁日志，最终正式 build 于 2026-09-27T23:26:54Z 左右结束。

仓库批准的 Windows stop 脚本核对 identity/PID 后调用 Stop-Process -Force；本报告不宣称得到 graceful-shutdown ack。停止前 SQLite 只读事务核对仓位与落盘完全一致、checkpoint 新鲜、无 SUBMITTING/PREPARED 本地状态、1470 条 reservation 均 RELEASED、pending entry=0，并保留快照。停止后证明旧 PID 退出且无第二个 Engine，再启动一次。首次 launcher 前的 clean 检查曾因 LF/CRLF 的 stale index 拒绝进入 lifecycle；刷新 index 后无任何语义 diff，该拒绝没有执行 stop/start。STARTING/503 期间只有只读探测，没有重启。

## 只读 runtime 验收

最终主快照时点 **{x['capturedAt']}**。仓位 **22**，TP/protection **22/22**；missing、wrongSide、quantityMismatch、unverifiedTp 均 0。Testnet 保持；Production lock=true；仪表化 Production/Testnet writes 均 **0/0**。SQLite 事件查询在新实例观察窗口内没有提交事件；没有强制 Primary/PLACE/submit/fill。这些计数是已仪表化路径，不冒充交易所全账户写入审计。

R1 scoped UNKNOWN：历史 **47**，proof-valid **46**，occupying risk **1**，active Entry claims **1**，active UNKNOWN claims **1**；manual UNKNOWN **1**、TP UNKNOWN **0**。manual 域未混作 Entry。数据明确标注 BEST_EFFORT_CROSS_STORE。

自然变化证据：启动后先观察 47 proof-valid；之后两条 proof 过期，真实 scoped readback 变为 45 proof-valid / 2 occupying / 2 claims；随后正常 reconciliation 续期一条，最终为 46 / 1 / 1。没有删除 47 条 UNKNOWN 历史或直接改写 no-risk。原 durable/runtime 总行数均保持，entryOrders=539、reservations=1470、manualOrders=42、tpOrders=457。只读 persisted 对照另在 23:32:10Z 捕获 durable 45（43 valid、2 expired）与 runtime 47（45 valid、2 expired），所有旧/新 strict predicate 分类差异为0；新 consumer 对过期证据保留占用，未把 inactive bit 当成永久释放许可。

`persistence-safety-final.json` 是将**停机前保守条件**用于运行后观察的记录，其中 noPendingEntry=false，因此返回 BLOCKED；原因是已存在 UNKNOWN 自然过期后的 pending risk，不是新提交或未落盘状态。没有再尝试生命周期。运行后验收允许并要求这种 fail-closed 风险状态，独立结论见 [acceptance-summary.json](acceptance-summary.json)，没有覆盖隐藏该记录。

R2 最终 authoritative **BOOK**：status **UNAVAILABLE**，first blocker **`{a['authoritativeBook']['code']}`**，LONG/SHORT 新增容量 **0/0 USD**。firstBinding 与 pipeline code 同源同一 readback，不由 dashboard 重新推导。数值门仍保留单位：canonical gross used **{g['usedUsd']:.6f} USD**、approved limit **{g['limitUsd']:.6f} USD**、headroom **0**、shortfall **{g['shortfallUsd']:.6f} USD**。启动早期 CASH_FLOW_COVERAGE_UNPROVIDED 经自然 hydration 恢复为 VERIFIED，未改 Settings；当前 first blocker 是未核实 pending risk，不擅自将 gross 换成首因。

R3 观察窗口从新进程启动至 [r3-runtime-observation.json](r3-runtime-observation.json) end，natural Primary=0、conversion event=0，**NOT_OBSERVED**。源码/回归验证通过；未制造模型调用来生成样本。

[运行前](runtime-before.json)、[运行后](runtime-after.json)、[过期观察](runtime-proof-expiry-observation.json)、[最终运行快照](runtime-final.json)、[scoped readback](unknown-scoped-readback.json)、[BOOK readback](admission-readback.json)、[逐行 persisted 对照](persisted-proof-impact.json)。所有值均有采样时点，不保证未来不随行情/续期改变。

## 门禁与环境修正

虽然 main 只比上次验证多 docs，仍在 canonical **D:/MITS** 完整重跑全部门禁：

| 门禁 | 结果 |
|---|---|
| focused Engine / dashboard | 261 / 17 PASS |
| full Engine | 176 files / **1493 PASS** |
| core / dashboard | **58 / 63 PASS** |
| contracts | package policy --passWithNoTests，exit0 |
| typecheck | PASS |
| verify:deps / verify:scripts | PASS / PASS |
| npm run verify | PASS，含再次 typecheck/build/tests |
| formal build | PASS |
| S00 T01–T06 | PASS |
| storage coverage + isolated backup selftest | PASS |
| canonical-build negative-control | **6/6 PASS** |
| git diff check | PASS |
| GitHub Actions | **NOT_RUN_BILLING_LIMIT** |

首次 S00 发现3个忽略的旧 health-monitor 脚本，移入 inactive local archive 后复核通过，未改 S00规则。128个源码文件只有换行差异，复原为已验证 manifest 的原始字节；Git source diff为空，sourceHash完全一致。新 canonical 环境 artifact hash 与旧隔离构建不同，已重新全量测试及正式 build，使用本轮 fresh manifest 验证，不套用旧 buildId。所有初始失败日志保留。

[全部完整门禁](gate-results.json)、[本轮构建日志](formal-build-1.txt)、[negative-control](unknown-proof-negative-control.json)、[换行/遗留脚本记录](canonical-normalization.json)。本轮未修改任何产品代码、Settings、风险/经济阈值、杠杆、Primary prompt 或策略。

## 删除、保全与唯一目录

先盘点 **29** 个 Git checkout/worktree，再执行清理。27个旧手工 worktree移除；Codex audit worktree通过 app 的 archive_worktree 工具归档；仅剩 D:/MITS。包括 cycle-accounting、live-audit、traderecord-auto-sync、trading-quality-convergence、v392/v393、v395 localci、全部 v396 design/offline/project/s00/s01/s03/shadow/convergence，以及嵌套 _codex worktree。逐路径见 [cleanup-receipt.json](cleanup-receipt.json)。清理前后目录清单见 [before](inventory-before.json)、[after](inventory-after.json)。after 盘点时仅有本轮待提交证据，最后交付才确认 clean。

解除了 **92** 个 reparse link，只删除 link，未进入目标。删除6组明确废弃的 backup-live-dist build。其余旧 audit/recovery/private backup/forensic 资料从 D 根目录移入 D:/MITS/backups/local-convergence-20260928，均不再是 active checkout/runtime source。27个 worktree中另保全102个非可重建文件，managed worktree保全12个忽略文件。源码、依赖、旧build的 checkout 副本移除；敏感数据库/凭据/历史私有输出不上传也不删除。[余留目录处理](remaining-container-cleanup.json)。

旧 v395 的48条状态逐项分类：43条独有历史源码/文档/脚本进入 archive ref；2条与main相同；2条私有/未审核内容仅本地归档；1条嵌套worktree独立处理。另发现 v392 audit 21条：20条独有源码/测试进入 archive ref，1条原始样本仅本地。

- v395 archive ref：`refs/tags/archive/v396-local-convergence-20260928-v395` → `d5c8767d9195256f76630f3e79c303ac661c20cf`
- v392 archive ref：`refs/tags/archive/v396-local-convergence-20260928-v392-audit` → `cb92081c900fcf90365664bc55adc75db472c96b`

这些是保全旧历史的**本地** archive refs，不是长期开发分支，也未将整份混合历史推送 GitHub。所有旧 detached HEAD另有本地归档 tag；完整历史已保存并验证 `backups/local-convergence-20260928/all-history.bundle`。本轮生成的报告、脚本和摘要证据全部提交GitHub main；用户允许本地保存的敏感 legacy archive 例外明确保留在本地。[保全 manifest](preservation-manifest.json)、[历史refs](historical-refs.json)、[bundle验证](archive-bundle-verification.txt)。

指定的唯一发布回滚 artifact 位于 **D:/MITS/backups/rollback-fa4fbc8660ef12849644**，source/artifact hashes 与旧 loaded receipt完全匹配，保留启动前日志。其它 legacy private backups 只作历史归档，不是可选 active deployment。当前数据保留 D:/MITS/data。没有新增 task/service/watchdog；原监控任务保持 Disabled，既有 Manual Engine task 无有效 trigger，未调用或修改。

## 交付与停止

新运行实例 READY、identity匹配、保护完整；环境收敛完成。Entry 仍因真实未核实风险 fail-closed，R3自然事件未出现，均已如实记录。没有新增本任务 blocker。已消费本次唯一 lifecycle授权，后续任何 restart仍需新的明确指令。

全部本轮持久化证据 commit/push GitHub main，无 squash/rebase/force。最后交付 SHA、remote equality、clean、单实例和READY复核见 `git-delivery.json`。后续开发只使用 **D:/MITS / main**。
'''
(out/'REPORT.md').write_text(text,encoding='utf-8')
print('Report written')
