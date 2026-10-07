# Active SSH/SOCKS remediation — 2026-10-08

Authority: latest main a5d3dc4 and direct user SSH/SOCKS instruction supersede old
8080-only and6h/12h gates. Original scripts read completely from D:\MITS\scripts\vpn;
real filenames retained under scripts/vpn/. Original client contained an embedded
private key; only a redacted source and content hash are retained in GitHub. Secure
local key/known_hosts are referenced, not overwritten/uploaded. Dirty D:\MITS's other
changes remain untouched; these two originally untracked files were explicitly edited.

## Proven defects and corrections

Client accepted a live PID/listener as healthy; it ignored curl's native exit status
and could print READY after HTTP failure, blindly killed the PID file target, deleted
logs, lacked singleton/reconnect/health boundaries, and rewrote private credentials.
Final client uses proven command/creation-time identity, mutexes, strict existing host
keys, public TESTNET SOCKS→CONNECT→TLS→HTTP200 health, one total deadline/socket close,
idempotent healthy adoption, bounded logs and explicit restart/stop. Guardian watches
only the tunnel;3 failures,3 restarts/15min, bounded backoff; failed SSH launches count.
No Engine/model restart, Settings or exchange write by guardian.

Normal Start-Process under this Codex execution Job produced SSH38752 with inJob=true.
WMI-owned replacement27880/final29068 proves inJob=false. Hidden detached guardian
uses the same boundary. This removes a separately proven process-lifetime coupling;
it is not proof that every previous SOCKS/TLS failure was caused by Job ownership.

Server original MaxSessions0 correctly forbids exec/shell sessions. Prior failed
read-only SSH command did not test remote DNS/curl. Final server script retains that
restriction, preserves other authorized keys, validates/rolls back config, reloads
only changes and separates CONFIGURED from destination health. Bash syntax verified;
server changes are not deployed merely to claim a fix. Remote DNS/VPS/SSH/Binance
root cause remains UNKNOWN unless later phase-specific evidence establishes it.

## Current pre-repair runtime and verification

8080 absent at start. Launcher reports oldPID37136 exit-1073740791 at06:54:51+08.
Windows WER/Application Error identifies codex.exe around the same time, not node.exe.
This correlation and exit code do not prove native Node root cause; retained as
separate lifecycle evidence. No automatic Engine restart to conceal that exit.
User-authorized manual recovery follows verified source/configuration and preserves DB.

Initial idle oldSSH40308 probe succeeded CONNECT368ms/TLS1056ms/HTTP1764ms; thus no
constant outage was proven today. Rebuilt final29068 also passes real destination
health. The older failure windows are PRE-REPAIR and never mixed into acceptance.

Full local verify PASS1982tests/233files (Contracts2/Core58/Dashboard123/Engine1799),
release/scripts/typecheck/build; final revised-script tests PASS, S00 refreshed from
unchanged derivation rules155entries. Preliminary S00 count151vs154 failure retained;
no rule relaxation. Tests prove foreign-owner rejection, reused-PID rejection, real
stalled SOCKS greeting deadline/socket close and finite failed-start recovery. No Actions.

Source/scripts are ready for publication; current Engine recovery/load validation
follows below. Models8081/8083/8084 remain12732/17468/51124. Settings/fresh private/TP/
queue/market/Production facts and independent current-instance data decide acceptance.
F04/F10/F11 strategy tuning remains paused. No TTL/safety-fact/rate/strategy weakening.
