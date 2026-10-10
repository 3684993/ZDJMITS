# 实际部署与模型管理验证

运行源码：2c9fec513bd5ba0406015c33b2c7cf9ce420ebaf，源hash34c72c80f2846d91bab72b847cdfbf42a7b5a2a561ea1e1540537938d6bfa498，artifact a6b1702cf52af4257f0475af6bbc711b2f65b98d937bfc12da1204a3f1afc787。main合并PR38的基础上只有本轮已验证的模型幂等/正常执行策略修复；PR39保持Draft供审核，未强推main。

18:08第一签名轮网络首字节/后续队列超时；18:09独立复核29仓27全身份PASS，在线28/27缺TP，均NO_GO。未发送退出事件。运行保护自行恢复后，在18:15签名28/28全身份PASS+V2 canTrade=true+私有11958ms+Production0+精确CI/备份/封存/PID/rollback全部通过，才激活单独新artifact授权。旧授权未改，数据根D:/MITS/data和Settings253保持。隔离控制台列表严格为23936+helper22248，发送CTRL_C，旧主程序记录SIGINT/HTTP_SERVER_CLOSED/PROCESS_EXIT0，宿主CHILD_EXITED0。18:16启动新宿主1216和Engine12140一次，无Force回退、无自动重试。bootstrap68秒并经历503 STARTING，随后health200 READY，未因预热再启动。

新实例6/6见live-deployment-identity-and-protection.json。第一重启后6个交易所GET全部200/28仓28候选保护，但本地orders/snapshot10秒读超时，因此该证据UNKNOWN，未冒称通过。稳定后的独立新签名28/28所有双订单身份/cycle/side/qty/price/reduceOnly核验PASS，V2 canTrade=true；28/28本地TP READY，Production writes/blocked0。源与构建、审批、实例、端口/创建时刻一一对应；Settings原版本及代理18300/20091保留。

线上真实浏览器读取settings并逐个选择3资源，填本机受ACL保护token后启动/重启按钮全部enabled，停止按钮存在；截图前清空token，未持久化或上传密钥。实际后端三次start均200 READY，保持25912/22880/16772，审计ALREADY_IN_REQUESTED_STATE、无进程中断。无token403 MODEL_OPERATION_PERMISSION_DENIED。首轮拒绝响应10秒超时保留，第二次预认证拒绝明确403，未发起任何进程动作。未为了演示停止新恢复的27B，真实stop/restart条件仍包括交易保护、drain、固定身份、空闲slots、其他客户端、锁、超时与审计。

运行观察器旧PID1920在等待旧receipt时持有独占mutex，新观察器启动返回1；已核验旧exe/cmd/创建时刻，只终止旧只读观察器，保留计划任务启用并重新启动。现6376绑定新receipt/source且任务Running。重启任务VBS使用新stage/entry授权、用户指定scripts/1，读取本机token文件并仅注入子进程，保留隐藏运行/触发器/身份。未执行Windows重启；这些重启设置是读回验证而非重启验收。

额外1小时GPU OS采样器及目录准备的复合工具请求在CreateProcess前被平台blocked by policy拒绝，整组未执行。未换包装/通道重试采样启动。实际API模型身份/固定GPU可以读取，但实时显存保持UNKNOWN；之前18:06 WDDM三卡实测不是当前连续指标。root因原离线退出发起者/exitCode仍UNKNOWN，没凭READY猜测崩溃原因。

本机完整verify:ci 264文件/2211例，精确源码2c9 CI38043800329 SUCCESS，GitHub原始日志归档；source与依赖实际npm ci/build成功。模型推理性能证据：Review新启动38+38tokens，43.73/43.55tokens/s；旧Engine恢复后Scout延迟13.535秒，Primary65.582秒（任务不同，不能作同比提速结论）。没有强制自然任务或制造交易样本。新Engine启动后的自然任务另按实际资源/日志观察，不借用旧实例累计。

旧24h验收ABORTED保持，新NOT_STARTED/T0=null，等待用户下一步指令。Primary唯一Entry、NO_ADD/HUMAN_MANAGED/TP及Production0保持。浏览器任意命令禁止，操作token只在当前页面使用；本机操作密钥文件D:/MITS-OPERATIONS/immediate-model-recovery-20261010/model-operation-token.private.txt，不应粘贴到GitHub或聊天。
