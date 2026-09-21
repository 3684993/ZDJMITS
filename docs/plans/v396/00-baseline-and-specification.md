# S00：冻结基线、接口和验证规格

状态 NOT_STARTED；主实施 terra，luna 可整理清单。前置：无。输出 G0；后继 S01。遵守 [总计划](README.md)、[契约](CONTRACTS.md)、[运行规则](ENGINEER-RUNBOOK.md)。

## 目标与范围

把架构文字转成不含交易权限的可执行开发约束；建立能够复现的输入基线。此阶段不修策略、不跑运行服务、不更改实际 Settings。

源码定位：根 package.json、各 workspace package.json、AGENTS.md、packages/contracts/src/{ai,trading,settings}.ts、apps/engine/src/config/settingsStore.ts、state/runtimeState.ts、services/executionLifecycle.ts。已有构建脚本与 package version 不等于实际运行版本，逐项记录。

## 子 PR 与实施顺序

1. **S00-A 清单：**记录源码 SHA、工作树差异、Node/npm/依赖锁、契约版本、配置默认值和运行事实来源。只读取必要字段，不导出密钥。追踪 Entry、TP、人工三条写路径到适配器/签名出口，列出已有锁和 journal。
2. **S00-B 契约：**按 CONTRACTS 确定金额币种、cycle/scope、版本、deadline、owner/maintenance、UNKNOWN、错误码；给每个 Ixx 找消费位置。定义新功能 OFF/SHADOW/TESTNET_ENFORCE 状态，但本阶段只规格，不能接到真实写路径。
3. **S00-C 隔离基建：**审查测试配置、顶层脚本及 import 副作用，建立测试目录/端口/禁网与适配器断言。将现有会访问现网的脚本从普通验证入口中隔离，而非直接全运行 root verify。
4. **S00-D 试验预注册骨架：**定义数据 manifest、切分、对照组、度量、成本/人工响应情景；数字风险预算由 S05 输入，主指标由 S09 固化。在查看测试集前完成签名/版本。

## 交付物

- `baseline-manifest`：源码/环境/数据 schema/hash，旧报告是历史证据的声明，已知 P1/P2 和未验收项。
- `write-path-inventory`：入口、权限、锁、持久任务、适配器、TP 影响；每个路径标现有/拟议。
- `field-consumer-map` 初版：特别包含 humanHandoffAfterMinutes、lossHandoffBars、TP 最小利润、SHADOW 和兼容方向字段。
- 脱敏小样本夹具集：正常入场、亏损/期限接管、未知订单、未知资金费、TP 与人工并发；保留事实关联。
- `experiment-preregistration` 骨架：参数未决定写 NOT_CONFIGURED，不用默认值静默上线。

存储在 docs/evidence/v396/S00/<run-id>/；格式见运行规则。必要脚本应独立、默认只读；没有运行结果的脚本不算证据。

## 必测/审查用例

| ID | 输入/动作 | 预期 |
|---|---|---|
| S00-T01 | 解析所有测试配置与启动入口 | 隔离位置明确；普通命令不能指向 live data/dist |
| S00-T02 | 输入包含环境密钥的 manifest 源 | 输出仅白名单字段，不泄露敏感值 |
| S00-T03 | 改一字节夹具或配置 | hash 改变，旧实验身份不能复用 |
| S00-T04 | 旧 AUTO 仓无 plan/deadline | 迁移规格要求人工审阅，不自动补授权 |
| S00-T05 | 比较执行域与 One-way/Hedge | scope 唯一，没有虚构两把净仓锁 |
| S00-T06 | 逐条核对 I01–I12 | 每项存在计划消费者、测试责任阶段 |

验证优先静态检查和纯函数测试，不能为了采集身份启动 Engine。若读取运行 HTTP 失败，仅记不可得。

## 验收/停止/移交

G0 条件：基线可定位、写路径无遗漏、关键语义无冲突、测试隔离已证明、试验骨架存在。未决资金数值可以保留为实盘前置，但不能留亏损阈值口径等核心语义歧义。

停止：需借助现网重启/交易才能完成基线，或无法阻断测试副作用。输出具体缺口。

回退：仅文档/隔离夹具可撤；不得删除用户原有文件。移交 S01：实际 schema、迁移机制、原始缺陷夹具；移交所有阶段：CONTRACTS 版本与命令白名单。
