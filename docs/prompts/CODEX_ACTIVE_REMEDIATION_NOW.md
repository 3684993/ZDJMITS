# J-MITS V3.9.7 — ACTIVE REMEDIATION NOW

> Status: supersedes the old "wait for the 6h/12h observation window before deployment" rule.
> Prepared: 2026-10-07.
> Current main observed when written: `f190e3d04024ae8f4b2295d6fe0cb46252dbe04e`.
> Proven runtime state from `docs/reports/v397-audit-remediation-20261007/FOLLOWUP_HOUR03.md`:
> - third hour: all 60 new samples private UNAVAILABLE;
> - current private snapshot stale ~81 minutes;
> - 98 consecutive private-sync failures;
> - NEW_ENTRY/model spend safely blocked;
> - TP DEGRADED with two orphan items;
> - candidate `0737e6649dd9c0754c4238bc3a860ec786487a0a` is verified locally but not deployed.

## 1. Stop passive observation as a gating activity

Do **not** wait for the remaining 6h/12h window before acting.

Three hours of persistent same-mode failure is already enough evidence that the current deployed instance is not healthy. Additional passive samples do not justify delaying a known remediation.

The previous long-window collector may remain as passive evidence if it does not interfere, but it must no longer block implementation/deployment decisions.

If the system is continuously private-UNAVAILABLE, NEW_ENTRY blocked, and TP degraded, the next action is remediation, not waiting.

## 2. Immediate first action

Start from the actual latest remote state.

1. Read:
   - `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`
   - `docs/reports/system-audit-20261007/SYSTEM_AUDIT_20261007.md`
   - `docs/reports/v397-audit-remediation-20261007/FOLLOWUP_HOUR03.md`
   - this file.
2. Inspect current `main`.
3. Inspect branch `codex/rest-connection-reuse-20261007` and commit `0737e6649dd9c0754c4238bc3a860ec786487a0a`.
4. Preserve all observation/report commits already on main.
5. Integrate the verified transport candidate onto the latest main safely.
6. Re-run the relevant targeted tests and full `npm run verify` against the integrated final tree.

Do not discard the candidate merely because the external proxy root cause remains unproven. The candidate fixes a separately proven local correctness bug: a stalled async SOCKS negotiation could outlive the request budget/cancellation boundary.

## 3. Continue fixing known confirmed defects in the same run

Do not stop after deploying `0737e66` if the code audit still shows the following confirmed defects.

### A. Private truth / REST capacity

Fix the actual current failure path without weakening private truth freshness:
- preserve fail-closed behavior when account facts are truly stale;
- do not increase the private freshness TTL merely to make the dashboard green;
- ensure private/current facts receive bounded priority over historical/background recovery;
- prevent background/history/reconciliation fanout from starving account refresh;
- ensure cancelled/timed-out requests release active slots promptly;
- inspect whether connection reuse, SOCKS negotiation, queue TTL, retry cadence and recovery fanout together still allow current account reads to starve;
- do not treat low Binance weight as proof that local REST capacity is healthy.

### B. NET-002 semantics

Fix the known semantic holes:
- `/fapi/v1/allOrders` / historical / reconciliation timeout work must not automatically become a global `MARKET_DATA / NEW_ENTRY` "Binance REST continuous latency" incident;
- classify by purpose/source, not endpoint alone;
- a stale private account must remain a real execution blocker, but the account-UNAVAILABLE branch must not fabricate a "60 seconds multiple REST timeout" NET-002 when the burst rule was not satisfied;
- distinguish local admission/queue timeout, proxy/SOCKS/transport timeout and exchange response delay in telemetry;
- deduplicate the same physical failure across route/private incident paths;
- keep the actual first cause visible.

### C. Advisory vs required REST dependency

Close the proven F06 mismatch:
- BACKGROUND must actually map to the background lane;
- `premiumIndex` cannot be "advisory for incidents" while still being an unconditional hard prerequisite inside `getQuote` unless that contract is explicitly justified;
- define required market facts by purpose and provide safe fallback/partial assembly when optional facts fail;
- do not weaken required executable quote/book/kline truth.

### D. Reconciliation fairness

Fix the proven F07 starvation behavior:
- historical UNKNOWN risk remains risk-bearing;
- do not delete or synthesize certainty;
- add fair rotation/backoff so the same first few historical IDs do not consume every remote-audit budget forever;
- expose unique identities progressed, oldest deferred age and per-class retry reason;
- keep per-run remote budgets and bounded history reads.

### E. Operational incident recovery duplication

Fix F08:
- one recovery transition must publish one recovery event;
- do not replay the entire old incident history as new recovery events;
- preserve historical evidence rather than deleting it.

### F. Quote freshness / monotonicity

Fix F01 before any strategy tuning:
- quote fields must not share one timestamp that lets a fresh bid/ask make stale last/mark appear fresh;
- reject/regulate out-of-order patches;
- retain per-field event/update/receive age where needed;
- REST seed/reconnect must not overwrite newer WS truth;
- add deterministic tests for stale-field + fresh-field mixing and old-event overwrite.

### G. TP remote terminal recovery and current orphan diagnosis

Fix F02:
- CANCELED / EXPIRED / REJECTED exact remote order facts must not be remapped to WORKING/PARTIALLY_FILLED solely from executedQty;
- test partial-fill-then-cancel and lost-ACK recovery;
- keep projection, durable task, quantity claim and guardian state consistent.

Then diagnose the **current two TP orphan items** using exact read-only identity evidence after private truth recovers. Do not delete/reset them or claim them resolved without exchange evidence.

## 4. No strategy tuning yet

Do not begin F04/F10/F11 parameter tuning while the factual/execution substrate is unhealthy.

Do not alter:
- entry frequency thresholds;
- leverage policy;
- position count;
- TP target economics;
- loss-handoff policy

merely to increase activity while private truth, REST capacity or TP reconciliation is broken.

## 5. Deployment rule

Once the integrated fixes pass local verification:

- update `main`;
- update `CURRENT_MAINTENANCE_HANDOFF.md`;
- commit all reports/evidence directly to GitHub;
- restart **8080 only** using the existing safe launcher;
- do not restart 8081/8083/8084;
- preserve SQLite/TradeRecord/history;
- Production writes remain 0.

Do not wait for GitHub Actions.

## 6. Post-deploy validation: short feedback loop, not another 12-hour gate

After deployment, use a bounded short validation window.

First check immediately and over approximately 10–30 minutes:
- private account transitions to READY;
- snapshot age stays within allowed freshness;
- consecutive private failures reset/stay bounded;
- active REST slots and queue age drain rather than monotonically grow;
- no repeated false NET-002 from allOrders/background/history;
- PUBLIC/MARKET WS remains healthy;
- TP protection/orphan state is re-evaluated with fresh private/exact facts;
- NEW_ENTRY/model-spend can resume only when real facts are fresh;
- Production writes stay 0;
- 8081/8083/8084 PIDs remain unchanged.

If this short validation fails, **do not wait longer**. Diagnose the new evidence, fix again, verify and redeploy in the same remediation loop.

Only after the system is functionally healthy should a passive 6–12h/overnight stability observation continue. Long observation is for latent stability/resource drift, not for deciding whether to repair an already persistent failure.

## 7. Completion condition

Do not report success merely because the candidate deployed.

Completion of this remediation run requires:
- private truth actually restored and remains fresh through the short validation;
- current REST queue/active-slot behavior materially improved or the remaining external blocker is proven with phase-specific evidence;
- false NET-002 paths fixed;
- TP orphan state understood from fresh evidence and any code defect corrected;
- all confirmed F01/F02/F03/F05/F06/F07/F08 code defects addressed or explicitly proven already correct on the final tree;
- full local verify green;
- final artifacts and evidence stored in GitHub.

If an external proxy/SSH/Binance condition remains after local defects are fixed, prove that specifically with timing-phase evidence. Do not use "external cause unknown" as a reason to leave confirmed local defects undeployed.


## Network lifecycle authority extension

The current runtime remains NOT_HEALTHY after local F01/F02/F03/F05/F06/F07/F08 fixes. Do not stop at classification. Continue with `docs/prompts/CODEX_SSH_SOCKS_REMEDIATION_NOW.md`. The previous "restart 8080 only" restriction no longer applies to the SSH/SOCKS tunnel or proxy helper scripts. Local scripts exist at `D:\MITS\scripts\vpn`; inspect, repair, run/restart as needed, and commit both complete secret-free scripts to GitHub under `scripts/vpn/`.
