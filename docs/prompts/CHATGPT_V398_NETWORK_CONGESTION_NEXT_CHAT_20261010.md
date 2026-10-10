# 新开 ChatGPT 网页对话提示词
# 对话标题：v3.9.8网络拥堵优化

请继续维护我的 GitHub 仓库 **3684993/ZDJMITS**，这次以**彻底解决 Binance 网络拥堵并恢复 Engine 在真实 TESTNET 负载下长期稳定运行**为最高优先级。请你担任技术负责人，直接读取GitHub源码、最新PR、CI、主机维护证据，并与Codex协作实际实施，而不是仅写优化建议。无需让我复制旧聊天记录或解释历史硬约束。

## 你必须第一时间通过GitHub读取这三份主文件，按最新证据优先
1. **当前完整网络计划：** `docs/plans/V398_NETWORK_CONGESTION_ENGINE_ISOLATION_RECOVERY_20261010.md`
2. **给Codex的实际执行与重启指令：** `docs/prompts/CODEX_V398_NETWORK_CONGESTION_EXECUTE_20261010.md`
3. **维护全局交接：** `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`，并参考`docs/project-memory.md`和原历史网络计划；历史进度有冲突时以最新有时间戳的真实主机测量为准，不能把旧PID和CI归类为现时状态。

我的最新已证实实验：Engine在线时同SSH代理请求Binance公共接口0/8全部超时，服务器SSH Send-Q约2.7MB；Engine停止后、代理PID12212不变，公开请求4/4返回HTTP200，Ubuntu 12次采样中11次Send-Q=0、一例4496B很快归零。原Market WS解码 4.56MiB/60s，`!ticker@arr`与`!markPrice@arr@1s`两种全市场广播占约81%总量。高度怀疑Engine连续行情过载导致SSH/TCP通道堵塞；不是已证明的唯一路由原因，Windows↔Ubuntu链路仍有明显RTT与重传。

最新已知：`main ef00780c`；**PR #41** `f1f5d9c`代理生命周期/界面CI绿未合并；**PR #42** `c9cd14c`面向保留币种的WS缩流代码+测试已提交、Draft、CI需核验，未合并。上一发布Engine PID13476 e3dc48b版已被隔离测试证实停止；代理20091 PID12212仍活动。私有签名资金/仓位、交易所当前TP覆盖尚未验证。不要把4/4公开GET或PID在线误称交易系统恢复。

**本消息明确授权 Codex 在安全核验之后对本机及可管理Ubuntu执行必要的真实部署、合并、代理/Engine/守护/模型等确实需要的服务受控重启与复测，直到稳定达标；发现再拥堵，就沿着WS订阅、REST权重及队列、SSH/TCP链路、代理守护、Engine生命周期逐层修复，并重新CI与发布，不能只停留在文档。** 但不要把“所有组件全重启”作为目标：健康模型无需重启；每次重启需身份检查、受控退出、回执、回滚和有限尝试。若TP/私有事实不可证明，就继续恢复网络并安全限制新建仓，不得因急于上线强杀或取消安全保护。

请马上完成：检查PR42 exact-head CI和变更契约→修复失败/订阅ACK、>1024 stream边界、全市场广播等问题→完成专项测试及CI→审查并合并 PR42/PR41 中符合要求的内容→Codex实际发布已验证的 TESTNET 构建、根据实时情况重启必要组件并恢复稳定的 Engine/代理/WS/REST/私有同步→进行30分钟正常负载稳定和90分钟自然业务复核；反复按真实瓶颈修改，不靠延长超时、放宽TTL、自动重复重启或反复切换VPS出口掩盖故障。

核心硬约束：**TESTNET only / Production writes 0 / Primary唯一Entry / 禁止补仓与任何新增平均成本操作 / HUMAN_MANAGED优先 / 双ID幂等 / 真正的交易所TP保护 / PRIVATE UNKNOWN fail-closed / 无直连或451规避。** 官方签名TP需新鲜验证；因本轮Engine已停止，不得把旧显示TP27/27当当前事实。不要无授权启动新的24h正式验收。

从实际行动开始，不要停留在讨论：先展示新旧数据对比、PR/CI与当前Engine真实状态；对Codex明确下达可以执行的第一阶段源代码、测试、合并和上线指令。后续每个合并/部署/重启/验收结果务必写入GitHub报告与交接文件，附提交SHA、CI、PID、实例身份、代理请求阶段、SSH队列与私有/TP安全证据；不完整就写UNKNOWN/NO_GO，不虚报“网络已根治”。
