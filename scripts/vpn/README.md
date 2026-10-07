# J-MITS TESTNET SSH/SOCKS lifecycle

The two scripts originate from the existing deployment on 2026-10-08:
`zdj-trade-proxy-client-windows.ps1` and `zdj-trade-proxy-server-ubuntu.sh`.
No private key/password is committed. Client credentials stay under
`%LOCALAPPDATA%\ZDJ-MITS\trade-proxy\id_ed25519`; verified server host keys stay in
`known_hosts`. The client never generates/overwrites either file and uses strict
host-key checking. Default route remains127.0.0.1:20091 → zdjproxy@43.156.0.24:22091.

Client modes (PowerShell, explicit operator lifecycle authority):

```powershell
& D:\MITS\scripts\vpn\zdj-trade-proxy-client-windows.ps1 -Status
& D:\MITS\scripts\vpn\zdj-trade-proxy-client-windows.ps1
& D:\MITS\scripts\vpn\zdj-trade-proxy-client-windows.ps1 -Restart
& D:\MITS\scripts\vpn\zdj-trade-proxy-client-windows.ps1 -Stop
```

Start is idempotent only for the proven configured SSH owner, and requires a real
SOCKS greeting/domain CONNECT/TLS/HTTP200 public TESTNET time response before READY.
An unrelated listener, command-line mismatch or reused PID is never killed.
`-Stop` stops the verified guardian first, then the verified tunnel. `-Restart`
does the same before replacement; restart does **not** silently re-enable a guardian.
SSH creation uses hidden WMI-owned processes outside the caller's Windows Job.
Normal Start-Process from a Codex/terminal Job can lose children when that Job exits.

`-Watch` supervises only this tunnel: one mutex per SOCKS port; probe every30s with
an8s total deadline; restart after3 consecutive failures; exponential2–30s backoff;
at most3 replacements per rolling15min. SSH startup/replacement exits are included
in the finite budget. Foreign ownership always aborts. Budget exhaustion records
failure and exits, leaving any existing tunnel for diagnosis; it never relaxes an
Engine fact gate, changes Settings or restarts Engine/models. `-RunForSeconds`
permits a finite monitored test; normal exit leaves the tunnel running.

Launch the watch process outside the Codex Job using the reviewed hidden WMI helper:

```powershell
& .\docs\reports\v397-ssh-socks-remediation-20261008\launch_detached.ps1 -Mode TunnelGuardian
```

Do not start multiple guardians. Receipts, health and bounded event/error logs are
local in `trade-proxy`. Event log retains current≤approximately1MiB plus previous;
SSH error log triggers a supervised replacement/rotation at8MiB, under the same
restart budget. The guardian performs only the public TESTNET time GET. Engine
private account freshness/TP/Production boundaries require separate read-only
localhost validation. Tunnel READY alone is not system acceptance.

The server installer preserves existing authorized keys, validates sshd configuration
before reload and rolls back invalid configuration. Unchanged configuration is not
reloaded. `MaxSessions 0` deliberately disables shell/exec sessions while permitting
local/dynamic forwarding; a failing `ssh user@host command` is not a DNS/egress test.
Server `--check` is intended for an already authorized VPS admin session. No server
deployment or root access is implied by client health; final report records whether
the server script was actually run. No static-egress authorization gate is added.

Local loopback regression (no credentials, exchange or real SSH lifecycle):

```powershell
& .\scripts\vpn\zdj-trade-proxy-client-windows.test.ps1
```
