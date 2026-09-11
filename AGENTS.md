# Trading Engine operation policy

The user requires manual start only. Do not start, stop, restart, or hot-reload the trading Engine as part of audits, builds, tests, monitoring, recovery, or scheduled tasks. Obtain an explicit user instruction for a particular Engine lifecycle action before performing it. Never install or re-enable autostart tasks, services, startup entries, or restart guardians.

Use `scripts/start-zdj-lan.ps1` for an explicitly requested manual launch. Reuse an existing instance. A failed health probe requires reporting and manual intervention, not killing/restarting the process. Do not run `npm run dev` / `tsx watch` against the live data directory. Isolated tests may launch only test instances with separate data and ports, without exchange writes.

Read-only monitoring may observe and report failures. It must never recover the Engine by starting or restarting it. Keep existing positions and TP maintenance intact during audits.
