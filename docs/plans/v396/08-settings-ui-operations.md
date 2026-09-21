# S08：设置接线、管理界面与运维一致性

状态 NOT_STARTED；luna 主实施 UI，terra 审查服务端规则/迁移。前置 S02–S07；后继 S09。重点 OP1/OP2、DA3、AI2；涉及 I01/I06/I07/I10/I12。

## 文件与范围

已有 dashboard src/views/{SettingsView,PositionsView,TradeRecordsView,MemoryView,BrainView}.vue、components/PositionConsole.vue、navigation.ts、router.ts、api/client.ts；engine api/router.ts、runtimeSettingsResources.ts、config/settingsStore.ts、services/storageCapacityGuard.ts、runtime/appRuntime.ts；contracts/settings.ts。

新页面采用现有组件/路由，先合并展示再删重复入口；不删底层交易记录、人工服务、记忆事实、TP/对账。菜单调整不声称降低模型 token。

## 子 PR 顺序

1. **S08-A 字段消费者清单。** 逐字段记录 schema/default、API 校验、持久化、实际读取、有效值、单位、版本、生效时点、是否兼容。humanHandoffAfterMinutes 没消费者的问题在 S02 接实后再显示可编辑；旧方向字段归只读兼容。
2. **S08-B 服务端规范。** 统一有效配置读回及乐观版本更新；坏单位/范围/过期版本拒绝。区分新计划默认、现存计划冻结值、当前更严上限；扩大权限不得静默适用于存量仓位。
3. 单独引入 minAiNetProfitUsdt，不降低旧 TP schema 的最小值来假装兼容微利；maxAiRealizedLossUsdt 显示“AI 允许实现的净亏损阈值”。OFF/SHADOW/TESTNET_ENFORCE 显示实际作用，不能只显示“已开启风控”。
4. **S08-C 页面。** 总览展示全账户净值含浮亏、AI/人工/待接管风险与数据时效；AI 持仓展示原论点、期限、净退出估值、10 USDT 权限状态、review 预算、TP；人工接管展示剩余风险、在途单、ack、维护授权与原始计划。
5. 交易详情连通 plan→intent→fills→TP/exit→handoff→最终记录→记忆；原目标与实际回退分别展示。UNKNOWN 不用绿色 0；交接不显示已平仓成功；人工未确认不显示已阅。
6. **S08-D 操作一致性。** 人工加减/改 TP 前说明会接管；提交后从服务器读回 ownerVersion/任务状态，不乐观伪造 FILLED。重复点击使用幂等 key，前端禁用按钮不能替代后端权限。
7. **S08-E 运维。** 增加计划/ownership/任务/账本积压和时效、Primary pause vs idle、WS 连续性、存储容量、事件留存、token UNKNOWN 指标。告警明确真实数据源及应对，失败 health 不自动重启。
8. 存储清理按依赖保留活动计划、在途任务和事实墓碑；备份/恢复先在隔离副本演练。UI 可显示诊断和手动启动说明，不能后台拉起 Engine 或添加自启动。

## 设置验证矩阵（工程师补完整实际字段）

| 组 | 期望覆盖 |
|---|---|
| 退出 | L=10、小亏 true、微利门槛、估值缓冲、模式；存量/新计划差异 |
| 时间 | 首成交起点、目标/管理期限、复核预算、未知事实宽限；到期不续 |
| 人工 | 数量/名义额/待接管名额/ack age/TP mandate；不豁免账户风控 |
| 风险 | 币种/相关簇/压力/保证金/回撤档案；缺配置不放行 |
| 模型 | 角色、并发、token、TTL、失败状态；资源已在线不代表职责已启用 |

每个可写字段至少一个 `UI输入→API→保存→回读→实际消费者行为` 测试，纯展示字段仅需读模型正确性。不确定是否有效就标清楚而非让用户猜。

## 必测用例

| ID | 场景 | 预期 |
|---|---|---|
| S08-T01 | 两个设置页同时保存 | 旧版本拒绝，不覆盖他人更改 |
| S08-T02 | 宽松设置保存后查看旧计划 | 不扩旧授权；更严设置缩权可见 |
| S08-T03 | 人工仓/过期仓的 AI 操作按钮 | UI 禁用且服务端拒绝伪造请求 |
| S08-T04 | 毛盈正但净利未知、接管大亏 | 明确 UNKNOWN/风险，不能显示成功盈利 |
| S08-T05 | 部分成交/撤单未知/重复点击 | 任务状态可见，无乐观全平/重复请求 |
| S08-T06 | 存储压力/探针数据陈旧/Primary idle | 真异常可告警，健康 idle 不误报故障 |
| S08-T07 | 清理与备份恢复隔离演练 | 活动事实无丢失，版本/owner/deadline 可恢复 |
| S08-T08 | 移动端与桌面关键交接流程 | 标签/金额/单位/截止时间一致，操作可达 |

运行 UI 组件测试、typecheck/build 与必要浏览器验证；不得为截图启动 live Engine。

## 验收与回退

每项可编辑配置有真实消费证据、所有关键操作回读、演练不违反手动生命周期。截图不能替代 API/行为测试。删除模块先列消费者与迁移，不能只 rg 零次就删除动态接口。

回退 UI 保留新读模型版本兼容；旧 UI 不能以默认空字段覆盖新设置。移交 S09：功能开关快照与完整实际消费者映射；S10：运维读接口、告警规则、迁移/备份说明。
