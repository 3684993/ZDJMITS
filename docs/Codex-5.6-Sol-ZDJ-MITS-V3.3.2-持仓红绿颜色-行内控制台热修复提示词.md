# Codex 5.6 Sol — ZDJ-MITS V3.3.2 持仓 PnL 红绿颜色与行内控制台热修复

继续 `D:\MITS` 当前 ZDJ-MITS V3.3.1。

读取并执行：

`ZDJ-MITS-V3.3.2-持仓浮动盈亏红绿颜色-行内控制台修复实施计划.md`

本轮只解决两个用户已经反复提出的问题，必须彻底完成，不允许再次只在代码/报告里声称“已实现”。

==================================================
P0-1 浮动盈亏必须固定亏损红、盈利绿
==================================================

当前真实浏览器截图证明：

PNUTUSDT -$1.84
ZECUSDT -$148.19
ETHUSDC -$386.39

仍显示普通深色，而不是红色。

V3.3.1 报告虽然写“正绿负红”，但真实页面不符合，所以本次必须先用浏览器检查：

- 实际 DOM class；
- computedStyle.color；
- matched CSS rules；
- table/strong/theme/scoped selector；
- CSS加载顺序；
- 是否被主题 token 或 text-primary 覆盖。

不要猜原因。

修复后建立独立、不可被主题覆盖的金融语义颜色：

- financial-profit
- financial-loss
- financial-neutral

要求：

- 不属于10套主题可变 palette；
- 切换主题不能改变盈亏红绿；
- 金额和ROE直接绑定最终数字DOM；
- >0 green；
- <0 red；
- =0/null/NaN neutral。

优先解决 specificity / CSS order，不要到处乱加 !important。
如确实必须，只允许对统一 financial semantic class 局部使用并解释原因。

浏览器必须验证至少：

- PNUTUSDT负值 red；
- ZECUSDT负值 red；
- ETHUSDC负值 red；
- Binance Noir / Dunhuang Finance / Institutional Blue / Quiet Morning / Burgundy Editorial 五个主题下仍保持固定 red；
- 如存在真实正收益持仓，验证 green；
- 没有真实正收益时用组件测试验证，禁止伪造生产持仓。

必须验证 computed style，而不是只检查 class。

==================================================
P0-2 控制台必须紧跟当前条目
==================================================

当前点击“控制台”后详情统一显示在长持仓列表底部，交互错误。

桌面最终行为：

点击：

PNUTUSDT [控制台]

必须变成：

PNUTUSDT 持仓行
→ 下一行立即插入全宽 PositionConsole
→ 然后才是 ZECUSDT 持仓行

使用 expanded row / colspan 或当前组件体系等价实现。

要求：

- 一次只展开一个；
- 再点相同 symbol 收起；
- 点另一 symbol 关闭旧的并在新行下面展开；
- 自动保证当前行+控制台在可视区域；
- 不跳页面底部；
- 不破坏 sticky header / table layout；
- PositionConsole 继续全宽；
- 内部维持左侧图表约70% + 右侧人工管理约30%。

窄屏可使用 full-screen dialog / drawer。

如果现有 table 架构确实不适合 expanded row，允许桌面使用大型 Dialog，但必须删除“统一列表底部详情”旧交互。

不要复制业务组件：
行内/Dialog都复用同一个 PositionConsole。

==================================================
保持V3.3.1所有功能
==================================================

不能破坏：

- 1m/5m/15m/4h图表；
- Entry/Mark/TP标线；
- 减仓；
- 补仓；
- 紧急平仓；
- 挂单委托；
- TP修改/重建；
- ManualIntent；
- AccountExecutor；
- Audit；
- Reconciliation；
- TP Guardian；
- TradeRecord；
- Orders人工委托页签。

本轮原则上不改后端。

只有发现 unrealizedPnl/ROE projection 本身错误才修改。

==================================================
测试
==================================================

增加前端测试：

- negative → pnl-negative
- positive → pnl-positive
- zero/null/NaN → neutral
- theme switch不会改变financial semantic class/token
- expanded row正确插入当前symbol下
- 一次只展开一个
- symbol切换不会串数据
- close/reopen正常

然后：

npm run typecheck
npm run test
npm run build

全部PASS。

重启 Engine。

浏览器真实验证：

1. 负值实际红色；
2. ROE实际红色；
3. 多主题颜色不变；
4. 点击PNUTUSDT控制台就在PNUTUSDT下一行；
5. 点击ZECUSDT后控制台移动到ZECUSDT下一行；
6. 图表和人工管理仍正常；
7. Console无前端错误。

因为本轮不碰Market/AI/Scheduler/Entry自动链，不重跑60分钟；做10~15分钟只读Testnet smoke即可。

最终报告必须明确记录：
- 真实CSS覆盖根因；
- 最终computed color验证结果；
- 多主题验证结果；
- 行内控制台截图/浏览器证据。

普通TODO/PARTIAL/PENDING未清零前禁止checkpoint停止。

现在直接调查并修复，不先写新计划。
