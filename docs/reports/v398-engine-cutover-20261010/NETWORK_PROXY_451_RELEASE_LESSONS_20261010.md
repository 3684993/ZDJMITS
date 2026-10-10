# V3.9.8 正式发布、SSH/SOCKS 代理与 HTTP 451 排障收尾经验（2026-10-10）

> 状态：**已完成一次正规 TESTNET Engine 部署与受控重启；24 小时验收 RUNNING，尚未 PASS；HTTP 451 在本次发布采样中未复现，不宣称根因已修复。** 本文是复盘与操作约束，不代表另一次实时在线核验，也不修改运行中的代理/交易逻辑。

## 一、范围与证据来源

- [正式部署回执](./DEPLOYMENT_RECEIPT.md)、[当前验收状态](./acceptance/state.json)、[历史 NO-GO 与准备回执](../v398-restart-execution-20261010/issue22-preparation/PREPARATION_RECEIPT.md)、[Issue #22](https://github.com/3684993/ZDJMITS/issues/22)、源码 `scripts/vpn/zdj-trade-proxy-client-windows.ps1`、`scripts/vpn/zdj-trade-proxy-server-ubuntu.sh`。
- 用户现场陈述：通过既有新加坡代理连接；本次新版本可自主分析、挂单和持仓，三个 GPU 模型同时工作；ENAUSDC 初始订单部分成交后 UI 显示“最近补仓/累计补仓1次”。其中 GPU 使用率和每笔交易身份尚未由本文独立读取。
- 网络诊断应区分**用户现场陈述、回执实际采样、代码行为、未证实的推论**。不得把任何一种混写成已证明事实。

## 二、已完成的受控发布（事实）

| 项目 | 执行回执 |
|---|---|
| 代码与发布目录 | 冻结源码 `6f228cd90f9146405761f3221b70096f7ca85ed5`；封存于 `D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd`，1923 个文件哈希重核一致；之后 `main` 的证据提交不改变已批准的运行代码 |
| 新 Engine | 严格 `stop-zdj-lan.ps1` 停止旧 PID `18100`，确认 8080 释放；正规 `start-zdj-engine-host.ps1` 启动一次；新 PID `23688`，宿主 `26576` |
| 构建身份 | `3.9.8-bb45c11acbe9819a3456`，源码/产物/main.js/Settings/宿主子进程与审批 6/6 完整核验 |
| 环境与权限 | TESTNET，`canTrade=true` 来自独立签名 V2 账户接口；V3 账户接口该字段缺失，不能假定为 false 或 true；Entry 使用新构建独立身份审批 |
| TP 与资金写入 | 截止切换前与 T0 前的**新鲜签名**核验均为当时的 12/12；后来本地 13/13 是另一时点的**本地缓存**，不能写成实时签名 13/13；Production 写入 0 |
| 网络 | 发布前后共 20 个**有界交易所 GET**均 HTTP 200，未遇 HTTP 451/502；只证明这些时间窗口内技术访问成功 |
| 辅助服务 | 代理 `127.0.0.1:20091` 原 PID `18300` 保留；三模型端口 8081/8083/8084 和进程 PID 3400/14020/22336 保留；观察器在旧实例收尾后正规重绑定新 PID `24540` |
| 验收 | 北京时间 `2026-10-10 08:16:49.685` 至 `2026-10-11 08:16:49.685`，初始 `RUNNING / IN_PROGRESS_NOT_PASS`；每 60 秒本地只读采样，GitHub 阶段性同步独立执行 |

需要保留的实操经验：

1. **源、产物、审批和当前进程是四个不同身份。** `npm run verify`、CI 成功、封存文件一致，都不是“已部署”；只有真实旧实例退出、新 PID/宿主收据/API/Settings/Child 环境、build 与产物 6/6 一致，才能宣称新版生效。
2. **先备份、后核验、再进行一次正规切换。** 发布前保存当前 SQLite 在线备份、WAL 对账、快照完整性及旧版回滚材料；读取真实 8080 owner、剩余订单与全部当前 TP；最后核验样本必须小于既定 60 秒 TTL。旧 Engine 持仓保护不能因诊断而无故中断。
3. **单次启动且不追杀旧进程。** 正规 host 26576 首次子进程 23688 启动后的短暂 503 `STARTING` 是启动过渡，不是新一次 stop/restart 的依据；宿主收据稍晚出现也不能自动再启动第二次。曾经的 policy denial 不能由另一组进程杀手或计划任务绕过；本次正规操作没有新的策略拒绝。
4. **新 Entry 授权与运行状态分别验证。** 新构建授权绑定真实源码 SHA256、产物 SHA256、entrypoint、Settings253、数据目录、账户范围；不要复用旧构建的授权，也不能用 `canTrade=true` 代替现有 TP、私有事实与风险门禁。

## 三、网络拓扑与 HTTP 451 的正确认识

```text
Windows ZDJ Engine :8080
   ├── 本机 AI 模型 :8081/:8083/:8084（不经过 Binance 代理）
   └── 统一 Binance REST/WS 访问
           ↓ SOCKS5H 127.0.0.1:20091
       Windows ssh.exe -N -T -D (本地转发，不是浏览器 VPN)
           ↓ SSH :22091
       Ubuntu sshd 的专用转发账户（无交互 shell）
           ↓ 经 Ubuntu 出口向 demo-fapi.binance.com 发起连接
       Binance TESTNET/Demo
```

客户端脚本 `zdj-trade-proxy-client-windows.ps1` 目前包含：SSH 身份/监听器验证、SOCKS/TLS/HTTPS 分阶段健康检查、带预算的 watcher、ServerAlive 参数和固定的本机 SOCKS 监听。Ubuntu 脚本 `zdj-trade-proxy-server-ubuntu.sh` 管理专用转发账户/sshd 设置，并提供只读 `--check` 检测。**本次发布没有证据支持必须编辑这两份脚本；本次并未修改服务器出口、地区路由、SSH 设置或代理 PID。**

必须拆开下列判断：

| 观测 | 能证明 | 不能证明 / 正确处置 |
|---|---|---|
| Ubuntu 本机同一公共 `/fapi/v1/time` 返回 200 | 从该 Ubuntu 出口某时刻能访问公共 Demo 接口 | 不等同于 Windows 经 SSH/SOCKS、私有签名接口或实际账户在适用地区被准入；需做同 host/path/时间基准对比 |
| Windows 经 SOCKS 完成认证、TCP、TLS，收到交易所 HTTP 200 | 该次请求的端到端链路可用 | 不保证全部私有 API 正常、不会偶发超时或今后不出现 451 |
| `/fapi/v2/account` 签名 GET 返回 200 且 `canTrade=true` | 所采样账户的当时技术交易权限为 true | 不等同于独立官方法律/地域适用范围确认，也不证明全部订单保护无误 |
| HTTP 451 | 目标响应可能是受限制/合规拒绝；应保留完整请求阶段、目标、响应来源和时间 | **不能预先断言是代理脚本损坏。** 如为交易所明确地区/政策拒绝，不得用更换出口、DNS 伪造、轮换地区或改 API 域名绕过 |
| SOCKS negotiation、SSH tunnel、TLS timeout | 链路某一阶段超时/失败 | 不等于 HTTP 451；排查当前 socket/代理 PID/SSH 健康/预算、排队和时延，再依据阶段修复本地代理缺陷 |
| HTTP 400/502 或 REST 排队超时 | 仅说明对应状态码/失败类型 | 必须保留 response body/phase/dispatch decision；不要把 400 当成仓位不存在或把 502 当成 451 |

**经验结论：** “代理服务器公共 GET 200，因此任意 HTTP 451 都是代理故障”不是可证明的因果关系。对可复现的 SOCKS/SSH 实现、转发配置、超时/缓冲问题应修复两端脚本；对交易所返回的受限/合规拒绝，应保留原意、停止受影响交易请求并走合规核实，不能把更换地域出口当作修复。

## 四、按阶段诊断的最小排障手册（只读、有限次数）

1. **身份先行：** 对齐时间（UTC+08 与 UTC）、实际 Engine PID/build/instance、Settings exchange host、代理端口持有者 PID、模型 PID 与已有监控。别用历史 `tunnel-health.json` 的 `unhealthy` 覆盖新的签名成功样本。
2. **Windows 本地：** 只读检查 20091 TCP owner、SSH PID 与已批准 ssh.exe 命令行；单次调用既有 `-Status` 获取 SOCKS/TLS/HTTPS 分阶段健康（该健康检查本身会进行有界公共网络请求）。限制采样次数与超时，别在拥堵时做大量无预算探测。
3. **Ubuntu：** 已授权宿主通过脚本 `--check`、`ss -tinp` 查看 sshd 转发、TCP retrans/notsent/Send-Q；专用账户 `MaxSessions=0` 不支持交互式 ssh shell，**绝不为方便诊断放宽**。比较至少两个相邻、有共同时间戳的有限快照，网络字节不与解码后的 WebSocket 应用字节混为一谈。
4. **按请求打标：** 记录 `QUEUE_WAIT → SOCKS_CONNECT/NEGOTIATION → TLS → RESPONSE → SIGNED_PRIVATE_SYNC` 的开始/结束、是否重用 socket、最终 HTTP 状态、失败阶段、请求来源/用途；分离 451、502、400、8 秒超时与未获 dispatch 许可。
5. **判据：** 仅当实测有 SSH/SOCKS/转发缺陷，才考虑在独立离线 PR 中修复 `zdj-trade-proxy-client-windows.ps1` / `zdj-trade-proxy-server-ubuntu.sh`。必须保留相同合法出口与原账号、做失败复现/回归测试，不改地区策略与合规门禁。
6. **交易安全回读：** 每次网络恢复或新版重启后都应核对签名私有账户、非零实际仓位与 openOrders/openAlgoOrders、双 ID/方向/reduceOnly/未成交剩余数量/价格的 TP 完整匹配、ProductionWrites=0；不能用一个 HTTP 200、单个 `/health` READY 或本地缓存 13/13 取代。

## 五、这次 ENAUSDC 的“补仓 1 次”是独立 P0 核查点

用户现场画面：08:21:31 创建 ENAUSDC LONG 初始订单，状态 `PARTIALLY_FILLED`；08:21:34 首次成交，08:22:26 显示最近“补仓”，累计 1；当时 UI 显示 TP `PROTECTED / BINANCE_OPEN_ORDER`。未在这份文档中读到当笔私有成交及第二个 Entry 的原始双 ID。

**已定位显示语义误差的代码路径：**

- `apps/engine/src/services/positionLifecycleTracker.ts` 对 `quantity > previous.currentQty` 即记录 `INCREASE` 并执行 `addCount++`，不要求存在第二笔独立 Entry；同一个初始订单被多次部分成交，理论上就可能出现 `addCount=1`。
- `apps/dashboard/src/utils/holdingDuration.ts` 把 `lastAddAt` 直接标成“最近补仓”，同时沿用“补仓与部分平仓不重置起点”的通用历史说明。此字段是**仓位数量增加计数**，不能单凭字面把它解释为实际追加授权。
- `apps/engine/src/services/noSeparateAdd.ts` 已有独立的 `NO_SEPARATE_ADD_V398` 原始授权数量/持仓/生命周期/待提交订单守卫及相应单测：允许**同一个 immutable origin 的部分成交且不超过原批准数量**，拒绝第二个独立 Entry Origin。这些离线代码/测试并不能替代 ENA 当时的真实身份审计。

优先执行 [Issue #23 ENAUSDC 只读审计](https://github.com/3684993/ZDJMITS/issues/23)：对比初始 Primary→Intent→Order（交易所及客户端双 ID）→逐笔 fill/trade→lifecycle 的同一物理周期。只有真实出现第二笔独立授权才可判定“禁止补仓”违规；如果只是原订单的 partial fills，修正前端术语为“仓位数量增加/初始订单后续成交”并加回归用例，避免误导。**不得为改文案中断在运行的保护 Engine**；若发现真实禁补仓违规，依事故与验收规则安全处置。

## 六、24 小时观察与退出条件

- 正式 T0 `2026-10-10 08:16:49.685+08`，结束边界 `2026-10-11 08:16:49.685+08`；该时间窗仍是 RUNNING，用户可随时要求终止。每 60 秒只读采样证据必须继续绑定新 instance，不能用 PR19 旧 90 分钟样本替换或混入。
- 24 小时覆盖：真实当前 PID/build/6-of-6 身份持续、private freshness、TP 全覆盖、Production zero、真实允许候选与自然 Primary 3–5 分钟分析漏斗、代理 451/502/超时分类、观察器与任务运行情况，及必要 GPU/AI 服务健康。
- 并非“过了 24 小时自动 PASS”；结束还要审阅完整时间窗、异常、最终新鲜签名账户/TP与实际订单保护。重启、修复、用户终止或确认的安全缺陷意味着本轮验收无效，重新经批准发布、验证后再从新 T0 计算完整 24 小时。
- 保留严格 **禁止补仓、Primary 自主 Entry、HUMAN_MANAGED、订单幂等、TESTNET-only、Production 写入 0、未经证实事实=UNKNOWN**；本总结不批准绕过交易所受限响应或执行策略。

## 七、完成项与未完成项

- **已闭环：** 最新构建真实单次部署与启动；新版已生效；基础诊断网络在本次 20 个 GET 中 200；新的 24 小时验收已启动；发布前后签名 TP 当时 12/12；辅助组件未被重复重启。
- **尚未闭环：** 历史 HTTP 451 的根因（本次未重现，不能宣布已永久修复）；偶发连接超时的长期可靠性；24 小时验收终局；ENAUSDC 补仓 UI 标记与订单身份判定（见 Issue #23）；完整 GPU/Primary SLO 24 小时量化证据。
- **后续处理规则：** 修复只依据可复现证据，不能动现有生产资料/密钥/私人 SQLite；代码另走独立 PR、CI、正式部署、重新验收；普通 GitHub 文档提交不会热更新已启动的 Engine。

---

维护记录：2026-10-10；GitHub-only 资料核对与经验固化；没有远程访问 Windows/Ubuntu 进程或执行运行时变更。
