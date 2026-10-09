# V3.9.8 P0 本机执行回执 — 2026-10-09

## 边界与审查身份

北京时间 21:57 起，在干净的 `C:\Users\5700x\.codex\worktrees\666a\MITS` 执行。完整读取两份指定交接文件，远端确认 PR #19 已合并、PR #20 OPEN。原 PR20 HEAD `023aad9512ba3288a7f7c128b08c92a6611d97d0`，同步 main `7d698a5c59818f7b16a8729b5e672b1674d74336`；以普通 merge 集成 main 的文档更新，合并锚点 `7e003d863c4e0fa7c82ac88738b09e4ff2e0754f`。修复源提交 `0399eff5e601723c249ff6f6b70c59a23cb8dd22`。

`D:\MITS` 有已删除文件和未跟踪证据/脚本；只读检查，没有 reset、clean、stash、切换或提交该目录。运行 SQLite 只以 `readOnly:true` / `query_only=ON` 读取。没有执行 Engine stop/start、模型或代理生命周期，没有修改 live Settings/授权文件，没有主动交易所写入。

## 已修复并执行的事项

1. PR20 原代理页删除了已有“编辑 → 保存 → 测试 → 激活”说明，首轮全量 verify 的资源流程测试真实失败。恢复说明，同时明确轮询只在代理页打开时进行。增加真实组件测试，证明离页/卸载停止 GET、不会调用主动 POST test。补齐被动 API mock，卸载测试组件避免遗留计时器。
2. WS 流量快照原先每条 lane 分别调用 `Date.now()`，跨秒边界时两条 lane 的 60s 窗口可能不同。统一一次 `observedAt`，返回 `windowAsOf`。增加全部九类事件、过滤掉的 symbol、lane 总数/总字节和分项总数相等测试。保留 60 个 1s 桶、原始消息不留存、decoded payload 与 SSH wire bytes 区别。未改订阅或路由。
3. 现场两个每 5 分钟任务直接在 Interactive 登录用户下启动 `node.exe`：`ZDJ-V398-Passive-Trade-Audit`、`ZDJ-V398-Primary-Cadence-90min`。这是周期弹窗的 STRONG_EVIDENCE 来源；任务执行时间与审计文件时间一致。TaskScheduler Operational 日志原本关闭，未声称已有逐次窗口事件证据。
4. 全部 8 个 `ZDJ-*` / `ZDJ *` 任务改为 `wscript.exe //B //Nologo` 执行 Unicode VBS：`WScript.Shell.Run(originalCommand,0,True)`，隐藏子进程并等待完成、原样返回退出码。原命令/参数/WorkingDirectory 保留；只替换 Action，触发器、Principal、安全监控和 Disabled 状态保留，没有 Run/Stop task。安装文件永久目录 `D:\MITS-OPERATIONS\silent-tasks-20261009`，GitHub 留原 XML、VBS、前后读回和哈希。
5. 新启动器最初生成末尾两个语句时有换行错误，被动审计于 22:05:52 一次返回 1。已修正全部文件；22:09:11 Primary 观察和 22:10:52 被动审计自然执行均返回 0并写入记录。没有删去历史日志。独立无害子进程测试证明窗口不可见、含空格路径/工作目录正确、等待结束且返回 23，不涉及真实 task/Engine 生命周期。之后自然任务结果见最终 `task-readback.json`。
6. 正规 reboot 注册脚本以后也安装隐藏 Action；现行 reboot 的旧构建路径/权限/启动命令没有切换。Crash Observer PID17772 的当前实例没有重启，持续写日志；WER 配置保留。三份模型脚本的启动/监控已使用 Hidden；旧 disabled 24h 任务保持 disabled。修复 full-verify 的 Engine host test 辅助进程缺 Hidden，避免测试本身弹窗。

已枚举 271 个计划任务、启动文件夹、HKCU/HKLM Run、相关进程、模型启动脚本、代理及后台监控。系统/AMD/其他应用的命令名称匹配不是弹窗归因证据；未停用 Windows/Defender/其他必要任务。已识别的 MITS 周期 console 入口均隐藏；不能把有限观察写成整个 Windows 永久无弹窗证明。

## 测试与 CI

证据位于 [local-20261009](./local-20261009/)；完整成功回执以 `verify-green-result.json` 为准。npm ci 完成；没有执行 npm audit fix 或改依赖。

该目录的 `.log` 以逐字节binary属性入库，避免Git CRLF正规化破坏原始stdout/stderr的SHA；不清洗失败断言的空白。此设置仅涵盖本轮已审计日志，不改变代码whitespace检查。任务XML/VBS为原始Unicode备份。

- `npm-verify.log`：原 PR20 + main 全量执行，脚本、S00、类型、build 与 Engine 通过，Dashboard 1 个资源说明断言失败；整体 FAIL。
- `npm-verify-final.log` / `verify-result.json`：整体 exit=1；验证中曾继续编辑流量源/测试，Vitest 的旧源转换与新增测试混用，新增 `windowAsOf` 断言失败。这次不可作为任何最终源的有效验收，日志完整保留。
- `focused-dashboard.log`：3 个组件测试 PASS；`focused-engine.log`：行情 17、资源 API 18，共 35 个测试 PASS；`silent-launcher-test.log`：隐藏/工作目录/退出码合同 PASS。
- 最终在已提交、验证期间保持不变的 `0399eff` 上重新完整 `npm run verify`，22:14:53 完成，**exit=0；251个Vitest文件、2157个测试全部通过**（contracts 2、core 62、dashboard 127、engine 1966）；另16个Node脚本测试及全部PowerShell/S00/类型/build gate通过。日志SHA256=`E6543949F774C1999E861D9FD7D4D8CBAE0C60A4A3D4D5AA5845741CE256CD75`。S00 使用机械 `buildEntrypointReview` 更新新脚本清单，不降低 gate。
- 远端 main `7d698a5` Actions [37939796692](https://github.com/3684993/ZDJMITS/actions/runs/37939796692) 实时读回 **SUCCESS**。原 PR20 HEAD workflow runs=0。现有 workflow 不触发本 PR 分支，且 workflow_dispatch 对这种分支会进入旧自动 migration+push 条件；没有调用它，没有修改 workflow 或伪报 CI。最终新 HEAD 的实际查询另存 CI 回执，不能用 main SUCCESS 替代。

## 真实运行、网络与部署门槛

22:03:30 / 22:09:53 实测 Engine PID18100、实例 `65185f71-b336-4f6f-8149-cafe90f5e160`、build `3.9.8-6cd926abca3eec24392e`。`/health` DEGRADED/ready=true，但 Entry `status=BLOCKED` / `executionFactsStatus=BLOCKED`，`orderAuthorization=true` 并没有覆盖事实 gate。

22:09:53 私有最后成功 `1791553797555`，年龄 1,195,722ms，连续失败 66；错误在 `Proxy connection timed out` 和 `Binance request timed out` 间出现。近期预算样本同时存在未准入 TIMEOUT 和已准入 `/fapi/v1/time` 的约 8002ms SOCKS_NEGOTIATION 失败：socketAssignedAt/HTTP response 均 null。它们是不同故障。6 槽拥挤、公开请求占 4 槽，并不能证明放宽队列/私有 TTL 是正确修复。

最终22:19:04快照仍同一PID/实例/build，私有年龄1,747,415ms、连续失败84，最后错误Proxy connection timed out；Entry仍BLOCKED，Production0/既有Testnet117不变。实际快照文件保存这一最终读回，前两次观察数值保留在本文。

22:04 单次正规代理 `-Status` 有界探测：SSH PID18300，LOCAL_TCP_CONNECT / SOCKS_GREETING 通过，SOCKS_CONNECT_REPLY 在总计 8018ms deadline 失败、exit=1。本机 7 个已建立 SOCKS 客户连接属 Engine；SSH TCP 22091 存在不代表私有通道健康。没有重启代理或转换地理出口。

尝试以现有代理密钥和 known_hosts 只读 SSH `date; ss`，服务器拒绝 exec channel，exit=-1。GitHub server 脚本明确 `MaxSessions 0`，有意仅允许 forwarding；没有改配置、改身份或换工具绕过。因此**没有本轮 Ubuntu Send-Q/bytes_sent/acked/retrans 的新样本**。旧拥塞证据仅作历史贡献者，PUBLIC/MARKET 实时字节分母仍 UNKNOWN。旧 Engine 未部署 PR20，不能给未存在端点编造字节读数或直接裁剪全市场流。

模型 8081=`qwen3.5:9b` PID3400，8083/8084=`qwen/qwen3.8-27b` PID14020/PID22336，GET `/v1/models` 均成功；不代表已完成新的 Engine Primary 分析。本地缓存 13 个仓位、TP 面板 13/13 READY，但私有事实过期，本次**当前交易所双 ID/数量/reduceOnly 覆盖未证明**；摘要仅存当前 TP 的 ID 哈希，不上传账户原始响应。

运行边界 `TESTNET_ENABLED`、`lockedToTestnet=true`，现实例 `productionWrites=0` / `blockedProductionWriteAttempts=0`，`testnetWrites=117` 为既有累积，不是本轮新订单。最新快照另存，不把一次公共 GET 当账户资格证明。

官方 [TestNet Terms](https://www.binance.com/en/about-legal/terms-testnets) 第7、10条要求适用 Testnet 产品资格及合法访问；本文无法确定实际账户/地区资格。历史 451 与 502 不被当前超时覆盖，也不被公共 200洗白。需要正常 Binance 官方支持/账户渠道的资格确认；不轮换出口规避限制。

因此 `LIVE_DEPLOYED=false`、`PRIVATE_READY=false`、`TP_EXCHANGE_CURRENT=UNKNOWN`、`ELIGIBILITY=UNKNOWN`，受控发布 **BLOCKED_BY_PREFLIGHT**。以前 lifecycle policy 拒绝记录保留，本轮没有再次调用或替代方式执行，也没有宣称新一次 policy 拒绝或获得放行。实际新 build 的六项身份、DB 发布备份、reboot 构建切换没有发生。

## Primary 与90分钟验收

旧实例本地状态 Primary PAUSED / NO_EXECUTABLE_CANDIDATE，事实 blocker PRIVATE_DATA_UNAVAILABLE，关键行情 MARKETS_QUOTES_STALE / freshMarkets=0。22:14:10 对 live SQLite 只读回看前90分钟（20:44:10–22:14:10）归档记录：Primary 0，Review COMPLETED 6；这不是新的连续90分钟验收，也不能还原合法候选持续存在的分母。保存查询脚本和结果。

`CADENCE_90MIN=NOT_STARTED`、T0=null、18个新版五分钟窗口=未开始、3–5分钟有效 Primary SLO=UNKNOWN。现有观察器继续输出 WAITING_FOR_APPROVED_NEW_DEPLOYMENT；没有强制候选、PLACE、合成 fills、补仓、降低 TP/风控、扩大 TTL 或手动解除 gate。

## ChatGPT 下一轮接力

先读取本报告及最终证据哈希/当前 PR20 HEAD，独立远端审阅 `0399eff` 和后续 docs commit。主机先取得合法账户/地区资格确认和允许读 Linux 统计的正规运维渠道；在原出口采样网络/私有恢复，不重配 sshd。真正 fresh signed funds/positions/openOrders、13仓位当前精确 TP、Production0、验证构建和正规生命周期权限齐全后，才允许一次 Engine-only TESTNET cutover；保留模型/代理/WER。届时更新观察器预期构建（当前仍绑定旧候选 `3.9.8-871988c3217af31d40f0`，不是 PR20 新构建），从实际六项身份闭合时设 T0，完成18个自然窗口。不要启动旧24h验收或把本轮隐藏任务配置当发布。
