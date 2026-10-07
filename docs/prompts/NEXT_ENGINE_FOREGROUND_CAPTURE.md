# Next Engine foreground capture

Only use this if Engine 8080 crashes again. Do not restart or modify 8083/8084.

Run the normal formal startup path:

```powershell
Set-Location D:\MITS
git fetch --all --prune
git merge --ff-only origin/main
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\MITS\scripts\windows\start-engine.ps1" -Foreground
```

Rules:
- Observe 8080 only.
- Never auto-restart after a crash.
- Production writes must remain 0.
- Do not enable the old high-frequency scheduler BEGIN/END disk trace unless a new investigation explicitly requires it.
- Foreground logging is bounded/rotated and must not kill Engine when the mirror cannot be written.
- Reconciliation phase tracing and Windows Application Error/WER capture are already built in.
- If `0xC0000409` happens again, upload:
  - newest `D:\MITS\data\runtime-logs\engine.foreground.*.log`
  - newest `windows-application-events.txt` from the generated crash-report directory if present.
- Do not run Binance/VPN diagnostic scripts unless current evidence specifically requires them.
- After GitHub fixes, do not wait/poll Actions; report the new run to the user and let the user return the result.
