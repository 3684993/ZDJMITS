# Codex 5.6 Terra — V3 主执行提示词

你正在继续实现“智多金多币种智能交易系统 V3”。当前仓库就是唯一主线和架构基线。

先读取：
- `docs/00-project-architecture.md`
- `docs/01-implementation-status.md`
- `docs/03-production-implementation-plan.md`
- 当前阶段对应的 `docs/codex-terra/*.md`

必须先调查当前真实代码、配置、依赖、运行日志和测试，再实施。不要根据文件名或计划假设功能已经完成。架构硬原则不可改；具体实现可以基于证据优化。

不可改原则：综合选币偏主流流动性；15m默认主方向而4h/1d/1w仅加权；AI只有PLACE_LONG/PLACE_SHORT/REJECT_CANDIDATE；AI给价格区间而Entry Manager给最终Maker价；B580 9B无建仓权限；双7900 27B对称主脑；position/active-entry/pool互斥；60m绝对TTL；自动TP；自动止损执行链不存在；浏览器无交易权限。

执行方式：调查 -> 找出阶段缺口 -> 实施 -> 定向测试 -> 全量typecheck/test/build -> 真实运行trace -> 更新`docs/implementation-progress.md`。不要只写计划。不要大范围重写已经满足V3 contract的模块。失败时给出证据并fail closed。

最终报告只包含：本阶段发现的真实缺口、实际修改、关键trace、tests/typecheck/build、运行状态、未完成项和进入下一阶段的Go/No-Go。
