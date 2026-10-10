# v3.9.8 驾驶舱首屏可视化与状态灯 · 首批源代码

日期：2026-10-10 +08。基线 `main ffdc99e6cd7dfa75e644e4f7d4fb719899d7dd16`；源代码位于 `chatgpt/v398-cockpit-professional-finance-status-20261010`，PR尚未合并/部署，开发时未在Windows主机上运行或模拟账户。

## 实际问题和实现

1. 性能页面 `financePerformance` 原仅从 `DashboardSnapshot.account.assets` 获取币种资金，对某些有效 Engine 真实签名账户数据却呈 UNKNOWN；驾驶舱同时读 `/api/v3/account/assets`。新 `financePerformance(snapshot,now,accountRead)` 按 `READY`、60s新鲜度、exact asset和唯一行过滤，优先使用后端签名账户资产端点，允许有界10秒Engine/浏览器时钟差，缺事实仍null，不凭截图示例硬编码USDT/USDC。
2. Shell顶部原 `TESTNET · TESTNET_ENABLED` 纯文本改 `CockpitSignalStrip` 单行圆点：TESTNET黄色、PRODUCTION绿色、丢失/异常配置红色；SOCKS交易通路、交易所、私有、Scout/Primary/Review、TP保护。文字仅显示“测试盘 / 交易通路可用 / 排队”等，不重复颜色名。所有明确错误/过期/仅配置均由 `cockpitStatus.ts` 证据门禁审定。后端只读既有 `binance-governance` 和 `brain/resources`，不新增交易所请求。账号可新鲜签名读取且REST failClosed SOCKS配置存在时标“交易通路可用”，明示**不证明SSH隧道本身经过独立TCP握手与端到端wire计数**；HTTP451独立处理，不把区域拒绝当代理失败。无有效身份、过期或服务路由错误绝不硬置绿。
3. `CockpitOverviewTop.vue` 放驾驶舱页面首屏：深蓝Institutional标题、四个当前权益/浮盈亏/持仓TP/钱包基线KPI；USDT和USDC各自可用金额和ECharts采样曲线；24h分币种实际结算盈利/亏损/净盈亏与手续费（基于既有 `/trade-records/24h`）；本地持仓/TP变化图；滚动1小时实际Entry/Exit fill计数图（不可把fill数量当完整交易）。原始资产表、保证金Eligible、Entry资格和按身份分开的活动委托不是被删除而是收于可展开面板，便于需要核查时获取细节、维持既有安全合同和测试。
4. 保留独立PerformanceView完整硬件性能图，并修复该页USDT/USDC获取路径、颜色文字赘述。历史图不伪造数据库：仅采本浏览器页面期间事实点，有界360，明确非历史覆盖；实例时钟/版本回退时断开采样；无来源时展示—/待同步，而不编造0或金额。
5. `cockpitStatus.test.ts` 和 `financePerformance.test.ts` 加准确状态、真实signed fallback、HTTP451优先、时钟偏差、不补假数字回归。现有OverviewView资金/委托原始明细保留以兼容现有测试且可追溯。

## 发布安全

本次仅只读UI/已有只读API调用，无交易所下单/改单/撤单、无模型调度、无生产策略更改。实时“TP本地覆盖”绿色 != 发布级别新鲜签名交易所全仓TP；Production的环境标签绿 != Production交易写批准。本PR为代码候选，不可把CI绿直接当现网部署。用户此前授权的Engine重启需另遵守综合CI、实时签名TP、TESTNET隔离、Production0、no-add/HUMAN_MANAGED与回滚门禁。现场部署收据必须单独补上。

## Codex 验证和完成

在独立工作树验证所有受影响的 Vue/tsc 和完整 `npm run verify:ci`、ECharts绘制/响应式移动端、真实账户API数据和浏览器时钟偏差处理。运行截图需要标明现场or fixture。构建后检查CI精确HEAD，对应host新PID/identity只有现场有真实证据才声称。所有代码/验证/脱敏图/报告/CI日志提交GitHub，不只保留本机；更新project-memory和handoff。 
