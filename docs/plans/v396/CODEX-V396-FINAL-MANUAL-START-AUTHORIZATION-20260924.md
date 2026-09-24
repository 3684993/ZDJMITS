# V3.9.6 最终 Testnet 收尾：人工启动授权（2026-09-24）

用户已明确要求：立即实施当前 convergence 上的最新已验证修复，不再为本次收尾任务重复索取 Engine 启动/重启许可。

## 当前基线

- 分支：`codex/v396-final-convergence-20260922`
- 写本授权前远端 HEAD：`9ea84764c1f4ff52c2addcb3b7e2d2c007d48769`
- 最新产品修复链包含：
  - `d477fd98a01cb2c661f802cb8b5bcca6d32866ad`：PositionRisk V3 风险事实映射；
  - `7020f34f3bef91da369f8b5dabe48e5b33d8b2cd`：V3 缺少 leverage 时禁止 NaN 传播；
  - 以及此前已合入的 authority coverage 修补。
- 报告记录当前磁盘 dist 已包含上述修复、尚未运行；Engine 当前停止。

## 本次显式 lifecycle 指令

1. 先 `git fetch` 并只做 `merge --ff-only` 到最新 convergence；PR #9 不动。
2. 核对当前 live dist provenance 与最新产品源码闭合；若闭合，不为形式重复 build；若不闭合，先正式 build 再启动。
3. 立即执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall
```

4. 不允许 watchdog、autostart、service、hot reload、`npm run dev`、`tsx watch` 或无事实变化的循环重启。
5. 若本次启动后发现一个新的、可复现且已定位的 P0/P1 产品缺陷，本授权允许在**同一个最终收尾任务**内完成修补、正式 build，并执行与该修补一一对应的受控 `stop-zdj-lan.ps1` → `MANUAL_START`，无需再次向用户索取许可；每次额外 lifecycle 动作必须对应不同且有证据的修复，禁止纯重试。
6. private/egress 的短暂抖动不得用 restart 处理；等待事实恢复。
7. Production 写永久禁止。

## 启动后的必做收尾

继续执行现有 V3.9.6 正式 Testnet 激活链，不再新增纯审计轮：

- 在线复验 `/fapi/v3/positionRisk` 的真实持仓事实，确认 marginAsset / maintMargin / leverage / liquidation buffer 无 NaN、无契约污染；
- 运行时间必须跨过上一实例 175 秒崩溃窗口并保持无 fatal/Zod/NaN；
- 使用现有 authority preview/readback，若当前可 sized universe 扩展导致 coverage 缺口，则按既有专用 authority commit 流程显式刷新；不要改已批准的人工风险数值；
- profile/authority 健康后，按既有正式激活计划恢复 Testnet execution mode；
- 保持 AUTO_RUNNING / Entry Safety AUTO / aiExitAuthority SHADOW；
- 让自然 candidate/PLACE 走现有确定性准入与 Testnet 执行链；禁止人工伪造 candidate、PLACE 或 fill；
- 非资金/仓位类的持续技术 blocker 必须当作 P0/P1 修根因，不能把长期 READ_ONLY/ANALYSIS_ONLY 当作收尾状态；
- 已有持仓、TP、ownership、integrity 必须保持健康。

正常业务上“不新增仓位”应由真实资金、仓位、组合容量或自然候选条件解释；不得再以“需要人工再次批准启动/重启”为理由停止本任务。

完成后归档 live evidence/report，ff-only push，工作树 clean，并直接给出最终 runtime identity、execution/profile/readiness、position-risk coverage、authority coverage、写边界、自然 PLACE/准入结果以及 lifecycle 动作清单。