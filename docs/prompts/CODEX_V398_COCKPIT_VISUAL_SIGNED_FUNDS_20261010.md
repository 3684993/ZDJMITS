# Codex · v3.9.8 专业驾驶舱图表 + 状态灯 + 签名资金修复

先fetch `main` 和 PR (本指令所在) `chatgpt/v398-cockpit-professional-finance-status-20261010`，读取 `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` 及 `docs/reports/v398-cockpit-visual-20261010/INITIAL_IMPLEMENTATION.md`。代码由ChatGPT实际提交，非需求空白计划。

- 使用独立 `D:\MITS-WORKTREES\v398-cockpit-visual` 工作树，保持现网工作树dirty不碰，不做不合规后端交易请求。
- 在此分支直接跑lockfile `npm ci`、对应Vitest、Vue typecheck、production build、`npm run verify:ci`、S00及GitHub Actions；遇到错误修复源码/回归测试直至exact-head CI success，报告逐项证明。
- 验证当前 `CockpitOverviewTop.vue` 及Shell指示灯。desktop/mobile工具栏：TESTNET黄色、PRODUCTION绿色、环境无有效事实红色；代理REST routes failClosed+真实新鲜signed账户时可报告“交易通路可用”，**不能冒称SSH隧道单独已验证**，HTTP451不推断代理故障。模型新鲜健康/Queue/TP单独证明，不允许颜色名称文字。首屏专业ECharts USDT/USDC签名可用资金、24小时原生结算PnL盈利/亏损及手续费、持仓/TP保护、最近一小时entry/exit fill采样曲线。详情面板保留原始BTC/USDT/USDC、Entry资格、交易所确认和本地UNKNOWN挂单区分。
- 对照现场用户报告：13:38 snapshot signed USDT 472.82854605、USDC 3752.3121458，但PerformanceView显示UNKNOWN；必须只读检查 `/api/v3/account/assets` 与 `/snapshot` 原数据/时钟，证据决定使用哪种有效数据。不直接写死上述用户截图数值；旧Engine资产端点如果返回重复/过期/无签名，保留“—”并报告确切阻断理由，不能填0。
- 验证现有OverviewView的3s轮询与新的独立15s `tradeRecords24h`不会增加 Binance REST、SQLite写、主线程阻塞；销毁后无新UI副作用，隐藏页暂停；首屏 ECharts 不与Performance重复触发引擎采样。若 360采样点不足需清楚说明只有本页现场窗口。
- 回归用例：accountRead签名合格但snapshot.assets空、browser/server偏差≤10s、资产重复/过期灰、单资产低于500红/500–999黄/≥1000绿、真实HTTP451、不同USDT/USDC不合计、24h收益与钱包基线不同口径、position/TP/Entry vs fills 不能混算、取消/结束浏览器不发送交易操作。
- 推荐补充HTML screenshot Playwright或现有工具先真实渲染desktop/mobile，带来源和窗口标注；决不能用fixture截图装成现场验证。
- 交付 `docs/reports/v398-cockpit-visual-20261010/FINAL_VALIDATION.md`、脱敏测试日志、精确HEAD CI证据及截图。更新 `docs/project-memory.md`、`docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`、Issue#30和本次PR。若现场门禁或CI阻断，记NO_GO，不为了美观或验证而擅自重启当前Engine。全程保留Primary唯一Entry、不补仓、HUMAN_MANAGED、Production 0、签名TP保障。
