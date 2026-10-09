# 项目维护记忆

## 2026-10-09 V3.9.8 本机 P0 接力

权威回执：[LOCAL_EXECUTION_RECEIPT_20261009](./reports/v398-proxy-network-p0-20261009/LOCAL_EXECUTION_RECEIPT_20261009.md)。修复源 `0399eff5e601723c249ff6f6b70c59a23cb8dd22`；最终全量验证以同目录 `local-20261009/verify-green-result.json` 为准，PR/CI 必须查询最新 SHA。

Windows 已识别的周期弹窗源是两个 Interactive 5min Node task。8个 ZDJ task 仅更新 Action 为隐藏 WScript launcher；保留原 XML、命令/触发器/principal/disabled 状态，永久目录 `D:\MITS-OPERATIONS\silent-tasks-20261009`。Launcher 必须一行 Shell.Run、独立一行 WScript.Quit，wait=true且传播退出码；测试证明无可见 child console，实际定时观察+被动审计均继续成功。不要停安全监控来消除窗口。

现场 Engine 仍旧 build/PID18100；私有事实过期、SOCKS deadline失败。TP本地13/13不是当前exchange signed证明。代理账户 `MaxSessions=0` 禁止 shell；不能据此改ssh配置或冒充本轮Linux样本。451资格UNKNOWN必须官方确认。未部署、未重启、90min新版验收NOT_STARTED；旧观察器的build白名单必须在正规发布后更新。禁止绕policy、地区限制、独立补仓、Production、风险/TP/freshness减弱。

主机根目录 `D:\MITS` dirty且保留；本轮用隔离 worktree。原PR20资源说明断言失败已修复，PUBLIC/MARKET计数使用一次快照时间；decoded bytes不是SSH wire，也不含PRIVATE/REST。所有可发布回执/日志/任务备份在GitHub，钥匙、DB、账户原始事件及dumps留本机。
