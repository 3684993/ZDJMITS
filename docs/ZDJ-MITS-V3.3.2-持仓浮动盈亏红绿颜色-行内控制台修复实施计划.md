# ZDJ-MITS V3.3.2
## 持仓浮动盈亏强制红绿语义 + 行内持仓控制台交互修复实施计划

> 项目目录：`D:\MITS`  
> 基线：`ZDJ-MITS V3.3.1 POSITION CONSOLE`  
> 本轮定位：**UI/交互热修复，小版本 V3.3.2；不修改 Market / Pool / AI / Entry 自动交易架构。**  
> 核心目标只有两个，但必须彻底修复并真实浏览器验收：
>
> 1. **浮动盈亏必须固定“亏损红、盈利绿”，不受任何主题覆盖。**
> 2. **点击“控制台”后，持仓控制台必须紧跟当前持仓记录展开，不能统一出现在长列表底部。**

---

# 一、问题一：浮动盈亏颜色为什么必须重新调查

V3.3.1 验收报告声称：

- “浮动盈亏正值绿色、负值红色、零值中性，并使用主题 token”。

但用户真实浏览器截图显示：

- PNUTUSDT `-$1.84`
- ZECUSDT `-$148.19`
- ETHUSDC `-$386.39`

主表中的负值仍然显示为普通深色，而不是红色。

这说明：

> **测试或代码层可能存在红绿 class/token，但最终浏览器 computed style 被其它表格/主题样式覆盖，或者 class 没真正绑定到实际数字元素。**

因此本轮禁止只再次“加 class”或再次写“已修复”。

必须先用真实浏览器 DevTools / computed style / DOM 取证确定根因。

---

# 二、浮动盈亏颜色的最终硬规则

## 2.1 金融语义颜色独立于主题

浮动盈亏不是普通 UI 装饰色，而是固定金融语义。

最终必须使用一组**不可被主题重定义的金融语义 token**：

```css
--financial-profit
--financial-loss
--financial-neutral
```

要求：

- `--financial-profit`：固定盈利绿色；
- `--financial-loss`：固定亏损红色；
- `--financial-neutral`：中性色；
- 这三个 token **不能放进 10 套主题变量表中**；
- 主题切换只能改变背景、卡片、导航、强调色等；
- 主题不得改变盈利/亏损的红绿语义。

如果当前 theme system 会重写所有 CSS variables：

- 把 financial semantic tokens 移出 theme map；
- 或建立独立 `financial-semantics.css` / semantic constants；
- 确保它在所有主题下保持固定。

---

# 三、禁止“主题 token 覆盖 PnL”

必须检查所有可能覆盖链：

```text
table
td
strong
.text-primary
.stat-value
.position-cell
.theme-*
[data-theme]
!important
inline style
CSS layer
scoped Vue style
```

重点确认是否存在类似：

```css
.positions-table td strong {
  color: var(--text-primary);
}
```

覆盖：

```css
.pnl-negative {
  color: var(--financial-loss);
}
```

或：

- Vue scoped selector specificity 不够；
- `strong` / `b` 元素自己有颜色；
- table component 统一强制 `color`;
- theme class 在后加载；
- CSS order 导致 pnl class 失效；
- class 实际绑定到了父层但子 `<strong>` 重设颜色。

必须通过浏览器查看：

```text
element
class list
computed color
matched CSS rules
最终生效 selector
```

找到真实根因后再修。

---

# 四、最终 DOM / class 规则

建议将金额和 ROE 分别绑定同一 sign：

```text
pnl > 0  → pnl-positive
pnl < 0  → pnl-negative
pnl = 0  → pnl-neutral
```

例如：

```html
<span class="pnl-value pnl-negative">-$148.19</span>
<span class="roe-value pnl-negative">-1486.38%</span>
```

或者统一：

```html
<span :class="pnlClass(position.unrealizedPnl)">
```

要求：

- 直接绑定到最终显示数字的 DOM 元素；
- 不只绑父级；
- 金额和 ROE 都必须生效；
- `NaN / null / unavailable` 使用 neutral，不误判成红/绿。

---

# 五、颜色优先级要求

目标不是到处使用 `!important`。

优先顺序：

1. 消除错误覆盖；
2. 将 financial semantic CSS 放到合适层级；
3. 让 `.pnl-positive/.pnl-negative` selector 比普通文字规则明确；
4. 必要时使用 CSS layer 控制优先级。

只有确认第三方/全局规则无法合理修改时，才允许对**这一组金融语义 class**局部使用 `!important`，且必须在代码注释说明原因。

禁止大范围：

```css
color: red !important;
```

散落在组件中。

---

# 六、固定颜色必须跨所有主题验证

至少切换并验证：

- Binance Noir
- Dunhuang Finance
- Institutional Blue
- Quiet Morning
- Burgundy Editorial

每个主题下：

```text
负值 = 同一固定红色语义
正值 = 同一固定绿色语义
0 = 中性
```

主题改变：

- sidebar；
- card；
- background；
- accent；

但**不能改变浮动盈亏红绿**。

---

# 七、浏览器验收必须验证 computed style

不能只截图看起来像红色。

必须自动/人工浏览器验证至少一条负 PnL：

```text
computedStyle.color === financial-loss expected color
```

如果当前真实持仓存在正 PnL：

同样验证：

```text
computedStyle.color === financial-profit expected color
```

如果没有自然正 PnL：

- 用组件测试 / story / fixture 验证正数 class 和 computed style；
- 禁止伪造生产持仓数据。

同时验证 ROE。

---

# 八、增加针对颜色回归的测试

新增前端单元/组件测试：

```text
-1.84       → pnl-negative
-148.19     → pnl-negative
0           → pnl-neutral
12.45       → pnl-positive
null        → pnl-neutral
undefined   → pnl-neutral
NaN         → pnl-neutral
```

并验证：

- 10 套主题切换后 class 不变；
- financial tokens 不被 theme config 覆盖。

如果项目测试框架支持 DOM computed style：

增加跨主题 style test。

---

# 九、问题二：控制台不能再统一出现在持仓列表底部

当前交互的问题：

- 点击某一条“控制台”；
- 实际控制区域出现在整个长列表下面；
- 29 个甚至更多持仓时，用户必须滚动很久才能找到对应控制台；
- 当前持仓上下文与操作区分离；
- 容易误操作其它 symbol。

这是明显的人机交互问题。

---

# 十、最终交互方案：桌面端“行内展开”，小屏“全屏/抽屉”

## 10.1 桌面端优先采用行内展开

点击某一行：

```text
PNUTUSDT ... [控制台]
↓
立即在 PNUTUSDT 这一行下面插入一整行全宽控制台
```

结构：

```text
<tr>PNUTUSDT 持仓行</tr>
<tr class="position-console-row">
  <td colspan="全部列">
     <PositionConsole symbol="PNUTUSDT" />
  </td>
</tr>

<tr>ZECUSDT...</tr>
```

这能保证：

- 记录与控制台紧邻；
- 不用滚到列表底部；
- 明确当前正在操作哪个 symbol。

---

# 十一、一次只展开一个控制台

默认：

```text
expandedPositionSymbol: string | null
```

点击：

- 未展开 → 展开；
- 已展开相同 symbol → 收起；
- 点击其它 symbol → 关闭旧的，展开新的。

禁止同时展开 10 个控制台导致页面极长。

---

# 十二、展开后自动对齐当前记录

展开控制台后：

- 保证当前持仓行和控制台顶部在可视区；
- 可用 `scrollIntoView({block:"nearest"})`；
- 不要强制跳到页面顶部；
- 不要造成明显页面抖动。

关闭后保留原滚动位置。

---

# 十三、控制台全宽布局

行内展开区域必须使用整张表的全宽 `colspan`。

内部布局保持 V3.3.1 已实现的：

```text
左侧 65~72%：图表/趋势
右侧 28~35%：人工管理
```

不要因为放进行内而压缩成很窄的小卡片。

---

# 十四、Sticky Header / 表格布局兼容

需要检查当前 table：

- sticky header；
- overflow；
- virtual scroll；
- responsive table；
- border collapse；

是否影响 expanded row。

如果现有 table component 无法安全插入 detail row：

允许改成：

```text
每条 Position 使用 row container
+ detail expansion panel
```

但不能为了这个功能重写整个页面。

---

# 十五、小屏 / 移动端

当宽度不足：

不建议把复杂控制台塞入表格横向滚动。

可以使用：

- Fullscreen Dialog；
或
- Right Drawer；
或
- Bottom Sheet。

推荐规则：

```text
desktop/tablet wide → inline expanded row
mobile/narrow       → full-screen dialog/drawer
```

---

# 十六、如果 Codex 判断 Dialog 更适合当前组件体系

用户允许弹窗方案。

如果当前 Vue/table 组件不适合安全插入行内展开，可以选择 Dialog，但必须满足：

- 点击当前行后立即出现；
- 标题固定显示 Symbol / Direction / PnL；
- 图表 + 右侧人工管理完整；
- 不需要滚到页面底部；
- modal 宽度足够；
- 可最大化；
- ESC / close 正常；
- 写操作确认流程不受影响。

但优先级：

**桌面行内展开 > 大型 Dialog > 当前列表底部详情**

当前列表底部详情必须删除。

---

# 十七、不要复制两套 PositionConsole

必须抽成/继续复用单一：

```text
PositionConsole
```

行内展开、Dialog、移动端都调用同一业务组件。

禁止：

- desktop 一套；
- mobile 一套；
- bottom detail 另一套；

造成逻辑漂移。

---

# 十八、控制台 Symbol 上下文必须锁定

打开：

```text
PNUTUSDT
```

控制台所有：

- Kline；
- Position facts；
- TP；
- Active Orders；
- TradeRecord；
- AI/EIP；
- Audit；
- Reduce/Add/Close/Limit；

必须绑定 PNUTUSDT。

当用户切换到另一个持仓：

- 取消旧的 pending fetch；
- 更新 symbol；
- 禁止旧响应覆盖新控制台。

需要处理异步竞态。

---

# 十九、操作提交期间切换行

如果存在正在提交的人工订单：

- 禁止无提示直接切换 symbol；
或
- 后台继续，但 UI 明确显示操作已提交。

推荐：

提交按钮得到服务器确认 Intent/Order 后即可允许切换。

未提交表单有输入时：

切换可提示：

`当前未提交修改将丢失，是否继续？`

不要影响正常浏览。

---

# 二十、保持 V3.3.1 所有人工交易安全边界

本轮只改展示位置和颜色，不能破坏：

```text
Dashboard
→ ManualIntent
→ Validation
→ AccountExecutor
→ Binance
→ Audit
```

继续保持：

- reduce-only；
- PostOnly；
- precision；
- minNotional；
- idempotency；
- Testnet/Production gate；
- TP Guardian；
- Reconciliation；
- TradeRecord。

不得因为 UI 重排重新实现一套人工下单 API。

---

# 二十一、建议修改范围

Codex 必须基于实际代码决定。

预计主要是：

```text
PositionsView.vue
PositionConsole / PositionDetail component
theme / semantic css
shared pnl formatter / class helper
dashboard component tests
```

如后端 API 已完全满足：

**本轮不要改后端。**

只有发现 PnL 原始字段/ROE 数据错误才允许改 projection。

---

# 二十二、专项浏览器验收

必须用真实 V3.3.2 页面完成以下验证。

## A. 浮动盈亏

真实选择至少 3 条亏损持仓：

例如当前可用：

- PNUTUSDT
- ZECUSDT
- ETHUSDC

检查：

- 金额红色；
- ROE 红色；
- 不是普通 text color；
- 5 个不同主题下仍为红色。

如果出现真实盈利持仓：

- 金额绿色；
- ROE 绿色；
- 多主题保持绿色。

## B. 行内控制台

点击：

`PNUTUSDT → 控制台`

必须：

- PNUTUSDT 下一行立刻出现控制台；
- ZECUSDT 仍在控制台下方；
- 不需要滚到列表底部。

再点击：

`ZECUSDT → 控制台`

必须：

- PNUTUSDT 控制台关闭；
- ZECUSDT 下方展开；
- 图表 / TP / 操作全部变为 ZECUSDT。

再次点击 ZECUSDT：

- 收起。

---

# 二十三、截图验收

最终报告必须附/记录至少以下截图证据：

1. 负 PnL 红色；
2. 正 PnL 绿色（若真实存在；否则组件测试证据）；
3. Dunhuang Finance 下负 PnL 红色；
4. Binance Noir 下负 PnL 红色；
5. PNUTUSDT 行下直接展开控制台；
6. 切换 ZECUSDT 后控制台跟随行移动。

禁止报告再次只写“颜色语义已实现”，却没有真实浏览器视觉证据。

---

# 二十四、测试与构建

执行：

```text
npm run typecheck
npm run test
npm run build
```

全部 PASS。

由于不应修改 Market / AI / Scheduler / Entry 自动链：

- 不需要重新跑完整 60 分钟；
- 重启后做 10~15 分钟只读 smoke 即可。

确认：

- `/health=READY`
- Market LIVE
- Binance Private READY
- TP protected 正常
- 页面 Console 无 error。

---

# 二十五、回归测试

必须确认：

- 控制台里的人工减仓；
- 补仓；
- 紧急平仓；
- 挂单；
- TP replace/rebuild；
- chart timeframe；
- tabs；

仍然可用。

本轮不允许为了修改展开位置而损坏 V3.3.1 已通过功能。

---

# 二十六、严格退出条件

只有以下全部满足才能回复完成：

1. “浮动盈亏”字段存在；
2. 所有真实负 PnL 显示固定红色；
3. 正 PnL 显示固定绿色；
4. ROE 同样正绿负红；
5. 5 个主题切换后红绿不变；
6. 浏览器 computed style 验证通过；
7. 不再被 table/theme CSS 覆盖；
8. 点击“控制台”后在**当前持仓行下面**显示；
9. 不再统一显示在列表底部；
10. 一次只展开一条；
11. 切换 symbol 无异步串数据；
12. 控制台现有图表与人工操作全部可用；
13. typecheck PASS；
14. tests PASS；
15. build PASS；
16. browser PASS；
17. smoke PASS；
18. 普通 TODO/PARTIAL/PENDING=0。

---

# 二十七、版本

完成后：

# ZDJ-MITS V3.3.2
## Position PnL Semantic Color & Inline Console Hotfix

本轮完成后继续冻结交易核心架构。
