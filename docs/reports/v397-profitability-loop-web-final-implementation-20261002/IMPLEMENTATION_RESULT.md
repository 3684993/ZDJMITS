# V397 Profitability Loop and Web Final Implementation

Date: 2026-10-02  
Repository: `3684993/ZDJMITS`  
Implementation commit: `8f42608f6542d7fb314070043c6654c467b0b6c8`  
Runtime source commit: `8f42608f6542d7fb314070043c6654c467b0b6c8`

## Result

Implemented and pushed the V397 profitability and web changes to `main`. The current TESTNET instance was rebuilt and restarted once with `MANUAL_START`. The final runtime is `READY`; identity closure is `IDENTITY_CLOSED` with all six checks true. Production writes are zero. The runtime recorded zero TESTNET writes after this start.

The locally configured TESTNET Settings already contained the quote-specific business minimum fields, net-profit floor, review/exit controls, and their schema defaults. This implementation uses those persisted fields directly; no Settings schema or database migration was needed. The live API readback after startup reported Settings Version 241.

## Economic Entry contract

- Quantity and TP are selected together by the system economic candidate solver after direction/thesis authorization. The model quantity is retained for telemetry and does not size the executable order.
- Candidate quantity floors cover the business order notional, initial margin at configured leverage, and exchange filters. The floor is calculated against the lowest currently authorized price so an allowed reprice cannot drop the order below the mandate.
- The selected plan, allocation, intent, JIT checks, and adapter request consume the same resolved quantity and TP. No exchange-minimum fallback is used when the business floor or profit floor is unmet.
- The immutable economic mandate stores quote-denominated notional, initial margin, fees, slippage, FX, minimum net profit, TP price/horizon, fresh 1D/4H/15m direction facts, and 1-hour reachability. Quote fees and margin are converted from USD plan accounting into quote units before persistence.
- Entry is refused when fee-adjusted expected net profit is below the configured minimum. TP is not widened to a distant target to disguise insufficient net economics.
- TESTNET Settings readback: minimum initial margin `USDT 1 / USDC 1`; minimum order notional `USDT 200 / USDC 200`; minimum Entry net profit `$1`; trade-economics admission `ENFORCE`.

## Review, Exit, and handoff

Runtime Settings readback shows Position Review enabled, AI Exit authority `ENFORCE`, AI Exit minimum net profit `$0.20`, and automatic human handoff after `1,440 minutes`. The management deadline, review budget, TP protection, exit convergence, and handoff continue independently of whether a review model call returns usable facts. After this start, the runtime naturally recorded exit convergence work; it did not record a new review application or completed position close during the validation window. Existing positions remained under TP protection.

## Orders and trade records UI

- `/orders` now separates the latest complete exchange Entry snapshot from historical UNKNOWN claims. Readback state and verification time are explicit. The cancel action is available only for an exact, recently verified active exchange Entry order; historical UNKNOWN, stale, unavailable, terminal, or mismatched identities cannot issue an exchange cancel.
- The current verified TESTNET snapshot is **23 active exchange Entry orders**, all with `BINANCE_OPEN_ORDERS` provenance, plus 24 working TP orders. Historical UNKNOWN is separately shown: 173 Entry records; reconciliation also reports one manual UNKNOWN claim. Manual open-order readback is `READY` with zero active manual orders.
- This differs from the earlier reported exchange count of zero: the post-deployment authoritative exchange snapshot returned 23 active Entry orders. No order was cancelled as part of deployment; the page reflects the current exchange readback rather than hiding or bulk-cancelling those orders.
- Trade records display the authoritative close time above the entry time and sort by `closedAt` descending, with deterministic ID tie-breaking. “Exchange close” requires external/exchange provenance; taker status alone never labels a close as external. Unproven provenance remains UNKNOWN.
- Cancel eligibility, current-open-order projection, close-time ordering, and close-provenance behavior are covered by targeted tests. The implementation did not send a cancellation merely to test the UI.

## Browser warning attribution

The dashboard source contains no `MaxListenersExceededWarning`, `ObjectMultiplex`, or `setMaxListeners` code. The installed Chrome MetaMask extension (`nkbihfbeogaeaoehlefnkodbefgpgknn`, version `13.48.0.0`) has both warning strings and `ObjectMultiplex` in its injected `scripts/contentscript.js`, matching the `contentscript.js` stack attribution. Clean and extension-enabled temporary headless Chrome runs against the local Orders page emitted neither warning. Source ownership points to the wallet extension, while this validation run did not reproduce the runtime warning. No listener limit was raised.

## Validation and deployment evidence

- `npm run verify`: passed. Workspace typecheck, dependency/script verification, production builds, and all tests passed: contracts 58/58, Dashboard 114/114, Engine 1,661/1,661 (189 Engine test files).
- `node scripts/v396-s00-static-check.mjs`: S00-T01 through S00-T06 passed; no blockers.
- `git diff --check`: passed.
- `D:\MITS` fast-forwarded from `3c7b483` to implementation commit `8f42608`; `npm run build` passed on the deployment checkout.
- Runtime: health `READY`; version `3.9.6`; build ID `3.9.6-73a1a8ce102a99017380`; PID `9812`; start reason `MANUAL_START`; environment `TESTNET`; execution mode `TESTNET_ENABLED`.
- Identity closure: `IDENTITY_CLOSED`. Local `main`, remote `origin/main`, runtime source hash, dist artifact hash, runtime API identity, and instance file matched at closure. All six closure checks were true.
- Production writes: `0`; blocked Production write attempts: `0`; TESTNET writes since the deployed start: `0`.
- Natural readback: exchange position count 24; verified active Entry count 23; working TP count 24; TP guardian `required=24, protected=24, missing=0`; manual open-order count 0. Exit convergence ran. No new Entry submit or position close was manufactured for acceptance.
- Hosted CI was not run, as requested.

## Remaining UNKNOWN

- There was no new position close during this deployment window, so live provenance classification of a fresh manual/external close versus a system exit remains unobserved. Deterministic unit tests cover the classification rules, including that taker status alone is insufficient.
- The two browser warnings did not reproduce in the isolated temporary profiles. Their source attribution is the installed MetaMask content script; whether a particular normal-profile browser session still triggers them remains UNKNOWN.
- Active Entry orders remain at the exchange. They were left untouched; their continued status is represented by the verified current snapshot.
