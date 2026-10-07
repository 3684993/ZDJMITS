# J-MITS V3.9.7 — SSH / SOCKS ACTIVE REMEDIATION AUTHORIZATION

> This instruction supersedes the earlier lifecycle restriction that limited remediation to restarting 8080 only.
> Current main at authorization: `ac7692902d9ae232d9f637706129ee8f96ca4cbf`.
> Current factual state: local Engine fixes F01/F02/F03/F05/F06/F07/F08 are integrated and verified, but runtime remains NOT_HEALTHY because the configured SOCKS path still intermittently/consistently fails before TLS/HTTP.
> Authorizing user instruction: do not keep Codex limited to the current Engine instance; actively repair the real runtime/network path.

## 1. Scope is now the complete current runtime path

Codex may directly inspect, diagnose, edit, restart, rebuild, and re-verify the **current runtime path required by J-MITS TESTNET**, including:

- the currently running Engine/Dashboard instance;
- Engine launcher/runtime processes and their network state;
- the local SOCKS endpoint currently used by J-MITS;
- the SSH process/tunnel that provides that SOCKS endpoint;
- Windows process/port/socket state relevant to the tunnel;
- SSH client invocation/options/configuration used by the project;
- local VPN/proxy helper scripts;
- proxy/tunnel lifecycle, keepalive, reconnect, DNS mode, bind/listen behavior and stale-process handling;
- safe read-only network probes needed to distinguish local SOCKS, SSH channel, VPS-side resolution/egress, TLS and Binance reachability.

Do not stay in passive observation mode while the same failure is already reproducible.

The goal is to **repair the actual path and restore sustained private account truth**, not merely improve alert wording.

## 2. Local proxy/VPN scripts are now first-class project files

There are **two existing proxy scripts** under:

`D:\MITS\scripts\vpn`

They currently are not present in GitHub.

Required actions:

1. Inspect the directory and identify the exact two existing script filenames and their current complete contents.
2. Treat them as authoritative starting material; do not replace them with guessed scripts.
3. Audit what each script does: process discovery, SSH executable/options, local SOCKS port, remote target/host, keepalive, failure handling, restart behavior, logging, stale PID cleanup, idempotency and exit conditions.
4. If defects or missing resilience are found, edit/complete them directly.
5. You are explicitly authorized to **run/restart/rebuild the SSH/SOCKS tunnel using those scripts when needed**.
6. Validate the scripts against the real current machine/runtime, not only mocks.
7. Commit the **complete final versions of both scripts** into this repository under `scripts/vpn/` using their real filenames.
8. Add tests or safe diagnostic helpers where practical.
9. Commit all relevant tunnel diagnostics/evidence/reports to GitHub. Do not leave the only copy under a local outputs directory.
10. Update `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` with the final script filenames, GitHub paths, tunnel lifecycle contract and final verification evidence.

Secrets/private keys/passwords must never be committed. If the local scripts contain secrets, refactor them to reference secure local environment/configuration and commit only the secret-free script.

## 3. You may restart the tunnel

Previous reports stopped because SSH/SOCKS restart was outside the old "8080 only" scope.

That restriction is now removed.

You may:
- stop a stale/broken SSH tunnel process;
- start a clean replacement;
- rebuild the SOCKS listener;
- change SSH runtime options when evidence supports it;
- improve reconnect/keepalive/backoff behavior;
- clear only stale process/socket state required to rebuild the tunnel;
- restart the Engine as needed after the network path changes;
- repeat this diagnose -> repair -> restart -> verify loop without asking for staged confirmation.

Do not wait for a 6h/12h window before attempting a known repair.

Do not delete trading history, SQLite, TradeRecord, durable order identities or other trading state as part of tunnel repair.

## 4. Diagnose the phase precisely

Current evidence already proves:
- local TCP/SOCKS greeting to the configured endpoint can succeed quickly;
- CONNECT to `demo-fapi.binance.com:443` can time out before TLS/HTTP;
- Engine admission/queue fixes alone therefore cannot restore health;
- an established SSH TCP session is not proof that the dynamic-forward channel can actually resolve/connect to the destination.

Continue from that boundary.

Determine, with phase-specific evidence, whether failure is caused by:
- local SSH process/channel health;
- dynamic-forward channel creation;
- SOCKS request forwarding;
- remote DNS resolution;
- VPS resolver state;
- VPS outbound route/firewall/NAT;
- remote TCP connect to Binance;
- TLS after remote connect;
- SSH keepalive/channel exhaustion/resource leakage;
- script lifecycle defects creating stale/duplicate tunnels.

Do not label the root cause "Binance" or "VPS" without evidence.

Use the smallest safe probe that distinguishes each phase.

## 5. Repair, don't just classify

Once a concrete cause is identified, implement the repair in the same run.

Examples of acceptable evidence-driven work:
- correct SSH dynamic-forward options;
- use `ExitOnForwardFailure`, server-alive settings, connection timeout and bounded reconnect;
- ensure only one authoritative SOCKS tunnel owns the configured port;
- detect and kill stale tunnel instances safely before replacement;
- make scripts idempotent;
- verify listener ownership and destination CONNECT before declaring tunnel healthy;
- add bounded restart/backoff instead of infinite tight loops;
- ensure logs are bounded/rotated;
- distinguish expected shutdown from crash/reconnect;
- fix remote DNS mode if the existing configuration is inconsistent with `socks5h`;
- if the configured remote host itself is unhealthy and the project already has an approved alternative tunnel configuration, use evidence and preserve configuration history rather than silently swapping unrelated infrastructure.

Do not restore any deprecated static-egress-IP authorization gate.

## 6. Service-operation authority

Codex is no longer restricted to "restart 8080 only" for this remediation.

It may operate the **current Engine instance and its networking dependencies** as needed.

Avoid unnecessary restarts of independent AI/model services. If a model service does not participate in the SSH/SOCKS path, leave it alone. Do not reload models merely to repair networking.

If a network repair genuinely requires an adjacent service restart, record exactly why and its before/after PID/identity in the final report.

Settings and trading-strategy parameters must not be changed to hide the network failure.

## 7. Verification loop

After each meaningful tunnel repair:

1. verify the SOCKS listener owner/process;
2. verify SOCKS greeting;
3. verify CONNECT to the required Binance TESTNET destination;
4. verify TLS/HTTP phase if CONNECT succeeds;
5. verify Engine private account sync reaches READY;
6. verify private snapshot remains fresh;
7. verify consecutive private failures reset and stay bounded;
8. verify REST queue/active slots do not re-accumulate abnormally;
9. verify operational incidents reflect the real failure phase;
10. verify TP/private truth with fresh remote facts where possible;
11. verify Production writes remain 0;
12. verify TESTNET execution lock remains active.

Use short feedback windows (minutes), not hours, while repairing a reproducible outage. If a short validation fails, continue fixing immediately.

Once functional health is restored, then start a longer passive stability observation for latent drift only.

## 8. Old hourly stability-closeout job

The old "ZDJMITS remediation 6–12h stability closeout" / hourly observation must not block this repair.

If that collector/heartbeat is still running:
- it may continue only if it is passive and non-interfering;
- stop/disable or replace it if it competes for resources, confuses evidence windows or prevents lifecycle work;
- clearly mark old windows as PRE-REPAIR and never mix them into post-repair acceptance.

Do not spend turns producing hourly "still unhealthy" reports while a known repair remains actionable.

## 9. Completion condition

Do not stop at "SSH restarted".

This network-remediation run is complete only when:
- the actual two local VPN/proxy scripts are committed to GitHub under `scripts/vpn/`;
- tunnel lifecycle is reproducible and documented;
- the local SOCKS path can complete real required CONNECTs;
- private account facts return to READY and stay fresh through a bounded validation window;
- the Engine no longer falls back into the prior repeated UNAVAILABLE/queue pattern during that window;
- TP/private reconciliation can use fresh facts;
- Production writes are still 0;
- TESTNET-only boundary remains enforced;
- all code/script/report/evidence changes are in GitHub;
- handoff is updated with exact final paths and commit identities.

If the remaining root cause is truly outside the local machine after all local tunnel defects are repaired, prove the exact external boundary with phase-specific evidence and provide the concrete next remediation rather than waiting passively.
