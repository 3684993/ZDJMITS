# v3.9.8 性能驾驶舱交付回执

## 实际源码与验证

PR31 源码提交 `248e5f8b7d8d4a4e6e178dfde52a563d6a1abbb1` 的完整 GitHub Actions 已 SUCCESS：[38022146483](https://github.com/3684993/ZDJMITS/actions/runs/38022146483)。精确 SHA、各门禁和成功作业日志见 github-actions-dashboard.json 与 github-ci-dashboard-38022146483-success.log。本机 npm ci、相关单测、npm run verify:ci 成功；完整验证2173项。原 ChatGPT HEAD 编译与验证本已成功，本轮新增回归捕获过期展示、混币种事实及 Windows 原子文件替换等实际问题，未虚构原编译失败。

独立 [PR33](https://github.com/3684993/ZDJMITS/pull/33) 最终提交 `402b850f73fd10018fb03db0b5deaeda493dd499`，完整 [CI38018026331](https://github.com/3684993/ZDJMITS/actions/runs/38018026331) SUCCESS，本机2163项。

独立 [PR32](https://github.com/3684993/ZDJMITS/pull/32) 最终提交 `6ac46f8a93c096b5764bc05508ba47aa015bf381`，完整 [CI38018034694](https://github.com/3684993/ZDJMITS/actions/runs/38018034694) SUCCESS，本机2161项。

本回执和成功日志随后以单独归档提交推送 PR31；该最终 HEAD 的 CI 回读记录同步 PR31 与 [Issue30](https://github.com/3684993/ZDJMITS/issues/30#issuecomment-6093513411)。不得把源码提交绿灯转称为归档 HEAD 已验证。

## 仪表盘与测量

可用资金按 USDT/USDC 分币种展示：低于500红、500至不足1000黄、1000及以上绿、缺失或过期灰。增加可用资金、完整周期已实现收益、确认 funding 及未实现收益趋势，保留归因覆盖与缺口，禁止跨币种无依据混加。GPU、主机、模型及网络状态均保留红黄绿灰和 UNKNOWN；低开销缓存、独立采样、隐藏页暂停、请求中止及图表销毁已落实。

三 GPU/PID/PCI/端口/GGUF 的只读证据与映射强度见 D0 报告。自然窗口121点、30.055分钟，Primary运行计数+11/失败+1，Review+26/失败+0；20个Engine投影失败和1个OS计数失败保留。排队耗时字段缺失，真实队列P95 UNKNOWN。WDDM超过100%的异常计数保留原始证据，当前显示判 UNKNOWN。

独立容量租约的100任务离线重放中 Primary queue P95 4140→1520ms，下降63.3%；Review逾期0→0、失败0→0、任务100→100、Entry授权与交易所写均0→0。它证明该合成竞争场景的调度改善，不是现网收益或GPU吞吐改善。

外置采样器收窄PID后，3点 smoke 墙钟2899/1210/1151ms，CPU906.25/62.5/46.875ms；旧自然窗口墙钟中位5987ms。不同时间/负载且样本少，不构成严格前后性能证明。主机缓存离线1000读、361点历史、0次原生CPU调用，P95 2.628ms。截图为明确水印的离线 fixture，不含真实资金。

## 未解决与发布边界

PR33原子租约与默认关闭的安全借用策略已实现；生产借用审批策略接线未完成，双27B reasoning/output limit 不一致，禁止启用借用。PR32为有测试的 TP SHADOW 协议服务；生产签名事实provider、候选生成、GPU2自动调度及挂单事实触发优化未完成。Primary唯一Entry授权保持，禁止真实TP改价与补仓。

本轮所有PR保持Draft、未合并、未部署，未重启Engine/模型/代理，未改变Settings或发起交易所写。02:10Z签名25/25 TP通过只是历史只读样本；不能证明当前发布门禁或运行中的Production零写入。当前完整发布门禁 UNKNOWN。旧24小时验收已于08:34因TP门槛失败终止；未来只有新鲜全仓签名TP、TESTNET隔离、Production零写入、身份与安全门禁通过后，才能正式受控重启并重新开始完整24小时。

全部本轮代码、脱敏证据、测试日志与报告分别在三个PR的统一 docs/reports/v398-performance-dashboard-20261010/ 目录；PR31同时收录PR32/33最终CI快照。project-memory、CURRENT_MAINTENANCE_HANDOFF、Issue30/26/28已同步。原工作目录与已有dirty checkout保持。
