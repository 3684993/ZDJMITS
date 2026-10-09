# V3.9.8 P0 — 崩溃证据保障、PR #12 收尾合并与 AI 建仓质量上线计划

**提出日期**：2026-10-09 (+08)  
**状态**：`PLAN_READY_NOT_YET_EXECUTED`；这份文档不是部署回执。  
**源码范围**：`3684993/ZDJMITS` PR #12 / `codex/reboot-orchestration-20261009`；计划基线 `07c966395b19f6b87dd859d411102e92d0f11dcd`，主分支基线 `d1ecbe978df84805f30fc1126bac85584df78011`。实施前必须再次获取实时 HEAD/BASE 与 CI，不能假定其未变化。  
**运行范围**：Windows 11 Pro 25H2、TESTNET Engine 8080；三模型 8081/8083/8084，代理 20091；禁 Production。  
**最高原则**：先保全正常运行的 PID 12432（实际运行 PID 需现场复核）；任何安装、设置、合并、部署都不能把 `health=READY` 假定为 `AI建仓已激活` 或 `崩溃根因已修复`。

## 已知、已证实的背景

- 用户提供的约 12 分钟运行证据：Engine PID12432、build `3.9.8-b40c717775db32ddf33f`、identity6/6、HTTP200 READY、私有账户 READY、行情 LIVE、SQLite HEALTHY、Production写入0，三模型和代理正常。用户目前系统状态：96 GB RAM，可用约59.6 GB，commit59/166 GB，paged pool1.2 GB，nonpaged pool1.0 GB。页面文件调整和重启已降低原高位 pool/commit，但不证明根因。
- 当时的最后快照13个持仓、TP13/13、0开放 Entry；drift5、历史 Entry UNKNOWN215、手工 UNKNOWN2。14→13仓位差异未完成唯一身份溯源。两笔 Engine 自动 TESTNET TP Guardian 订单写已记录，不代表全部交易写入0。
- 旧 PID8524 `0xC0000409` fail-fast 已由 host `CHILD_EXITED` 证明，模块/调用栈/fastfail subcode UNKNOWN。历史Windows Event ID2004资源不足与崩溃接近，但未证实因果；此前没有匹配的 WER dump。详见 `docs/reports/v398-engine-stability-p0-20261009/INCIDENT_FORENSICS_REPORT.md`。
- **本轮 AI 没有新分析的关键原因已由实际源码证明**：`scripts/start-zdj-stack-after-reboot.ps1` 在 Engine 子进程启动前设 `$env:ZDJ_ENTRY_ADMISSION_DISABLED = '1'`；`apps/engine/src/services/runtimeControlService.ts` `canDispatch()` 因此返回 false，`apps/engine/src/services/entryCoordinator.ts` 亦在 Entry 执行/分析路径拒绝。这是明确的 **STARTUP ENTRY LATCH**，不是模型端点故障或 Primary 能力测试结论。不要用无订单的统计冒充“AI自主建仓质量差”，也不能在未完成保护和账户事实复核前随意清除锁。
- 当前 PR #12 13 个变更文件、HEAD `07c9663`、未合并；本地 `npm run verify` 210 files /1901 tests PASS，但对应 HEAD 的 GitHub Actions 返回无工作流 run/无 commit status，**没有远端 CI SUCCESS 证明**。最新主干 3.9.8 源码已包含其他离线/历史改进，主干真实 HEAD/测试/身份需在实施时重新核实。

## P0 阶段 A — 不重启 Engine 的即时崩溃证据保护

目标：下一次自然发生的 `0xC0000409` 能保留下列完整链：`Engine exe/build/source SHA + PID/creation time/instance/host launchId -> Windows WER dump/exception code/subcode/module/stack -> CHILD_EXITED exit code -> JSONL last successful subsystem/event -> Windows System/Resource Exhaustion -> OS commit/pool/handles`。

1. **先只读审计已有捕获**：检查 Engine PID/build/host receipt 的真实路径，`engine-process-lifecycle.jsonl`、parent lifecycle、stdout/stderr、foreground observe、`scripts/collect-zdj-engine-crash-evidence.ps1` 和 `scripts/engine-crash-diagnostics.psm1`；核实源文件写入率、轮转/retention、时间戳时区和磁盘剩余空间。重点保证不同 PID/instance 的日志不会覆盖，并将最后几条成功事件和最后一次可得心跳一起存盘。不得为了日志效果改变 V8/交易路径。
2. **Windows WER LocalDumps（只针对 node.exe 的映像名，不可能按 PID 12432 直接过滤）**：先只读 `HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\node.exe` 与全局设置及 `AeDebug` 的现状并保存私有恢复快照，再用审查过的 `Plan/Apply/Verify/Undo` 脚本、管理员权限和操作者确认设 `DumpFolder`、`DumpCount=2` 或 3、`DumpType=2`（完整 dump，用于保留 native 调用栈/fastfail 参数；如磁盘或私密性不允许，则降级 mini dump 并说明诊断缺口）。路径建议 `%LOCALAPPDATA%\ZDJMITS\diagnostics\engine-wer`，应使用正确类型 `REG_EXPAND_SZ`、明确空间预算与仅当前用户/管理员/SYSTEM 可访问的 ACL；先查磁盘至少有足够的多个实际 Node 进程大小 + 10GiB 缓冲。这个 WER 配置会影响同机其他 `node.exe` 崩溃，不只 Engine；保留旧值并可恢复。不要覆盖已有企业 crash debugger/策略，不启用 Driver Verifier、全局 GFlags、第三方注入器。
3. 需知微软明确说明 LocalDumps 的应用名级配置会在进程崩溃时采集，且自定义崩溃上报或自动调试可能阻止采集。 `0xC0000409` 是 fail-fast，不经普通异常处理器；因此单靠 JavaScript catch、console 和轮询观察不足以取得 native 故障栈。官方依据：https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps 、https://learn.microsoft.com/en-us/shows/inside/c0000409 。
4. 安排**独立、轻量、只读**的证据观察进程或任务（与 `ZDJ-MITS-AfterReboot-TESTNET` 分离）：每30–60秒采样 Engine/host 的 PID+creation identity、exit presence、8080 /health（区分进程死 vs HTTP unavailable）、PrivateBytes/WorkingSet/Handles、Windows commit/commit limit、paged/nonpaged pool、三模型句柄、代理 listener，以及 Windows Event ID 2004/1000/1001 近期差异；CSV/JSONL append-only、flush、容量与保留上限、仅 LOCALAPPDATA。**只观测，不自动重启，不调用 TESTNET 写，不读/导出敏感凭证，也不高频枚举百万对象**。
5. 一旦检测到 PID 已退出 / HTTP 连续不响应：先冻结 PID/instance 身份收据和对应时间窗口，运行已有 `collect-zdj-engine-crash-evidence.ps1`（只在窗口及路径齐备时）或有界安全等价物，计算证据 SHA256 和覆盖缺口；尽早关联 WER dump、launcher CHILD_EXITED、Windows Application/System 事件。无 dump/事件不能写成功；用 `DUMP_NOT_CAPTURED`、`UNKNOWN`。
6. 在**不使当前 PID 崩溃**的前提下，通过只读 `Verify`、沙箱/测试进程自触发的受控 crash fixture（不使用现有 Engine PID，也不与交易所交互），证明 WER 写入权限、文件格式、时间关联、空间配额、证据匿名化和 Undo；如本机运行环境不允许 sandbox crash，则报告 `WER_CAPTURE_UNTESTED` 而非假成功。
7. Windows full dump 含进程内存，可能包含 API keys/令牌、订单和账户详情，绝不可作为普通 PR 附件、GitHub artifact 或上传到公开服务；远端只存 manifest、SHA256、脱敏时间线和栈的必要模块信息。使用本地加密/ACL；避免日志无上限。

**A 阶段成功判据**：配置 `WER_READY` 或明确的 `WER_BLOCKED`；读取式 observer 正常、有界、可回滚；代码/host身份和证据路径可以对上；主 Engine 仍是同一 PID，未因为开启取证被重启或改变交易状态。若配置要求管理员/重启，分开报告，不默认重启。

## P1 阶段 B — 当下 AI 不分析原因与入场质量恢复

1. 通过本机只读运行证据确认当前 live Engine 环境中 `ZDJ_ENTRY_ADMISSION_DISABLED` 的真实值和起源（PR #12 启动脚本已知设置为1），以及 `canDispatch()`、`EntryCoordinator.processPool()`、`scheduler`、`entrySafetyMode`、`executionGovernance`、`routedCandidates`、`FIRST_BLOCKER`、`AI_RESOURCE_PROBE` 的真实状态。**不能把 READY + 三模型 /v1/models 通过等同真实 Primary AI 调用**。
2. 保证进程随时启动、私有同步、reconciliation 和 TP Guardian 与 AI Entry Admission **解耦**。为当前的 startup latch 提供可观察的 `ENTRY_ADMISSION_DISABLED_BY_STARTUP_POLICY` 证据，区分 `ANALYSIS_DISABLED`、`MARKET_QUALITY_NOT_ADMITTED`、`AI_BUSY`、`DATA_BLOCKED`、`NO_CANDIDATE`、`MODEL_FAILURE`、`ENTRY_ORDER_REJECTED`。优先修复状态可观测性与 UI，不允许把原因错误统一成“AI没建仓”。
3. **建议先恢复“分析可见性”而非立即恢复自动提交订单**：实现/复核只读或 shadow 的 candidate/Primary 判定能力，只观察并记录 `NO_DIRECTION_EDGE`、`WAIT_FOR_PRICE`、`REJECT_CANDIDATE`、`PLACE_LONG/SHORT`，确保没有 durable order/Exchange POST。不自行把模拟分析当成正式 AI Entry 质量证据；独立记录每个阶段是否真实调用模型以及因何没有调用。若原架构无真正无写 shadow 路径，则需要先增加隔离受测路径，不能通过清空锁假装只读。
4. **恢复正常自主 TESTNET Entry 之前**：重新查询当前仓位/订单/TP精确覆盖、UNKNOWN风险事实影响范围、实际资金和交易所合法性、Settings/entrySafetyMode、安全准入；检查历史215 Entry UNKNOWN +2手工 UNKNOWN 是否只属历史，或仍绑定当前 pending/identity。不因为有 UNKNOWN 历史就全部禁止正常分析，但也绝不把 UNKNOWN 当已授权订单。保留已有 no-separate-add、同向不独立补仓、冻结候选、Primary 唯一方向与报价量级控制、精确幂等身份、资金约束和 TESTNET-only 约束。
5. 如果要恢复 `ZDJ_ENTRY_ADMISSION_DISABLED=0` 后的全自主 Entry（会允许自然新订单）：提出**明确受控切换与一次必要的 Engine 重启/热配置策略**，在操作者可监督的窗口内执行；此前取得当前 PID 和保护收据。不要通过改其他运行中的 Node 进程环境变量冒充已生效，不要编辑 live SQLite 设置以绕过策略。重启后仍须 identity6/6、新 PID/entry reason、READY 和原 TP/模型/代理复核；如有并行守护者必须先防双启动。普通 Entry write 在 TESTNET 需按现有策略记实，不作“0交易所写”虚假声明。
6. 建仓质量证据：以今天 `main` 中已有的 3.9.8 增强为基准（同向 no-add、side 级独立判断、冻结候选/数量、Primary direction+price-range authority、market quality/admission、组合入场预算），核对当前代码是否全部已合入并在 runtime build 中真实启用。生成从市场候选 -> pre-AI 合法方向 -> Primary输入/输出 -> candidate数量/价格 -> 原始持久授权 -> exchange submit/ACK/fill -> TP保护 -> reconciliation 的**同一自然发生交易的全链路**事实表。历史样本、构建来源不齐时保持 UNKNOWN，不制造信号/强行建仓。
7. 在不主动交易的前提下运行 `scripts/audit-ai-entry-quality.mjs` 等现有只读审计，**其 acceptance 提到不少于50个自然 PLACE 样本且还须成熟收益与fill lineage**。未达到则标记 `QUALITY_IMPLEMENTED_CALIBRATION_PENDING`，而不是声称交易胜率已提高/效果已验证。不要调大模型并发或人为加大名义量凑样本。

**B 阶段交付**：最新真实 AI dispatch 是否启用、模型是否真实被调用、没有分析的第一阻断原因、代表性自然分析证据（若有）、风控和同向补仓行为、订单提交权限状态；必要时给出清晰的可逆启用方案。

## P2 阶段 C — PR #12 合并、主干收尾、正式生效（最小停机）

1. 不把今天多个独立 worktree/branch 直接做未经审查的全量合并。列出 main 当前 SHA、PR #12 当前 HEAD 和完整13文件差异、旧内存分支及 3.9.8 已在 main 的业务变更。排除重复、过时的部署文件和用户私有收据；避免旧版本覆盖最新 trade-record/entry-quality 代码。
2. 确认 PR #12 修复的“两类门禁分离”有测试：warm 8081/8083/8084 不误拦70GiB冷启动门槛；TP UNKNOWN允许Engine进程启动和同步，风险扩大 Entry仍须单独授权；真实 TP/protection仍可自然维护；无生产写；scheduled task 单实例且不重复 Engine；`ZDJ_ENTRY_ADMISSION_DISABLED` 有清晰持久/关闭机制和 UI 观测。
3. 使用最新 clean main/review worktree，完成 `npm ci`、`npm run verify`、PowerShell parse+启动脚本针对测试、S00、source/dist identity 和必要合同回归。无失败测试、无破坏原持仓/账本/资金真实性；提供测试文件数/用例数/源码 SHA。旧本地 CI不能自动当新 HEAD CI success。
4. **GitHub Actions：**先只读获取最新 PR HEAD 的 Checks/Runs；若不存在成功运行，明确 `REMOTE_CI_NOT_PROVEN` 并根据仓库现有合并策略处理，**不得无证据称 SUCCESS**。创建/合并会自然触发工作流是正常范围，禁止未经许可手动 workflow_dispatch / rerun。若合并策略要求检查则确保最新源提交满足要求后再合并。若需调整触发配置，先记录原合同和审查影响。
5. 满足全部门槛后允许由**本机 Codex** 执行 PR #12 收尾合并，并回读 merge SHA、新 main commit/tree及 CI 状态。不要用 CLI 静默覆盖 main、清理 dirty `D:\MITS` 或删除任何 runtime/local evidence。合并动作是 GitHub 代码状态变化，**不等于当前 PID12432 立即加载新代码**。
6. 若合并后的源码与现有 Engine loaded build 有功能性差异（特别是 startup Entry latch、TP、安全 admission），在新的隔离 worktree 中做精确 build/hash、preview deploy 和现场事实检查。优先**不重启当前运行正常实例**，除非业务逻辑必须加载新 build/解除锁且完成上面的授权条件。受控切换时仅一次正式 host 停止/启动，保护原仓位、TP、日志/身份；不强杀、不多次循环重启，不触碰生产。
7. 自动登录任务 `ZDJ-MITS-AfterReboot-TESTNET` 的**实际脚本路径**在当前用户 Codex worktree 中，需检查在工作树清理/PR 合并后仍真实存在；安排稳定、受版本控制的部署/应用路径或明确生命周期重注册策略，保留 disabled 的旧生产任务状态。任务 `Ready` 只说明已注册，不代表下次重启一定工作或已测试该路径。
8. 上线后的验收分两项，独立签字：`ENGINE_RUNTIME_READY`（PID/build/identity/HTTP200/账号/行情/SQLite/TP/模型/代理）与 `AI_ENTRY_ENABLED_AND_OBSERVED`（dispatch控制、自然模型调用、无手工交易、下单正确性/保护、质量样本记录）。若实际无合法可执行候选/没有价格触发，正常不建仓可接受，但必须证明原因可观察，不能为了通过验收人为制造 Entry。
9. 后续进行 **24小时有界稳定性观察**：不应阻塞已经通过的代码合并，但不得在24小时之前把崩溃根因或长周期运行验收标记为PASS。采样进程 uptime、异常 exit、WER dump、内存/句柄/commit、账户保护、TP、drift、UNKNOWN 风险事实和 AI 分析分母。任何崩溃第一步封存证据，不因自动重启/后来恢复而冲掉现场。

## 必须输出的完成文件和状态

Codex 在此计划实施后创建：
- `docs/reports/v398-engine-stability-p0-20261009/CRASH_CAPTURE_ARMING_RECEIPT_20261009.md`（WER是否真实生效、observer、dump目录权限/容量、是否已验证但不公布私密 dump）
- `docs/reports/v398-engine-stability-p0-20261009/PR12_MERGE_DEPLOY_CLOSEOUT_20261009.md`（PR/head/main对比、CI、merge SHA、运行build受控切换）
- `docs/reports/v398-engine-stability-p0-20261009/AI_ENTRY_DISPATCH_AND_QUALITY_ACCEPTANCE_20261009.md`（锁状态、第一阻断原因、模型调用、自然样本、交易保护）
- `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` 更新成“当前主干与真实运行双身份”摘要，只有在可信主干流程中经审查合并后才能改变 main 内容。

状态枚举要分开：
`CRASH_CAPTURE_ARMED | CRASH_CAPTURE_UNVERIFIED`；
`PR12_MERGED | PR12_NOT_MERGED`；
`LATEST_SOURCE_DEPLOYED | SOURCE_NOT_DEPLOYED`；
`ENGINE_RUNTIME_READY | ENGINE_RUNTIME_UNAVAILABLE`；
`AI_ANALYSIS_ENABLED | AI_ANALYSIS_BLOCKED | AI_ANALYSIS_NOT_OBSERVED`；
`AI_QUALITY_CALIBRATED | AI_QUALITY_INSUFFICIENT_NATURAL_EVIDENCE`；
`HISTORICAL_CRASH_CAUSE_UNKNOWN`。

**权限边界**：用户本轮希望 Codex 实施崩溃证据保护、PR #12 收尾合并并使 3.9.8 改进生效；但不得把这解释为生产交易、绕过交易所合法性和幂等保护、销毁现有状态、无限制重启/下单或泄露 WER dump 的许可。任何真实新订单准入改变必须先单独确认当下账户风险与可回滚性，并在现场明示是否会带来 TESTNET 自然写。