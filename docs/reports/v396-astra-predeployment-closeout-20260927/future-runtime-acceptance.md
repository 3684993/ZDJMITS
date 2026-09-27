# Proposed later controlled acceptance — NOT AUTHORIZED / NOT EXECUTED

当前 **B1 HUMAN_DECISION_REQUIRED**，本候选不具备直接部署条件。先批准并处理 UNKNOWN proof 校验边界，针对 hydration/renewal/occupancy/claim 重跑回归和完整受影响本地门禁，再更新 identity manifest。以下仅为以后另行授权时的清单。

1. 固定通过人工审查的 GitHub main commit 与完整源树/artifact SHA256；本轮参考 candidate/source/artifact 见 `source-build-identity.json`。任何源码/构建字节变化都生成新 manifest，不复用本轮运行验收标签。
2. 在生命周期行动前再次只读采样 PID/instance/build/Settings version、environment、write lock、positions/TP quantity coverage、UNKNOWN 的各域与 active claim 的观察时点。当前参考 PID 18644 / instance e0919ffb-a97e-4eb6-b4bb-09818a489150 / Settings 219，可能随自然运行变动，不能盲用。
3. 当前运行 TESTNET_ENABLED、writeLocked=false；本轮未改变。后续必须由用户明确指定希望保持或改变的 write-lock/governance 状态，不能借部署授权修改 Settings/阈值。Production 必须继续锁定；不要把 instrumentation 的零 write counter 当成 exchange 总活动证明。
4. 对全部持仓检查 TP identity、quantity、状态及真实覆盖；本轮仅观察22个 PROTECTED/22 TP rows，不能替代保护覆盖验收。任何缺口只报告并要求人工处理，不自动 kill/restart。
5. 新旧 UNKNOWN 各域分开：历史 Entry、risk-occupying、proof-valid、active claims、active UNKNOWN claims、manual reduceOnly/position identity、TP，以及 mixed legacy。新 source 的 malformed proof fixture 必须 fail-closed；不可删除 UNKNOWN history 或把旧 mixed counter relabel。
6. 再次核验旧回滚目录 artifactHash `fa4fbc8660ef12849644402e2928ce127406fda654898f79bb8b3d1306aa3e61` 与 receipt 一致。源码 hash `ad4754a44c2a8b6747f7bac39027032e865dfee156bc096a01c2559cb834a237`。回滚候选仅有身份确认，不含自动回滚授权。不要修改/删除当前旧 artifact。
7. 用户另行明确授权特定一次 `stop -> MANUAL_START` 后才执行；手动启动入口为 `scripts/start-zdj-lan.ps1`，重复存在实例必须复用。不得创建 autostart/guardian；健康检查失败报告人工介入，不得自动 restart。
8. 启动后独立检查新 PID/instance/startReason/sourceHash/artifactHash/buildId、Settings version 与 TESTNET boundary；然后才开始另行授权的 runtime acceptance。不要用本地测试通过、文件已复制或旧实例的 health 宣称新代码已加载。
9. BOOK/CANDIDATE 的 evaluatedAt/hash/generation/profile/Settings 与 gate values 同 pass；dashboard/API 无改算；PRE 与 POST telemetry 真实分离；不触发第二次模型调用、不改数量/方向/目标/horizon、不以遥测授权订单。
10. 全部未来现场证据、acceptance 或 blocker 仍提交到 GitHub；本轮 runtime acceptance 固定 NOT_RUN_EXTERNAL。本清单绝不等于现在可以部署/停止/启动。
