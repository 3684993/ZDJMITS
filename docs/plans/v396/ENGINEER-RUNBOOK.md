# luna / terra 实施规则

适用每个阶段。先读 [总计划](README.md)、[公共契约](CONTRACTS.md)，再读指定阶段。未派发的阶段只读；本次文件不授权开始实施或自动创建任务。

## 1. 开工前

1. 记录指定任务、base SHA、当前 SHA、worktree 路径、阶段依赖验收引用；读取实际工作树内 AGENTS。
2. 查看 git status，保护已有修改。使用 `codex/v396-sXX-<topic>` 独立分支/worktree；禁止在 `D:/MITS` 运行目录构建覆盖 dist 或替换产物。
3. 建立独立测试数据目录，所有适配器默认 mock/no-network/no-exchange-write；不得继承现网数据库、API 密钥、环境生产配置。含连接副作用的测试先静态检查并加硬阻断。
4. 通过 package scripts、测试配置和 import 验证命令；路径是定位线索，若基线漂移要列差异，不盲目按旧行号补丁。
5. 禁止把包 version 字段当作运行 build 身份。不得运行 dev/start/tsx watch、acceptance/rollout、恢复脚本或 autostart 安装器作为普通测试。

## 2. 分工与变更控制

- terra：事务、并发、会计、风险、模型协议和状态机主体；luna：冻结接口后的夹具、纯函数测试、台账、UI 与报告。
- 核心契约与共享集成文件同时只给一位 owner。一个任务只交一个可独立审阅的子 PR；不顺手修改所有相邻问题。
- 人工/AI 权限、亏损口径、原始数据修复、迁移不可逆变化是设计事项，不能为让测试通过而更改；提交具体冲突与备选给总设计。
- 依赖未实现可提交 mock/纯函数，不接入可写运行路径。无法证明安全边界时停止该路径并提交证据，继续其它已授权、无依赖工作。
- 若明确要求创建 PR，描述包含行为变化、涉及 Ixx、验证、迁移和限制；不把日志大段粘入 PR。不自动合并或发布。

## 3. 验证命令模板

以下为已核对 package scripts 后的模板，只在隔离 worktree 执行。尖括号要换成阶段实际文件，不能原样执行；模板本身不代表已通过。

```powershell
git diff --check
npm run build -w @zdj/contracts
npm run build -w @zdj/core
npm run typecheck -w @zdj/engine
npm run test -w @zdj/engine -- src/services/<actual-file>.test.ts
npm run test -w @zdj/core -- src/<actual-file>.test.ts
npm run test -w @zdj/contracts -- src/<actual-file>.test.ts
npm run test -w @zdj/dashboard -- src/<actual-file>.test.ts
```

按受影响 workspace 选择，不要求每次全跑。engine 的某些测试依赖 worker/dist 时在隔离树构建 engine；记录构建产物来源，不引用现网 dist。UI 改动按需 typecheck/build 和组件验证。

contracts 当前测试脚本带 `--passWithNoTests`；退出码 0 不证明已测到新契约。必须记录实际用例数并确认本任务必测 ID 被执行，零用例不能验收。

现有 root `verify` 包含脚本/生命周期测试，`verify:isolated` 也不能只凭名字判断安全；S00 需先检查真实副作用再使用。原有失败记录为 baseline failure，不能隐藏、跳过或改断言换绿；证明与改动无关后明确报告。

测试分层：纯函数边界→状态序列/数据库事务→离线适配器集成→回放→经授权 Testnet。普通代码任务只能到无交换写的验证层。禁止使用实时模型/交易所随机结果充当稳定单元测试。

## 4. 证据与交付

每个子 PR 保存（建议目录 `docs/evidence/v396/SXX/<run-id>/`，证据完成时才创建）：

- manifest：stageId、base/head、环境/依赖版本、命令、起止时间、fixtureHash、配置/模型/提示词 hash、结果、引用文件 SHA256。
- tests：实际测试数、通过/失败/跳过、覆盖的 Ixx；保留失败重现。
- diff：源文件列表、新契约、迁移预览、行为开关；敏感数据脱敏且不提交凭证或完整实时资产资料。
- conclusion：PASS/FAIL/INSUFFICIENT_EVIDENCE/NOT_RUN，说明范围；未跑不可写 PASS。

冻结回放原始数据可保存在受控本地存储，GitHub 提交脱敏 manifest/摘要/hash 和复现入口；不得为省 token 删除失败证据。

完成后用 [模板](HANDOFF-TEMPLATE.md) 回传，控制在约 600–1000 中文字加链接；完整日志放文件。把未完成依赖和下一阶段输入写清楚。阶段文件本身不自动改成 ACCEPTED。

## 5. Token 节约与停止条件

先按指定文件 rg/局部读取，不全库全量扫描；同一日志只生成一次聚合。共享架构用 CONTRACTS 引用，不重新生成全套设计；模型提示词传必要事实、Top-3 记忆，不传整个账本。

停止该子任务并报告：需要修改未授权风险语义；必须触碰现网生命周期/数据；适配器无法证明防反向开仓；成本/身份归属冲突；测试依赖泄漏到真实网络；基线代码已明显变更使方案不适用。

Engine health 失败只报告，不能 kill/restart。用户对某次通知或某次启动的指令不能扩展成永久监控恢复权限。

## 6. 可复制的派工消息

```text
你是 V3.9.6 实施工程师 [terra/luna]，本任务只实施 [SXX 的子 PR 名称]。
先读 docs/plans/v396/README.md、CONTRACTS.md、ENGINEER-RUNBOOK.md 和指定阶段文件。
实际 base SHA：[填入已验证提交]；前置 ACCEPTED 证据：[填入链接，缺失不得越过依赖集成]。
使用独立 worktree，先验证测试副作用隔离；保护现有未提交文件。
不修改 live Settings/data/dist，不启动/停止/重启/热重载 Engine，不写交易所、不自动部署。
严格按已冻结契约实施；无法满足 Ixx 时报告具体冲突，不自行放宽规则。
实现并运行相应离线测试，保存脱敏 manifest、测试与迁移证据。
完成后按 HANDOFF-TEMPLATE.md 交付，标 READY_FOR_REVIEW；不自签 ACCEPTED。
```

首次建议派工 S00，不直接把 S04 或 S10 交给工程师执行；每个任务仅替换阶段、base 与验收引用，不复制全部旧报告，节省上下文。
