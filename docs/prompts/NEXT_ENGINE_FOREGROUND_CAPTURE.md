# Next foreground crash capture

在 Windows 机器上继续 `3684993/ZDJMITS` 当前维护，不要修改或重启 8083/8084。

执行：

```powershell
Set-Location D:\MITS
git fetch --all --prune
git merge --ff-only origin/main
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\MITS\scripts\windows\start-engine.ps1" -Foreground
```

要求：
- 只启动/观察 Engine 8080。
- 不要自动重启。
- Production writes 保持 0。
- 若再次退出，上传新生成的 `data\runtime-logs\engine.foreground.*.log`。
- 不需要额外手工诊断命令；新日志已经包含 scheduler/TradeRecord 阶段边界。
