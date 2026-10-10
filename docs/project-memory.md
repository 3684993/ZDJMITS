> **网络P0接续（2026-10-10 22:00+08）：** 新ChatGPT提示词 `docs/prompts/CHATGPT_V398_NETWORK_CONGESTION_NEXT_CHAT_20261010.md`，Codex执行书 `docs/prompts/CODEX_V398_NETWORK_CONGESTION_EXECUTE_20261010.md`，主计划 `docs/plans/V398_NETWORK_CONGESTION_ENGINE_ISOLATION_RECOVERY_20261010.md`。Engine OFF、SSH同PID12212后公众访问4/4成功/sshd Send-Q基本0；Engine ON曾0/8失败且2.7MB积压。PR41双CI成功未merge，PR42减全市场WS draft/CI进行，下一步CI后受控发布、必要服务重启和30m+90m稳定验收；当前签名TP及私有事实UNKNOWN。历史描述以新计划为准。
>
> 2026-10-10 代理恢复与管理更新：原固定脚本恢复SSH10588→18988，独立公共时间验证曾PASS7078ms，但后续SOCKS_CONNECT_REPLY复验超时8030ms，不能声称稳定连通或私有同步恢复。队列超时与真实连接失败分别取证。隔离分支实现保存/激活/启动自动验证、未配置/失败/过期提示，以及系统设置的授权启动/重启代理；固定脚本、同源令牌、进程身份、互斥、超时和审计，保留全部交易保护。npm ci/verify:ci PASS，最终类型检查及48项后端/6项界面测试PASS。精确CI和部署状态随后补齐。见 docs/reports/v398-proxy-recovery-20261010/IMPLEMENTATION.md。模型未重启；新24h仍NOT_STARTED。

> 2026-10-10 20:18 北京时间已实际部署（覆盖下方 NO_GO 历史）：用户重新明确授权强制停止 Engine，并撤销 Engine 启动/重启前的新鲜签名 TP/私有同步发布门禁，要求保持建仓授权。执行一次 Stop-Process -Force，仅停止旧 Engine12140；新 host25736 / Engine13476 / instance d78966bf-820d-4cad-8ab0-b993774b2a21 已监听0.0.0.0:8080。源码 e3dc48b6832f48569b76a1240bb8040f5f6f3dfd，build `3.9.8-a790207862ad258b41a0`，sourceHash/artifactHash与封存包一致。npm ci/build PASS，精确源码两次 GitHub CI SUCCESS。
>
> 本次及后续 Engine 生命周期不再以新鲜签名 TP/私有同步作为用户要求的发布前置拦截；这些事实仍如实显示 UNKNOWN/不可用，不伪造PASS。本次更新了精确构建的 ONE_TESTNET_ENGINE_SWITCH 审批绑定，保留原审批文件与原到期时间；启动参数 TESTNET_ENTRY_ENABLED / admissionDisabled=0，浏览器显示 AUTO_RUNNING、TESTNET自动建仓已启用。Primary唯一建仓、禁止补仓、HUMAN_MANAGED、交易TP保护及Production隔离代码未删除。
>
> 三模型 Scout25912/Review22880/Primary16772未重启。同一路由异常SSH代理已用原管理脚本重建，PID18300→10588，出口/凭据/主机/端口不变，原生公共时间探测PASS；Node交易网络仍超时，私有事实不可用、行情不足，暂未观察到新可执行候选或重启后新建仓。当前health OFFLINE描述交易链路而非进程已退出；8080、WebSocket与实际新驾驶舱正常。余额/七日收益缺失显示灰色UNKNOWN，本地24h盈亏、多空敞口、资金费归因和订单证据新图表已在实际8080页面确认。本地TP27/27不等同新鲜签名保护PASS，Production writes/blocked attempts0。
>
> 一致性备份 quick_check=ok/fsync/Settings253匹配；启动任务及既有只读崩溃观察器指向新发布包/receipt。额外GPU采样仍停止，未擅自重启健康模型、删除交易保护或启动24h；新24h NOT_STARTED/T0=null。真实收据、强停脚本、代理恢复日志与上线截图见 `docs/reports/v398-cockpit-visual-20261010/FORCED_DEPLOYMENT_RECEIPT.json`。本次是明确操作者授权的强制切换，不能冒充优雅退出或健康交易验收通过。

> 2026-10-10 最新重新授权部署实测：用户再次授权立即部署/Engine重启，已准备精确CI通过的 e3dc48b 源码独立发布包，npm ci 与完整工作区 build PASS，候选 build `3.9.8-a790207862ad258b41a0`。两次独立新鲜签名 TP 核验均在 SOCKS_NEGOTIATION 阶段超时，保护评估 UNVERIFIED；末读私有同步 age=105659ms、consecutiveFailures=3，超过30秒门禁。当前本地TP27/27不能代替新鲜签名证明。本次发布 NO_GO_FRESH_SIGNED_TP_UNVERIFIED，未停止/启动 Engine12140，未重启模型、修改授权/TP或进行人工交易所写入；优雅退出路径也尚未重新证明。新24h NOT_STARTED/T0=null。失败证据及构建日志：`docs/reports/v398-cockpit-visual-20261010/AUTHORIZED_DEPLOY_RECHECK.json` 与 `e3-*`；源码完成与发布包构建不等于上线。以下历史交接保留。

> 2026-10-10 20:00 北京时间维护交接（覆盖下方历史状态）：PR #40 已在精确 HEAD `e3dc48b6832f48569b76a1240bb8040f5f6f3dfd` 的两次 CI 全部 SUCCESS 后合并 main，合并提交 `7495b7d3fcc4d54a454faff23e004134363c5be7`。CI：https://github.com/3684993/ZDJMITS/actions/runs/38049860753 、https://github.com/3684993/ZDJMITS/actions/runs/38049858036 。PR #39 已合并；PR #37 仅选择性整合，不另合并。
>
> 已提交图表：首屏 USDT/USDC 可用资金结构及红黄绿灰阈值、交易所七日收益、本地24小时账本盈亏、资金费、持仓及 TP 风险、有证据的采样趋势；新增双币种权益勾稽、多空名义敞口、资金费归因覆盖、交易所确认委托与本地 UNKNOWN 分层。源码合并不代表部署。
>
> 当前发布仍 NO_GO / NOT_DEPLOYED：上一轮向 Engine12140 发一次 Ctrl+C，45秒未优雅退出，未启动候选 Engine。本轮仅 GitHub 合并、源码同步和交接；未再发退出信号、强杀、重启模型或修改交易授权。在线版本仍是 source `2c9fec513bd5ba0406015c33b2c7cf9ce420ebaf`，Engine12140；三 Qwen 沿用现有健康进程。用户要求停止额外工作后，额外 GPU 采样器通过固定管理器 Stop 标记停止且计划任务禁用，开发预览关闭。旧24h ABORTED_SAFETY_FAILURE；新24h NOT_STARTED / T0=null，等待用户指令。不得据旧保护快照授权部署。
>
> 本机干净任务工作树同步 main；`D:/MITS` 有既有删除/未跟踪文件，保留原工作目录和分支，未 reset/clean/stash。合并收据见 `docs/reports/v398-cockpit-visual-20261010/PR40_MERGE_RECEIPT.json`。本交接是文档同步，不进行额外开发、性能采样、观察或故障排查。

> 最新最终状态（2026-10-10 18:27 北京时间）：已实际部署源码2c9fec513bd5ba0406015c33b2c7cf9ce420ebaf，构建3.9.8-a6b1702cf52af4257f04，Engine12140/host1216/instance2c07d7d9-7f73-4730-903f-20d26674aa2a，运行身份6/6，health READY。旧Engine23936收到隔离CTRL_C/SIGINT后退出0，只有一次Engine切换。重启前、稳定后签名全仓TP均28/28，canTrade=true，Production0；先前网络超时、29/27及28/27失败证据保留。三模型25912/22880/16772均READY。线上浏览器三资源启动/停止/重启按钮显示，填本机密钥后启动/重启可用；三次授权启动200且PID不变，无密钥403。源码CI38043800329 SUCCESS，264文件/2211例。新24h未启动/T0=null。额外GPU侧车采样启动被平台执行前拒绝，未执行，实时显存UNKNOWN，不虚报新鲜采样。旧观察器PID1920独占锁已按身份切换，新观察器6376绑定新receipt并Running。

> 18:11部署门禁更新：独立签名复核29仓位，仅27仓位TP精确身份PASS；随后在线Engine28/27，missing=1/retryQueue=1/DEGRADED。新鲜签名全仓TP门禁不通过，Engine未退出/未部署；这是实际交易保护失败，不是平台权限拒绝。三模型继续健康，Primary唯一Entry与Production0保持。新构建2c9fec5/a6b1702c已编译封存且私有审批仍revoked=true；新验收T0=null。

> 最新覆盖状态（2026-10-10 18:06 北京时间）：Review 原脚本已实际启动，PID22880/8083/Vulkan1；Scout25912/8081/Vulkan0、Primary16772/8084/Vulkan2均健康。三模型进程身份与原脚本SHA已只读验证。三卡同时实测专用显存约5.92/17.28/17.28GiB；Review两次启动推理各生成38tokens。当前Engine仍23936/6533，按钮源码与权限/互斥/超时/审计已存在，新增重复启动READY模型的幂等修复；此刻尚未部署。旧验收ABORTED，新T0=null。历史拒绝记录不代表本次执行结果。

## 2026-10-10 17:42 实际部分恢复：Scout/Primary成功，Review未执行

本轮正常工具实际允许Scout/Primary创建启动器；第一次Scout因Windows RemoteSigned和三原脚本ZoneId=3而未加载。已核验三文件Git内容无diff、SHA256一致，仅对用户明确指定的三文件执行Microsoft Unblock-File；标记已私有备份，未修改全局/用户/组策略、脚本内容或TP/交易保护。随后Scout25912/8081/Vulkan0/ctx32768与Primary16772/8084/Vulkan2/ctx65536实际启动，health=ok，原启动器真实smoke完成；Scout还有两次新自然Engine完成，Primary此样本未观察新自然Engine run，勿将startup JSON smoke等同自然Entry。

Review8083原harness脚本启动请求在CreateProcess前被平台blocked by policy拒绝，没有细项，没有启动器/模型PID，不换包装/通道绕过。实际2/3恢复，不宣称全部完成。D3DKMT+WDDM主要显存：Scout PCIbus5约6,357,635,072bytes，Primarybus19约18,526,982,144bytes；跨卡少量分配保留。两模型同时加载commit52,047,556,608/limit178,217,693,184bytes；未加载Review，三模型预算尚UNKNOWN。

当前Engine23936未重启/未部署，17:42本地TP26/26 READY且问题计数0、Production0；这只是本地保护读回，不伪称此次新增签名全仓门禁。旧08:34验收ABORTED、新24h NOT_STARTED/T0=null。原退出发起者/退出码仍UNKNOWN；本轮Windows来源标记只解释新Scout首次启动失败，不解释旧llama退出。运行证据和启动/推理事实日志在actual-partial-recovery-1742.json及actual-*.log。完整本机日志D:/MITS/logs/model-start-20261010-173800。

## 2026-10-10 17:20 用户指定scripts/1立即启动补充

用户新指定D:/MITS/scripts/1三原始启动器，已实读存在/hash/context：Scout32768、两27B65536，不同于已封存P0版本。正常Scout启动请求再次在CreateProcess前blocked by policy，脚本未运行，无新PID/回执；Review/Primary未尝试。没有删除保护或换通道绕过。原始三条主机运维命令及日志路径见 [USER_SPECIFIED_SCRIPTS_REQUEST](./reports/v398-model-lifecycle-recovery-20261010/USER_SPECIFIED_SCRIPTS_REQUEST.md)。私有manifest和正式Engine封存未改，旧Engine管理TP不变。新24h仍NOT_STARTED/T0=null。

## 2026-10-10 立即模型恢复授权的最新实际执行状态

已拉取 main4c846312，源码/脚本/lock与PR38 d390等价。本轮重新 npm ci / verify:ci EXIT0，264文件2210例；独立发布包构建成功，1999文件封存与Settings253对照通过。候选build3.9.8-5b239d299d94d9ce70a8只STAGED，未上线；新精确授权仍inactive。

Scout8081原始启动器正常终端请求再次在CreateProcess前被平台 blocked by policy 拒绝，没有执行/新PID；Review/Primary和Engine生命周期未尝试。当前工具approval policy never，无可用交互升级，不换包装/通道/删保护绕过。用户授权明确，不再索取一般许可。主机操作者原有三段启动命令及日志步骤见 [HOST_OPERATOR_RECOVERY](./reports/v398-model-lifecycle-recovery-20261010/HOST_OPERATOR_RECOVERY.md)。正式报告 [FINAL_RUNTIME_RECOVERY_AND_DEPLOYMENT](./reports/v398-model-lifecycle-recovery-20261010/FINAL_RUNTIME_RECOVERY_AND_DEPLOYMENT.md)。

末查17:00+08旧Engine23936/host12440/build0de766不变，代理18300/20091。三模型无监听，真实connection refused，退出发起者/退出码UNKNOWN；不能称修复退出根因或恢复推理。两次签名26/26 TP全身份通过；独立V2 canTrade=true，末私有age8134ms/失败0；Production0，Engine自然TESTNET写51/任务交换写0。本轮备份quick_checkok+fsync/Settings对照，旧29→28/cycle失败及TP缺口仍保留。现有stop-zdj-lan用Stop-Process -Force，不能冒充graceful；旧实例优雅停止路径未证明前不得强制切换。

旧24h08:34 ABORTED保持，新24h NOT_STARTED/T0=null等用户后令。准确区分source验证、STAGED、平台拒绝、运行恢复未执行及未部署；本轮 [Draft PR #39](https://github.com/3684993/ZDJMITS/pull/39) 首次精确HEAD ee4bab35e84fa054a90e730ec9a745bedbf6d490 Windows CI38040055297 SUCCESS，全日志另存github-actions-immediate.json；后续归档HEAD仍单独回读，不借PR38其它SHA绿灯。

# 2026-10-10 用户要求立刻恢复全部模型与部署（最新权威状态）
- 用户明确要求在 Windows 主机**现在受控部署并逐个启动已离线的三个Qwen模型**，无需反复概念性许可。PR38源代码已验证本机2210 tests和GitHub两个exact-head SUCCESS，已于2026-10-10由ChatGPT合并`main`，合并SHA `84d5d4f81b3ad6c73b1f7744c441d4f887de9638`。
- GitHub主分支已提交立即执行指令：`docs/prompts/CODEX_V398_IMMEDIATE_AUTHORIZED_MODEL_RECOVERY_20261010.md`。Issue#30/#35和PR#38已留正式交接评论。当前GitHub连接**不能操作本机Windows，也不具备Codex任务启动接口**；合并/评论不是启动。部署、三个模型真实推理验证、实际Engine重启仍**NOT_PERFORMED / NOT_PROVEN**，新24小时验收T0=null，旧验收ABORTED。
- `blocked by policy` 是Codex外部执行环境的自动审批拒绝，执行日志显示`attemptExecuted=false`，无详细拒绝规则；不是本项目后端`MODEL_OPERATION_PERMISSION_DENIED`。无法靠删库内模块移除平台审批。Codex须通过正常交互授权或经主机授权的操作者执行，不得绕过平台访问控制。项目模型令牌、固定manifest/hash/PID/锁/drain以及现网签名TP/TESTNET/Production0不可去掉。
- 截止证据：Engine23936、旧source6533/代理仍运行，三个模型没有监听，退出根因UNKNOWN，后一次signed TP 28/28，之前1次29笔身份不一致不能抹去。最新现场保护门禁必须在操作时重新检查。**后续工作以真实主机恢复和运行证据为优先，不再停留在日志推断/PR Draft中。**

---

# 2026-10-10 三模型离线维护最终 GitHub 交付

Draft PR38；最终源码 d39024d97f681c46c94e7537dd688f6bf271096a，主实现43eca77；本机264文件/2210测试及完整 verify:ci PASS，精确源码 Windows CI38032096492 SUCCESS（完整日志已归档）。模型管理后端及设置按钮、AI/代理/交易网络/私有同步灯已提交，默认管理操作关闭，正式部署需私有 manifest/运维密钥/审查过的 PowerShell7 PATH。

本轮恢复和部署**未完成**：自动审批拒绝离线Scout启动（blocked by policy、未提供详细理由），命令没有执行，未改用其他机制绕过。Engine23936/旧source6533仍在线；三模型无进程/监听，退出发起者UNKNOWN，实际推理成功NOT_PROVEN。最后签名TP28/28、独立canTrade=true、Production0；首次29笔本地身份失败保留。没有模型启停、Engine重启或人工交易所写入。新24h仍等待用户后续指令/T0=null，旧08:34 ABORTED。

[PR38](https://github.com/3684993/ZDJMITS/pull/38) · [精确源码CI](https://github.com/3684993/ZDJMITS/actions/runs/38032096492) · 报告/收据 `docs/reports/v398-model-lifecycle-recovery-20261010/`。证据后续提交仅文档，与验证源码等价；不得宣称这些按钮已经上线、模型已恢复或新验收已启动。

# 2026-10-10 三模型离线 / 模型生命周期管理进行中

最新工作在独立 `codex/v398-model-lifecycle-20261010`，基线 main ffdc99e。现场 PROVEN：8081/8083/8084 无监听、无 llama-server 进程；Engine23936 和代理18300继续运行。退出触发者 UNKNOWN，末尾日志是推理完成/slot release，无对应已检出崩溃记录。旧 AI aggregate health 仅数配置造成 HEALTHY 误报，源码已修复。新后端/设置 UI 提供固定清单启动/停止/重启、权限/身份/互斥/在途/超时/审计保护，默认操作关闭。

一次离线 Scout 启动被自动审批拒绝（blocked by policy，无详细理由），未执行、未绕过。模型实际推理恢复 NOT_PROVEN；本轮部署 NOT_PERFORMED；不能复用旧生命周期命令或声称新代码已上线。签名第一次29个数量方向价格双ID匹配但一项本地身份失败，第二次28/28全身份通过，独立canTrade=true，失败样本保留；部署/恢复仍须行动时新鲜保护门禁。报告与测试：`docs/reports/v398-model-lifecycle-recovery-20261010/`。旧08:34 ABORTED；新24h NOT_STARTED_WAITING_USER_INSTRUCTION/T0=null。Primary唯一Entry、禁止补仓、HUMAN_MANAGED、TP保护、Production零写入不变。长时间 GPU provider、退出根因、既有TP短暂失配/大baseline同步仍待闭合。

# 13:31+08 final bounded readback

Latest source6533e4d identity6/6, signed/localTP30/30/canTrade true/private9.08s/Production0. A second13:29 signed/local29/30 gap also occurred and was retained, not upgraded toPASS retroactively. Natural runtime TESTNET counter14; manual task exchange writes0. No continuous safety/24h PASS is claimed. Deployed updates available for user inspection; new long acceptance remainsNOT_STARTED/T0=null. GPU collector is real but bounded~1h; persistent sampling and TP gap root cause plus large-baseline sync failure remain follow-up.

# Latest actual deployment / user hold (2026-10-10)

PR36 source6533e4d5bbedfe758336f3dd40c188bad37413cd integrated PR31/33/32/34, local2200 PASS and exact CI38025974065 SUCCESS. Main FF and ONE Engine-only stop/start: Engine23936/host12440/instance d071f59f-9eba-4efa-b3da-3d4289f3671f/build3.9.8-0de7665352d82b261c1d. Identity6/6; final fresh signed+localTP30/30/canTrade=true/private fresh/Production0. Six requested live records TP, false conflicts fixed; real assets top once, duplicate funds panel removed, eligible USDC routing rank retained; native24h visible withSYNC_ERROR. Preserve the observed post-start local29/30 mismatch/cancel/repair gap as a real failure sample, not erased by recovery; no manual exchange/Settings writes. Crash observer rearmed; model/proxy PIDs unchanged. GPU bound read-only241x15s provider yields actualMEASURED data but ends in~1h;45sTTL thenSTALE, persistent wiring remains follow-up. AutoSync large512MiB baseline/transport issue unresolved; no online DB repair.

Latest direct user: inspect deployed changes before long acceptance. NEW24h NOT_STARTED_WAITING_USER_INSTRUCTION,T0=null. Old08:34 ABORTED and paused heartbeat retained. Never start a long observer or reuse oldT0 without the subsequent user instruction. All receipt/CI/safety/raw-free evidence: docs/reports/v398-trade24h-release-20261010/. Earlier pending paragraphs below are historical and superseded by this receipt.

# 2026-10-10 Trade24h integration update

PR34+31+33+32 isolated integration and source repairs: docs/reports/v398-trade24h-release-20261010/. Local verify:ci 2200 PASS; exact combined hosted CI pending. Six requested cycles read-only replay 6/6 TP after strict writer/read-side fix; genuine identity conflicts retained. USDC eligible alternate rank fixed; real assets moved to homepage top; duplicate funds-admission removed. AutoSync ERROR includes oversized512MiB baseline, queue timeout and socket errors; no live ledger rewrite or guard widening. First signed29/28, subsequent signed30/30; action-time gates and candidate release identity still required. No deployment/restart/new acceptance yet. Old08:34 ABORTED preserved. Latest user: long24h only after their inspection and explicit later instruction; T0=null.

# 2026-10-10 12:18+08 · 交易记录24小时盈亏与退出来源冲突修复（新增任务）

ChatGPT 本轮已从GitHub核对 Draft PR31/33/32 的精确HEAD与CI SUCCESS，当前main仍为 `b55f427eeda150c7cdc7b8beaaaddfd39aa9e6e1`，三个PR均**尚未合并/部署**。按用户新授权已提交隔离分支 `chatgpt/v398-trade24h-provenance-and-release-20261010` 的真实代码：
- `apps/engine/src/services/trade24hReadModel.ts` / tests，`apps/engine/src/api/router.ts`：GET `/api/v3/trade-records/24h`，仅用settled `closedAt` + 唯一cycle + 本地双订单关联及守恒事实，分别统计 USDT/USDC 过去24小时完整交易盈利/亏损/净值/费用/funding覆盖。缺少资金费不影响 ex-funding，但正式 all-in 仍严格资格；金额未知不造0，USDT/USDC无FX不汇总。后端在24h裁剪后才做昂贵per-cycle projection，避开无关历史。
- `apps/dashboard/src/views/TradeRecordsView.vue` + `api/client.ts`：新增最近24h分币种盈利、亏损及净额/手续费与sync coverage warning。独立于此前性能驾驶舱PR31。
- `apps/engine/src/services/exitProvenance.ts` + test、`apps/dashboard/src/views/tradeClosePresentation.ts`：源冲突不静默修成TP；新增可核查具体原因/证据状态，UI明确 `integrity classification conflict=0` 与 `exit closeProvenance=CONFLICT` 口径不同。六条现场 CONFLICT 要在主机只读对比 registry+TP/manual订单、双ID和qty，再修事实或真实误报。
- **本轮Codex指令**：`docs/prompts/CODEX_V398_TRADE24H_CONFLICT_AND_CONTROLLED_DEPLOY_20261010.md`；实施回执 `docs/reports/v398-trade24h-release-20261010/INITIAL_CODE_AND_SAFETY_STATE.md`；后续必须完整 verify/CI、综合 PR31/33/32和本PR整合CI、受控部署实证并Github存档。

**旧24小时尝试已在北京时间2026-10-10 08:34:00.270 因 LOCAL_TP_GATE_NOT_CLOSED 正式 ABORTED**（main `acceptance/state.json` 已终止），没有有效旧计时可继续/再停止；用户明确授权后续一次满足门禁的Engine-only受控重启和完整**新T0**24h。当前没有Windows主机部署工具，GitHub PR、CI不等于本机部署；02:10Z signed25/25只是历史，只读最新全仓签名TP/Production0/TESTNET/私有同步/订单双ID/no-add/HUMAN_MANAGED及备份任何UNKNOWN即 NO_GO，不得为赶进度停保护Engine。后续Codex获用户正式重启授权，但不能绕过安全性证明。
> **GitHub main 更新（提交 b55f427eeda1，2026-10-10 09:36+08）：** `main` 已将原24h验收终止原始证据同步到 `docs/reports/v398-engine-cutover-20261010/acceptance/state.json`（现为 `ABORTED_SAFETY_FAILURE`）及 [ACCEPTANCE_ABORT_RECEIPT_20261010.md](https://github.com/3684993/ZDJMITS/blob/main/docs/reports/v398-engine-cutover-20261010/ACCEPTANCE_ABORT_RECEIPT_20261010.md)。本功能分支始于更早main 662d7f3，若本分支文件仍有旧08:24 `RUNNING`，是尚未同步main的历史遗留，不能据此推翻最新权威已中止状态。Codex必须先核对最新main的验收事实和PR #31合并基线，避免旧文档覆盖新证据。该更新是文档证据同步，不是重启或新24h开始。

# 2026-10-10 09:35+08 之后的新实施进度 — 性能仪表盘首批实码已在GitHub分支

**最新优先交接**：本轮 ChatGPT 已核对原始验收ABORTED证据并提交了真正可接入真实OS/Engine只读数据的首批性能驾驶舱到 GitHub branch [`chatgpt/v398-performance-real-metrics-d0-d2-20261010`](https://github.com/3684993/ZDJMITS/tree/chatgpt/v398-performance-real-metrics-d0-d2-20261010)。**还未合并main、未本机npm测试、未部署、也未开启模型负载借用。**
- **直接Codex任务指令**：[CODEX_V398_GPU_PERFORMANCE_DASHBOARD_PHASE1_20261010](./prompts/CODEX_V398_GPU_PERFORMANCE_DASHBOARD_PHASE1_20261010.md)；**实施执行板**：[V398_GPU_PERFORMANCE_EXECUTION_BOARD_20261010](./plans/V398_GPU_PERFORMANCE_EXECUTION_BOARD_20261010.md)；**真实源码交付收据（未验证）**：[CHATGPT_INITIAL_CODE_DELIVERY](./reports/v398-performance-dashboard-20261010/CHATGPT_INITIAL_CODE_DELIVERY.md)；主任务Issue[#30](https://github.com/3684993/ZDJMITS/issues/30)。
- 已提交实码：Engine Native CPU/RAM/EngineRSS/heap轻量采样+只读`/api/v3/observability/performance/host`；Dashboard Vue3/ECharts5 `/performance` 中文页面、AI/私有同步/代理红黄绿灰灯、真实有限AI run统计、主机实时趋势和交易TP/收益现有可信快照。GPU/PCI/VRAM、真实token/s/SSH wire流量证据未取得，明确展示UNKNOWN而非伪造；须由Codex接下去实测补采样/测试/CI。GPU2 Review/Primary跨角色借用需后续独立统一原子capacity lease PR，不可只改route。
- **验收状态重要更正（证据优先）**：`main` 中 `docs/reports/v398-engine-cutover-20261010/acceptance/state.json` 08:24的RUNNING已过期。PR#25分支的 `docs/reports/v398-network-optimization-20261010/acceptance-aborted.json`、`acceptance-abort-checkpoint.json` 是原监控副本，证实 **2026-10-10 08:34:00.270+08 原24h验收ABORTED_SAFETY_FAILURE / LOCAL_TP_GATE_NOT_CLOSED**，本地TP14/15 missing1，private15.952s，Production0。后来本地TP缓存17/17不等于所有当前仓位新鲜签名验证，原验收**不可恢复、续算或判PASS**。仍不得为了dashboard/模型利用率而先重启安全保护Engine；先只读验证最新TP身份和当前新attempt。
- 网络并行开放PR [#25](https://github.com/3684993/ZDJMITS/pull/25) Demo WS routing、[#27](https://github.com/3684993/ZDJMITS/pull/27) REST recvWindow/weights、[#29](https://github.com/3684993/ZDJMITS/pull/29) scoped mark feeds；各自CI已通过但未merge/deploy。本轮不要误把这些来源当前main；HTTP451及地理限制不等于代理BUG，禁止绕过。
- 接下来由Codex独立worktree修复本分支所有TS/Vue/类型/样例不足，单测/full verify/S00/CI、物理bus19/bus22→PID/8083/8084 mapping30–60m真实任务基线、Windows GPU sampler/数据合同/模型任务归因，再分独立G1原子lease、R2 TP SHADOW小PR。所有报告、测试记录、脱敏截图都必须在GitHub `docs/reports/v398-performance-dashboard-20261010/`，不能只放本机；原始秘钥/私有订单/数据库例外严禁上传。NO_SEPARATE_ADD、Primary唯一Entry、HUMAN_MANAGED、TP、Production0依旧优先。


---

## 2026-10-10 新聊天入口：v3.9.8仪表盘性能优化（GPU2利用率及统一驾驶舱）

- **主新ChatGPT提示词**：[CHATGPT_V398_PERFORMANCE_DASHBOARD_GPU_NEXT_CHAT_20261010](./prompts/CHATGPT_V398_PERFORMANCE_DASHBOARD_GPU_NEXT_CHAT_20261010.md)。
- **完整实施计划**：[V398_DASHBOARD_GPU_OBSERVABILITY_AND_PERFORMANCE_PLAN_20261010](./plans/V398_DASHBOARD_GPU_OBSERVABILITY_AND_PERFORMANCE_PLAN_20261010.md)。
- **Codex任务**：[Issue #30](https://github.com/3684993/ZDJMITS/issues/30)，关联Issue #26 (双RX7900XTX 27B物理负载与统一原子lease)、#28 (持仓/挂单/TP Review SHADOW)、#24 (Binance REST/WS/SOCKS)、#23 (ENA“补仓一次”原始订单身份)。
- **实际源码已核实：** Dashboard Vue3 + Pinia + ECharts5 + Vue Router；现有Overview/Operations/Brain及EquityChart、/brain/resources、/brain/runs、/diagnostics/binance-governance、/diagnostics/market-stream-traffic、/diagnostics/private-sync、/observability/entry等可复用。当前缺真实物理PCI↔模型PID8083/8084↔GPU利用率与主机内存的已验证绑定、统一历史曲线数据合同和跨代理/LLM/交易时间轴；须先只读证实而非以模拟指标掩盖。
- **功能**：新增中文“性能监控”页面（/performance），CPU/内存/EngineRSS、B580+双RX7900XTX VRAM与GPU、Scout/Primary/Review的请求状态与tokens/s/queueP95、代理SSH/SOCKS/HTTP状态/451与private freshness、REST/WS、真实Primary→Intent→Order→Fill→TP→Exit漏斗、持仓时间/Review/退出、手续费/资金费/realized与unrealized盈亏、UNKNOWN账务，交互图表和15m至7d窗口。直接使用ECharts5，低开销read-only采样与同实例时间戳，不引入浏览器到交易所私有直连。
- **优先级**：D0数据字典/物理PCI进程映射和真实30–60分钟自然任务基线；D1本机受限Windows CPU/RAM/GPU/模型指标sidecar采样且与Engine只读诊断统一；D2真实可用新视图；D3两27B原子capacity lease、空闲借用和挂单/持仓Review，TP目标仅SHADOW；D4专项回归/完整verify/CI。必须提交实码/测试/PR，不能永远只交审计文档。
- **部署边界**：截至原回执Engine3.9.8-bb45c11 PID23688，24h T0 2026-10-10 08:16:49.685+08，原定结束10-11 08:16:49.685+08，最新验收状态需只读回读；未确认PASS不得声称成功。**此GitHub文档任务不修改现网Engine、模型、代理或TP、不重启/部署、不改Settings253**；真实改运行需用户另行授权并遵守验收重新计时。硬约束TESTNET、Production0、严格NO_ADD禁止补仓、Primary唯一Entry、HUMAN_MANAGED、签名TP身份和UNKNOWN fail-closed。历史451不无证据重标代理故障，更不能轮换地区出口规避。

## 2026-10-10 持仓/挂单管理与第二个27B Review职责优化

源码实查方案：[V398_GPU2_POSITION_PENDING_TP_REVIEW_OPTIMIZATION_20261010](https://github.com/3684993/ZDJMITS/blob/main/docs/plans/V398_GPU2_POSITION_PENDING_TP_REVIEW_OPTIMIZATION_20261010.md)；执行任务：[Issue #28](https://github.com/3684993/ZDJMITS/issues/28)，与[双GPU容量调度Issue #26](https://github.com/3684993/ZDJMITS/issues/26)以及[网络Issue #24](https://github.com/3684993/ZDJMITS/issues/24)共同实施。

结论：当前Engine负责全部仓位/挂单事实、持仓FIRST_FILL时间与管理deadline、5s TP Guardian/15s reconciliation、Entry pending外层2s tick。默认nearMarket TTL90s/改价5s/最多6次，但实际Settings253未独立核实；27B Review8083的pending第一次调用>=15s/以后间隔>=30s，提出KEEP/CANCEL/REPLAN，后两者精确查旧双ID再撤单，不自动新开仓。持仓Review15s tick但有plan/owner/minInterval/预算限额，PositionReviewV396仅HOLD/REDUCE_PROPOSAL/EXIT_PROPOSAL/HANDOFF，**不允许模型给任意新止盈价或数量**。TP Guardian发现WORKING且数量/方向匹配时直接保留现价，不进行常态化动态调整；只有创建/修复进入价格选择与严格原订单撤销/替换。AI Exit代码默认为OFF，实际需查Settings。

R0只读GPU2 utilization/task/no-plan/owner/queue原因与真实持仓、挂单age; R1离线同origin单action lease及模型任务deadline；R2独立TP_TARGET_REVIEW_DRY_RUN只从合法冻结目标ID选择，先SHADOW，**不能写交易所或取消原TP**；R3与Issue26统一单GPU maxConcurrency=1原子容量租约，角色保持Primary独立Entry；R4专项TP/NO_ADD/UNKNOWN/partial fill/HUMAN_MANAGED测试和完整CI独立PR。严格禁止补仓；ENAUI“补仓1次”身份仍待Issue23核对。**当前24h验收期不部署、不改Settings/代理/模型/TP，不重启Engine**，如将来获批变更则完整重新计时。
## 2026-10-10 双27B GPU占用失衡专项（静态审计/离线优化，未部署）

方案：[V398_DUAL_27B_GPU_UTILIZATION_AND_DUTY_SCHEDULING_20261010](https://github.com/3684993/ZDJMITS/blob/main/docs/plans/V398_DUAL_27B_GPU_UTILIZATION_AND_DUTY_SCHEDULING_20261010.md)。Codex任务：[Issue #26](https://github.com/3684993/ZDJMITS/issues/26)。默认Settings固定8084/27B为ENTRY_PRIMARY，8083/27B为POSITION_REVIEW/PENDING_ENTRY_REVIEW，各maxConcurrency1，当前不是真正两卡负载均衡。实际物理PCI bus19/bus22→8083/8084进程必须先只读核对，不能猜。源码aiFabric.dutyResources只会返回每职责已配置资源；choose不能跨角色借用；queueReview用reviewActive而Primary run另用load.active，**不能直接加候选路由形成超额GPU并发**。按G0现场指标与模型hash/ctx等价性、G1离线统一perGPU原子lease和overdue Review保护、G2离线压测/CI后独立PR，只有另行获用户授权才部署；不得干扰当前24h验收、Engine/两个模型/代理、Primary唯一Entry、禁补仓、HUMAN_MANAGED、TP保护和Production0。

## 2026-10-10 新任务：Binance REST/WS/SOCKS通信专项审计与离线优化

完整审计实施方案：https://github.com/3684993/ZDJMITS/blob/main/docs/plans/V398_BINANCE_NETWORK_COMMUNICATION_AUDIT_AND_OPTIMIZATION_20261010.md
Codex执行提示：https://github.com/3684993/ZDJMITS/blob/main/docs/prompts/CODEX_V398_BINANCE_NETWORK_COMMUNICATION_OPTIMIZATION_20261010.md
任务登记：https://github.com/3684993/ZDJMITS/issues/24

已静态核实：全部Binance的PUBLIC行情/PRIVATE签名REST与PUBLIC/MARKET用户WS经统一SOCKS5H代理，并非公共API直连；三个本机GPU模型不经交易所代理。BinanceMarketStream当前订阅全市场!bookTicker、!ticker@arr、!markPrice@arr@1s及按币种depth/kline/aggTrade，可能带来SSH流量冗余；实际需取/api/v3/diagnostics/market-stream-traffic 60s decoded bytes、proxy TCP backlog证明，未取得实时wire bytes，不得估算节省。

2026-10-09官方USD-M WS路由迁移文档明确/public、/market、/private；官方Demo WS根=demo-fstream.binance.com。当前config默认仍为stream.binancefuture.com/ws，BinanceTransport会将market/public改写至fstream.binancefuture.com，而BinanceUserDataStream默认使用未路由的/ws/listenKey。必须首先离线核实PRIVATE实际协议可用性，签名REST为权威、订单双ID、TP和60s TTL不削弱。请求budget已有priority/429/418控制、深度recover与WS仅请求非ACK的订阅状态也要专项测试。ExternalTradeAdapter签名recvWindow表达式疑似固定60s，须离线契约核查。

只读N0/N1、离线独立PR N2/N3；**目前不要部署或重启PID23688，不改VPN服务器/出口地区/Engine授权/Settings**，保持已开始的24h验收。历史HTTP451未在发布20次有界GET中复现，不可自动当作代理脚本故障或通过更换出口规避；任何实际351/451/429/418/502/503按来源分层。严格禁止补仓、Primary Entry、HUMAN_MANAGED、Production0规则不变。
## 2026-10-10 代理451与正式发布经验 — 文档补充

已核实最新 Engine 23688 / build 3.9.8-bb45c11，单次受控切换，身份6/6，20次有界GET均200，发布时签名TP12/12、后续本地缓存13/13、Production0。24h验收于08:16:49.685+08开始，目前RUNNING而非PASS。

详细经验：[网络代理/451/发布收尾报告](./reports/v398-engine-cutover-20261010/NETWORK_PROXY_451_RELEASE_LESSONS_20261010.md)。Windows本机SOCKS5H:20091经SSH:22091到Ubuntu出口；本次未修改代理脚本、未切换出口。公共GET 200、签名账户canTrade和实际地区资格各有不同证明力。历史451未在本次20次GET复现，不可预设所有451为SOCKS脚本故障；按TCP/SSH/SOCKS/TLS/HTTP/PRIVATE逐段调查，禁止绕开交易所地区限制。

ENAUSDC在08:21起的原订单PARTIALLY_FILLED期间，界面显示累计补仓1次。源代码positionLifecycleTracker在仓位数量增加时addCount++、前端cycleMoments将lastAddAt标为“最近补仓”，故可能只是同一初始订单分笔成交而非第二独立Entry。实际订单双ID仍须只读复核：[Issue #23](https://github.com/3684993/ZDJMITS/issues/23)。严格禁止补仓依旧，不因界面标记未经核实而重启保护Engine；PR19旧90分钟与当前新24h证据隔离。
## Actual TESTNET deployment and new 24h — 2026-10-10 08:24+08

DEPLOYED / RESTARTED / IDENTITY_CLOSED_6_OF_6 / ACCEPTANCE_24H_RUNNING, not PASS. Latest user instruction accepted existing Singapore proxy access as OPERATOR_ATTESTED release basis; independent official eligibility is not claimed and any future451 retains its actual response meaning. One formal Engine-only stop18100/start23688 (host26576), no retry/policy bypass. Frozen release D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd contains latest fetched main362355e runtime code; source9d9f1d0/artifactbb45c11/build3.9.8-bb45c11acbe9819a3456 and Settings253 match actual running identity. Fresh signed baseline12/12 exact TP, V2 canTrade=true, private7.016s, Production0; later08:23 local verified cache13/13 reflects natural activity, not a new signed13/13 claim. Twenty bounded exchange GETs all200/no451/502; no manual orders or forced model calls. Models/proxy unchanged, new hidden observer24540, reboot action updated without running it. Full local verification251/2157 and exact main362355e CI38003230433 SUCCESS already passed; actual build/staging and immediate verified SQLite rollback backup completed.

New T0 2026-10-10 08:16:49.685+08; deadline2026-10-11 08:16:49.685+08. Hidden read-only task samples every60s; updated heartbeat zdjmits-v398-24 follows every30min and syncs GitHub hourly/milestone/failure/end. Baseline is immutable, checkpoints append; user STOP or safety failure aborts attempt without stopping protective Engine. Repair/redeploy requires a complete new24h. Final signed safety and eligible-candidate/Primary funnel review required before PASS. Four dependency advisories/intermittent transport reliability remain open. Full receipt: docs/reports/v398-engine-cutover-20261010/DEPLOYMENT_RECEIPT.md; evolving canonical state: docs/reports/v398-engine-cutover-20261010/acceptance/state.json. All preceding STAGED/NO_GO/NOT_STARTED and old PID entries are timestamped historical evidence superseded by this actual execution.

# 项目维护记忆

## Issue22 actual staged release — 2026-10-10 07:10+08

STAGED_READY / NO_GO; sole externally missing fact is official actual-account/region Futures Demo eligibility (source/time/scope). Frozen release D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd: locked install and full build exit0, artifactbb45c11 exactly reproduced, source9d9f1d0 (one CRLF/LF difference vs prior04af474; normalized source identical).1923 per-file hashes verified/sealed, Git clean. Independent identity approval prepared/inactive, old approval unchanged; SQLite online backup1,034,747,904 bytes/quick_checkok and private rollback snapshots complete. Native formal-host probes PASS; no lifecycle/policy bypass, not proof of future action-time approval. Old Engine18100 remains;07:10 local private age3673ms, local TP12/12, Production0. Earlier signed13/13 is historical. No repeated tests/exchange probe loop or24h start. [Preparation receipt](./reports/v398-restart-execution-20261010/issue22-preparation/PREPARATION_RECEIPT.md) and cutover plan have precise paths/hashes/rollback requirements.

## Latest immediate restart execution — 2026-10-10 06:21+08

Fetched exact main d41c9df; exact-main CI37997259184 SUCCESS. Six fresh bounded TESTNET GETs all HTTP200; signed exact TP13/13, private age610ms, Production0. New SOCKS/TLS/public response succeeds1.303s; previous06:02 timeout remains historical unresolved intermittent counter-evidence. Old Engine18100/build6cd926 remains; no lifecycle attempted, no fresh policy denial, no new deployment or24h T0. Actual-account/region lawful eligibility still UNKNOWN; Chrome connector failed, official confirmation requested without re-requesting restart authorization. Existing old artifact approval cannot authorize candidatebb45c11. [New execution receipt](./reports/v398-restart-execution-20261010/EXECUTION_RECEIPT.md) contains actual results, sanitized host/TP evidence and remaining formal gates. Earlier latest-status entries below are preserved timestamped history.

## Current continuation PR21 / 24h pre-start — 2026-10-10

Latest06:02 bounded refresh failed at first public time GET after8.016s; prior05:47 signed TP13/13 is preserved as a historical sample, not a current release pass. No retry/lifecycle. Eligibility remains UNKNOWN; 24h NOT_STARTED/T0=null. PR21 merged by normal fast-forward at 8cd63a0; exact push/PR CI37996114153/37996120547 SUCCESS. Final local verify251/2157 and four Engine shards216/1966 PASS; dependency audit11→4 unresolved ECharts/Vitest advisories. Actual old host receipt and source/artifact hashes match Engine18100, but new candidate buildbb45c11 is not deployed. See new report for current vs historical policy evidence.



PR20 is merged at fetched main57c42dc. PR21 plus fix source `8cd63a0f13f3260b3faa986b89959cfb090d6844` passes local locked install/full verify (251 files/2157 tests). Hidden reboot recognition is strict; new CI is read-only and runs full verify without the legacy migration. Exact CI/merge readback: [receipt](./reports/v398-controlled-release-24h-20261010/EXECUTION_RECEIPT.md).

Live old Engine18100/build6cd926 remains. Private sync recovered; fresh signed GET exact TP13/13 passes dual IDs/side/reduceOnly/remaining quantity/local price. Production0, audit exchange/lifecycle/Settings writes0; observer17772 and silent tasks intact. Official actual-account/region eligibility remains UNKNOWN; a new identity-bound release approval and current formal action checks are still required. **NOT_DEPLOYED; ACCEPTANCE_24H=NOT_STARTED; T0=null.** New user24h/abort/full-reset rules replace the previous90min duration. Historical entries below are time-specific.


## 2026-10-09 V3.9.8 本机 P0 接力

权威回执：[LOCAL_EXECUTION_RECEIPT_20261009](./reports/v398-proxy-network-p0-20261009/LOCAL_EXECUTION_RECEIPT_20261009.md)。修复源 `0399eff5e601723c249ff6f6b70c59a23cb8dd22`；最终全量验证以同目录 `local-20261009/verify-green-result.json` 为准，PR/CI 必须查询最新 SHA。

Windows 已识别的周期弹窗源是两个 Interactive 5min Node task。8个 ZDJ task 仅更新 Action 为隐藏 WScript launcher；保留原 XML、命令/触发器/principal/disabled 状态，永久目录 `D:\MITS-OPERATIONS\silent-tasks-20261009`。Launcher 必须一行 Shell.Run、独立一行 WScript.Quit，wait=true且传播退出码；测试证明无可见 child console，实际定时观察+被动审计均继续成功。不要停安全监控来消除窗口。

现场 Engine 仍旧 build/PID18100；私有事实过期、SOCKS deadline失败。TP本地13/13不是当前exchange signed证明。代理账户 `MaxSessions=0` 禁止 shell；不能据此改ssh配置或冒充本轮Linux样本。451资格UNKNOWN必须官方确认。未部署、未重启、90min新版验收NOT_STARTED；旧观察器的build白名单必须在正规发布后更新。禁止绕policy、地区限制、独立补仓、Production、风险/TP/freshness减弱。

主机根目录 `D:\MITS` dirty且保留；本轮用隔离 worktree。原PR20资源说明断言失败已修复，PUBLIC/MARKET计数使用一次快照时间；decoded bytes不是SSH wire，也不含PRIVATE/REST。所有可发布回执/日志/任务备份在GitHub，钥匙、DB、账户原始事件及dumps留本机。


## 2026-10-10 original24h acceptance terminal state

ABORTED_SAFETY_FAILURE at08:34:00.270+08, LOCAL_TP_GATE_NOT_CLOSED (local14/15). All19 historical checkpoints/state/cursor now synchronized; old9-record prefix preserved. No24h PASS or clock continuation; derived elapsed17m10.585s differs from retained lagging elapsed field16.17665min. Post-abort09:34 read-only originalidentity/private17.380s/localTP24/24/Production0 is not signed full-position proof or new acceptance. Hidden task last run0 and terminal checkpoint stop are expected. No lifecycle/live/task/observer modifications. See docs/reports/v398-engine-cutover-20261010/ACCEPTANCE_ABORT_RECEIPT_20261010.md and acceptance JSON validation. All future repair/release/new24h need applicable authorization and gates; networkPR25/27/29 remain offline/unmerged.


## 2026-10-10 性能驾驶舱 D0-D2 实码交接

PR31 已在独立 worktree 验证并修复真实源码；GPU/PID/PCI 映射、typed只读sidecar、资金红黄绿灰与分币种收益趋势已实现。详见 docs/reports/v398-performance-dashboard-20261010/ 下 D0/METRIC_CONTRACT/D1_D2/SCREENSHOT_REVIEW 与日志。两27B GGUF/模板/ctx相同但 reasoning/output limit 不同，不能开启借用。G1统一容量租约、GPU2 TP SHADOW各独立PR，未部署。旧24h仍08:34 ABORTED_SAFETY_FAILURE；02:10Z签名25/25 TP通过只是一时只读样本，全套发布门禁UNKNOWN，未重启、未开启新24h。原工作目录及dirty D:/MITS保留，网络PR25/27/29独立未纳入。后续以最终PR HEAD精确CI回读为准；不得将离线模拟/fixture截图当线上收益或GPU改善。


### 性能阶段实际交付与最终边界

PR31驾驶舱含资金/收益图，121点自然窗口30.055分钟（Primary计数+11/失败+1，Review+26/失败+0；缺失/错误保留）。最终collector收窄PID查询、修复Windows原子替换、异常>100%判UNKNOWN，warm采样1.15–1.21s墙钟/47–63ms CPU，只有3点不可冒充长期证明。运行数据已脱敏归档，干净源码S00机械清单199，未改排除规则。

独立PR33容量租约最终HEAD402b850f73fd10018fb03db0b5deaeda493dd499，GitHub CI38018026331 success；PR32 TP SHADOW最终HEAD6ac46f8a93c096b5764bc05508ba47aa015bf381，CI38018034694 success。源码与全部日志在各分支统一reports目录，PR31另归档两者最终CI快照。PR33借用默认关闭（27B reasoning/output不等价、审批policy接线未做）；PR32生产provider/候选生成/调度接线及挂单事实触发优化未做。禁止真实TP改价/补仓，Primary唯一Entry不变。

原24h仍ABORTED，不部署不重启；02:10Z签名25/25 TP只是历史一时样本，Production当前全套门禁/region eligibility等UNKNOWN，未来必须新鲜全部门禁和完整新24h。PR31最后源码修复/归档HEAD CI以Issue30和PR的实际回读为准，不借其他分支绿灯。

### PR31 源码精确 CI 回读

源码248e5f8b7d8d4a4e6e178dfde52a563d6a1abbb1完整GitHub Actions38022146483 SUCCESS。本机2173项完整验证成功；成功作业日志与回执已归档统一reports目录，详见FINAL_DELIVERY.md。随后纯归档提交的最终HEAD CI以PR31/Issue30精确回读为准。未部署未重启，当前发布门禁UNKNOWN，旧24h仍ABORTED。
## 2026-10-10 G1统一容量租约 独立交接

本分支仅实现G1统一容量租约，实际源码/测试/日志见 docs/reports/v398-performance-dashboard-20261010/G1_GPU_LEASE_VALIDATION.md。不混仪表盘/网络PR，不部署/不重启/不修改Settings。借用默认关闭，当前27B generation不等价；TP SHADOW不获真实改价或交易能力。旧24h仍08:34 ABORTED_SAFETY_FAILURE，正式门禁UNKNOWN，不开启或续算24h。以最终PR HEAD精确CI为准，缺少线上性能/授权效果回放与生产policy/provider接线均不可冒充通过。

GitHub PR #33: https://github.com/3684993/ZDJMITS/pull/33
Exact hosted GREEN source/evidence HEAD 57874460e4ef743d4f9b1eb65dd5bd4fa037192c: https://github.com/3684993/ZDJMITS/actions/runs/38017514666 (completed/success). Archived job log and exact-head JSON included. Subsequent archival commit changes documentation/evidence only; its final HEAD CI must also be read back, never inferred from this result.
## 2026-10-10 GPU2 TP SHADOW协议 独立交接

本分支仅实现GPU2 TP SHADOW协议，实际源码/测试/日志见 docs/reports/v398-performance-dashboard-20261010/GPU2_TP_SHADOW_VALIDATION.md。不混仪表盘/网络PR，不部署/不重启/不修改Settings。借用默认关闭，当前27B generation不等价；TP SHADOW不获真实改价或交易能力。旧24h仍08:34 ABORTED_SAFETY_FAILURE，正式门禁UNKNOWN，不开启或续算24h。以最终PR HEAD精确CI为准，缺少线上性能/授权效果回放与生产policy/provider接线均不可冒充通过。

GitHub PR #32: https://github.com/3684993/ZDJMITS/pull/32
Exact hosted GREEN source/evidence HEAD 1d4005bc2b1f0b900ad5ac5435a16d9c8734df0d: https://github.com/3684993/ZDJMITS/actions/runs/38017460613 (completed/success). Archived job log and exact-head JSON included. Subsequent archival commit changes documentation/evidence only; its final HEAD CI must also be read back, never inferred from this result.
Related independent PR31 dashboard, PR33 lease, PR32 TP SHADOW; no merge/deploy. Local full verification counts in verification-local.json.
