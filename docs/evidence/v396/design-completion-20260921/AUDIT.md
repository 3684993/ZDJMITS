# V3.9.6 总设计接手审计与修复

日期：2026-09-21。审计输入 `b9e96258df7fe42bd8e3e4d653d34ac4b698beaa`，其实现提交 `1d7d68ffdb79e64b9bef1fe181e9fb5a8bf725ca`。
修复工作树：`D:\MITS-WORKTREES\v396-design-completion-20260921`；分支 `codex/v396-design-completion-20260921`。

## 裁决

**原交付不能作为 S01–S10 全部实施完成或验收通过的证据。当前升级仍为 INCOMPLETE / NOT_READY。**
总设计已直接修复以下缺陷并补充持久化基础，不退回原实施者。原交付及其证据文件保留。
READY_FOR_REVIEW 仅表示可以审查；既非 G1–G5 通过，也不能把缺失的离线实现标成 NOT_RUN_EXTERNAL。

## 已直接修复

| 编号 | 原问题及影响 | 本次处理 / 关键验证 |
|---|---|---|
| A01 | executionScope 把 ENTRY 静默改成 BOTH；既有持久日志占用键失配，而人工仍 LONG/SHORT、TP 未统一 | 恢复旧日志键；新域迁移前禁止宣称统一。边界测试固定 ENTRY/BOTH 不等价 |
| A02 | UNKNOWN 数值仍算净收益；NaN 权限/期限、负费用或负微利门槛可影响放行 | UNKNOWN/CONFLICT 不产生净退出估值；校验有限数、成本非负、期限与 0–10 权限范围；原周期 -9.99/-10/-10.01 边界测试 |
| A03 | funding 仅过滤账户/时间，跨周期/资产混算，重复计费 | 周期、结算资产和唯一来源 ID 检查；缺归属/冲突保留 UNKNOWN，不猜分摊 |
| A04 | 数量预算不校验 available/claim，NaN、负数、重复 ID 可绕过 | 安全整数、同域、唯一 ID、合法状态；UNKNOWN 持续占用；溢出阻断 |
| A05 | 对账缺 coverage 元数据默认为完整；不完整历史先返回，掩盖正向成交冲突 | 必须显式 true 且起止范围完整；正向风险证据优先。实际 ReconciliationService 验证缺证明不释放及 21 天有效历史 |
| A06 | 去掉 7 天条件后仍发超范围查询；满页按最后 ID 翻页可能漏掉较早订单；页数耗尽仍返回成功 | 六天连续分窗、满页二分、单毫秒饱和/200 请求预算耗尽抛错；income 第 50 满页失败。most-recent 服务端模型验证 1001 条全收集 |
| A07 | null validUntil 或陈旧终态文本可认证当前无风险；部分身份缺失可通过 | 当前风险证明必须未过期；身份不一致/已知订单成交为冲突 |
| A08 | collector 使用账户身份当进程身份，数据库行数当累计计数，旧 DB 报告直接失败 | 使用会话 UUID 与实际收到的领域事件计数；保留 30 天；旧表缺失显示 NO_VALID_SAMPLES；明确不是交易所请求率 |
| A09 | 单个/部分资本快照、未知压力与非正权益被当成可评估；缺期限/零数量可过计划校验 | 缺完整边界或非法数值阻断；组合压力/未知占用阻断；计划期限、身份和可执行数量校验 |
| A10 | 数值 usage 即使 UNKNOWN 仍被求和；实验身份仅 32 bit 且依赖属性顺序 | 用量状态、计数与重复事件校验；规范化对象后 SHA-256 |
| A11 | 手工预览把缺 gross 当零、固定费率估计标 EXACT | 缺 gross 保留 null；未建立可验证单边退出费用和周期成本前维持 UNKNOWN；不修改人工执行权限 |
| A12 | lossHandoff 写入未进契约、对账会丢失的 ownership，被称为 CAS | 删除伪持久权限投影，保留既有人工交接和 TP 行为；新增下面的真实事务基础 |

## 新增持久化基础及边界

`ownershipJournal.ts` 使用 SQLite BEGIN IMMEDIATE：所有权版本、状态与 outbox 同事务；首次成交期限幂等固化；旧仓/缺计划进入 HANDOFF_PENDING；精确到期撤权；人工/关闭状态不得自动恢复 AI。
同 scope 的 AI/人工/TP 数量 claim 跨连接竞争，重复请求 ID 绑定原意图；人工必须先撤 AI。读取已有 claim 不等于批准重新发单。

测试覆盖两连接竞争、重新打开数据库、outbox 失败回滚、首次/后续成交不续期、精确到期、旧版本拒绝、人工前置撤权、跨周期占用和时钟回拨。
**该基础尚未接入全部实际订单路径，不提供发单能力，不得将它描述为 S02/S04 已完成。**
当前 reserve 的 available 必须由后续协调器在持仓事实版本核验后提供；尚无安全释放 claim、ProtectionMandate、退出任务恢复、JIT 成本再验等完整实现。

## 仍须由总设计继续完成的源码工作

| 阶段 | 实际剩余工作 | 当前验收 |
|---|---|---|
| S01 | 真实 funding/capital 持久归属、历史本地归档连续覆盖、交易所请求指标、Primary/WS/存储告警闭环 | PARTIAL；本次关键 fail-closed 修复有回归证据 |
| S02/S04 | typed ownership 与现有仓位/SettingsStore 的迁移；全部 TP/人工/AI/重试路径统一任务、数量及 mandate；部分成交/UNKNOWN 恢复矩阵 | PARTIAL；持久事务组件已补，集成未完成 |
| S03 | 可复算成本来源/周期/报价版本、价格边界、真实费率与费用资产、JIT 权限裁决 | PARTIAL；纯判定安全校验不等于可发单 |
| S05 | 全账户相关簇/保证金/尾部压力、原子入场预留、人工容量与无人响应策略 | NOT_COMPLETE；简单 snapshot 不是风险治理 |
| S06 | 完整 TradePlan 契约与 Primary→校验→下单→首成交→复核的数据链；科学数量/期限/目标论证 | NOT_COMPLETE；字段检查不是计划系统 |
| S07 | 每次模型调用/重试真实 token 持久台账与预算；人工仓零例行推理；有界复核；正反例记忆与反馈消费 | NOT_COMPLETE；求和函数不是预算调度器 |
| S08 | 设置逐项消费者/生效方式/回读行为；菜单适用性矩阵及集成测试 | NOT_COMPLETE；不得仅凭 projection 宣称设置闭环 |
| S09 | 真正执行回放、无未来信息、成本/尾部压力、walk-forward、预注册与消融统计 | NOT_COMPLETE；事件过滤/SHA 不是回放实验 |
| S10 | 上述离线缺口完成后才准备 Testnet 验证、迁移/回退与代表性 canary | NOT_READY；真实交易/部署/经济样本为 NOT_RUN_EXTERNAL |

不重评历史 46/100，也不承诺收益。10 USDT 是 AI 权限阈值，不是账户损失上限。

## 查询覆盖的限制

已核对 [Binance 官方交易接口文档](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade)：userTrades 单次窗口不超过七天，allOrders 窗口小于七天且默认返回最近订单；终态空订单及长期历史存在保留限制。
本次 80 天 freshness guard 是比官方保留上界更保守的临时限制，**不是新的长期解决方案**。老历史缺本地连续归档时仍 UNKNOWN；不得将空返回当作完整历史或终态证明。官方文档读取为公开网络访问，无账户查询或交易所写入。

## 验证与操作范围

见 `tests.json`（完整定向用例结果）、`tests.log`、`typecheck.log`、`s00.json`。
contracts/core build 已通过；engine typecheck 通过；S00 六项通过，入口规则未放宽，原基线证据未修改。
测试显式使用临时 ZDJ_DATA_DIR、18096 配置端口；数据库用内存/系统临时目录；适配器使用 mock transport。未运行全仓总验证脚本、现网 Engine 或外部 canary。
仅修改本独立工作树；未启停 Engine，未迁移现网数据、修改现网 Settings、部署或发单。构建产物仅在该 worktree。

复现（在本工作树）：`npm run build -w @zdj/contracts`，`npm run build -w @zdj/core`，`npm run typecheck -w @zdj/engine`；定向测试文件清单见 `tests.json.testResults[].name`。测试环境先指定临时数据目录和独立端口，不运行根目录聚合脚本。

## 回退

本分支未部署，无现网回退动作。离线代码可回到 b9e9625 对比；不要用旧版替换已运行的新格式任务处理器。
OwnershipJournal 仅由隔离测试显式创建；尚无生产迁移，因此不得据此启用 AI 新退出权限。
