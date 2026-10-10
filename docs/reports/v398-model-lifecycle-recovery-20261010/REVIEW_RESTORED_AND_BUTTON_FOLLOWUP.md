# Review实际恢复与三模型按钮跟进

本次执行原始 `D:/MITS/scripts/1/start-qwen3.8-27b-harness-vulkan1.ps1 -Mode Start -NoWatchdog` 成功，launcher11688，服务22880，创建17:55:08，8083健康。没有启动或操作未知PID。此前工具拒绝在CreateProcess之前，本次正常请求已获执行；不能归因于原脚本启动逻辑故障。初始Scout的RemoteSigned NotSigned错误另有真实stderr，已经验证源码后用按文件的Unblock-File处理，未改变全局策略。

三模型身份、PCI/GPU/显存见actual-three-model-recovery-1806.json。Review实际启动自检生成38+38tokens，43.73/43.55tokens/s；非自然交易任务，且不是与旧任务同负载的性能对比。旧Engine自然Scout已15次/失败0、Primary9次/失败0；Review累计失败19包含此前离线历史，尚未归零或抹除。自然任务时间及延迟见actual-engine-model-tasks-1804.json。

私有manifest已按用户明确指定的三个原脚本重新绑定SHA，保留原脚本9B上下文32768、27B65536；原P0脚本和manifest备份保留。路径使用真实state和规范化Windows路径，修复此前manifest的重复反斜杠造成身份误判。脱敏绑定见operator-model-binding-1755.json，未包含操作token。

后端重复启动READY且identityVerified模型改为ALREADY_IN_REQUESTED_STATE，无进程变更，释放drain及磁盘锁。真实超时/不确定修改结果仍保留锁防止自动重试。新增6项中的幂等测试通过。移除模型管理路径中的ExecutionPolicy Bypass，以正常主机策略运行已核验/可信脚本；浏览器只能发送固定action，不能运行任意命令。

完整verify:ci EXIT0，264文件/2211例，见verify-ci-lifecycle-followup.log。npm ci先前4c精确源已经EXIT0，依赖本轮未变。新变更GitHub精确CI另行跟踪，不借用旧SHA绿色。上一证据HEADaeaef94 CI38042542831 SUCCESS。

受控部署前置：旧Stop脚本Force不满足main prompt的graceful。graceful-console-stop.ps1仅对精确PID/start/exe/entry/hash且控制台列表严格为目标+辅助进程时发送CTRL_C_EVENT；超时无force回退。隔离Node测试target25012/helper21472捕获SIGINT、退出0，receipt已归档。在线Engine尚未发送任何退出事件；仍需当时签名全仓TP/canTrade/30秒私有同步/Production0、备份和精确CI全部通过。

原模型退出发起者/exitCode仍UNKNOWN，不声称已查明崩溃根因。当前没有开启新24小时验收。
