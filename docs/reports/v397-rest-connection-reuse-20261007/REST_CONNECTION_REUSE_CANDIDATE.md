# REST 连接复用补充修复候选

Status: LOCAL_VERIFY_PASS / NOT_DEPLOYED / RUNTIME_ACCEPTANCE_UNKNOWN。

基于GitHub main dd2e65e，在独立 checkout D:\MITS-WORKTREES\v397-rest-connection-reuse-20261007 实现。当前线上仍是源代码hash d9626b0f51ae679283d93b7b2bb9c6355322d3f65cbd7010b40d9aec57c9565e、8080 PID37952；本候选没有部署、没有data junction、不读取或改写live数据库。模型服务及现有collector不变。

## 证据与范围

第一小时日志与计时数据已在main的 docs/reports/v397-audit-remediation-20261007/FOLLOWUP_HOUR01.md 及证据文件归档。127个有完成计时的账户请求都不复用socket；SocksProxyAgent未设keepAlive，安装包Agent继承Node http.Agent。重复建立隧道的存在有PROVEN证据，是否是私有事实161秒陈旧或NET-002的主要原因仍是INFERENCE。

独立loopback SOCKS fixture只允许访问测试自己创建的127.0.0.1临时HTTP端口，绝无交易所/外部网络请求。修复前两项测试失败：连续读取不复用；修复后同一实际agent的连续读取只需一个SOCKS CONNECT。该测试证明agent连接池复用，不是TLS/交易所延迟对照。

## 最小变更

开启实际SOCKS agent的keepAlive，单origin活动及空闲socket上限均6，与现有REST admission总槽位6一致；没有扩大budget并发、速率、事实TTL、重试或策略阈值。HTTP失败不新增自动重试，尤其交易所写入的不确定性仍保持UNKNOWN。

reconfigure先换新agent，旧agent关闭keepAlive并销毁已有空闲socket；正在执行或已捕获旧路由的请求可按原路径完成，之后不留下旧路由空闲池。新请求不会跨路由复用旧隧道。三个有真实loopback网络语义的回归覆盖顺序复用、路由切换空闲清理、切换时旧请求完成。

77项transport/budget/pooling针对性测试通过。完整verify结果及日志将随候选提交。原始失败日志保留，不能用本地测试宣布live事实层稳定。

当前heartbeat明确禁止服务启停；本候选仅上传GitHub候选分支 codex/rest-connection-reuse-20261007，不提升main、不重启8080、不改变当前采集窗口。当前线上仍会暴露未修复的连接复用缺口，6h/12h应如实判定。F04/F10/F11继续暂停；本候选任何未来部署需要新的实例身份闭合和独立观测窗口，不能沿用旧窗口通过。

完整npm run verify退出0：Contracts2/Core58/Dashboard123/Engine1789，总计1972项测试、232文件；release/scripts/S00 T01–T06/typecheck/build均通过。完整日志full-verify.log，针对性日志targeted.log，修复前失败日志before-fix.log。无GitHub Actions参与。git diff --check通过。

## 20:52 followup：真实代理握手与逻辑取消边界

新增确认缺陷：Node HTTPS ClientRequest处于async SOCKS setup时，AbortSignal不足以让transport promise立即结束。实际offline probe：100ms预算，500ms强制关闭fixture才于517ms返回。proxy-deadline-before.json保存实际结果。修复后proxy-deadline-after.json：118ms返回，150ms宽限后proxy sockets0、budget active0。

在现有keep-alive候选中补充：每个JSON request绑定绝对deadline，BoundedSocksProxyAgent的connect使用独立SocksProxyAgent delegate并传入剩余握手期限；不存在并发修改共享timeout。没有该JSON deadline的WS请求沿用super.connect，不改变WS timeout策略。共享pool仍是原bounded agent。requestSignal直接单次结束transport、清理TLS/abort监听并释放admission；后续迟到回调不能改写已结算的timing或二次发布结果。读上下文提前取消时，物理setup最多继续到该请求期限；未宣称即时物理取消。

两个新增真实loopback回归覆盖stalled handshake deadline及read-context取消，包含proxy sockets和budget释放检查。第一次fixture没有resume输入，导致服务端看不到FIN，已修正fixture；失败日志initial-fixture-validation.log保留。最终针对性79测试通过；完整npm run verify退出0，1974测试/232文件（Engine1791），release/scripts/S00/typecheck/build全绿，无Actions。完整日志proxy-deadline-full-verify.log。

候选仍NOT_DEPLOYED，线上源代码/实例不变。不是已在线根治，也不猜测当前外部隧道根因；当前private snapshot超21分钟和NET-002数据仍应判NOT_STABLE。仅上传候选分支，本次heartbeat不授权启停，main只接收观察报告和证据。
