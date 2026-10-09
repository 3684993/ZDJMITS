# PR19 operator P0 amendment verification — 2026-10-09
## Status
OFFLINE_VERIFIED. LIVE_DEPLOYED=false. CADENCE_90MIN_PENDING; SLO acceptance UNKNOWN.
Operator authorizes one cutover: https://github.com/3684993/ZDJMITS/pull/19#issuecomment-6080327198 .
Tested code commit 72126215b4968a59e4b27b4d068ecb3455b24ee0 extends remote 7c6be6b3e0728adf559dca52e0f3baae1fdb1b80; no main overwrite.
## Implementation
- Authenticated signed TESTNET leverage GET binds SHA256 of actual signing API key plus credential generation. Cache scope includes environment, credentialRef, fingerprint and generation; rotation invalidates it. Missing/wrong proof fails closed; no invented account UID.
- Terminal journal persistence failure preserves reservation and managed order occupancy. Missing exact lookup at TTL becomes UNKNOWN occupied, never an invented EXPIRED terminal.
- Historical origin release requires persisted BINANCE_EXACT_ORDER fact, original quantity match, exact order/client identities in fill evidence, complete quantity conservation and CLOSED conserved trade cycle, fresh full account/order scan. Missing/drifting evidence remains occupied; no mass release or history mutation.
- Explicit operator horizon fix preserves Entry 1..5 minutes independently of frozen TP horizon; offline replay now supplies explicit horizon 3.
## Verification
npm ci exit 0; final complete npm run verify exit 0: 251 Vitest files, 2147 tests, plus 16 Node script tests and PowerShell lifecycle/proxy/reboot/collector gates, release identity, S00, typecheck and build.
Final private log SHA256 10a1893e75df2f7658ae2086caa013c298da45a3f3ca13259fed5d7604e336c8.
Targeted tests cover same-ref key rotation, generation mismatch, rotation during signed read, absent proof, journal write failure, TTL absent exact lookup, legacy quantity/fill/identity drift.
Original historical BNB 743.00 remains rejected; inward tick projection 743.01..743.21 retains TP 741.6; 17 archived parser cases: 15 accepted, 2 schema failures preserved.
Actual existing 27B endpoint 8084 returned HTTP200, model qwen/qwen3.8-27b, prompt tokens21044, output633, total21677; new protocol PLACE_SHORT Entry horizon5; materialization1/3/5 preserved, extra idealPrice rejected. Input was an explicitly HISTORICAL_AS_OF offline tick projection, not current executable authority; no order tools, SQLite writes or exchange writes. Current natural wire/schema acceptance still requires deployment.
Real signed leverage GET: 3 actual symbol ladders, 0 failures; authenticated credential fingerprint matches current Entry approval. Private raw proof stays local.
Hosted CI is not represented as SUCCESS; inspect exact latest remote checks separately.
## End old 24h protocol
ABORTED_BY_OPERATOR_FOR_P0_ENTRY_CADENCE at 2026-10-09T12:10:17.8362805Z; T0 2026-10-09T08:16:04.685Z; latest same-PID sample20:09:36 Beijing. No24h PASS.
Acceptance heartbeat PAUSED; dedicated five-minute checkpoint task Disabled. Existing WER and45s Crash Observer Running. Independent five-minute passive trade audit registered and verified result0.
Observer continuing prefix775131bytes SHA25645bfd98c5ed5e27bc1464826677b4cb76cf117911054ca19b5695364b563b3c3; checkpoint archive383697757dd907f2cd4e1d50957cd837ff4b74a71df793f65ac3e2b98c18a141.
## Pre-cutover facts / limitations
Old PID18100, instance65185f71-b336-4f6f-8149-cafe90f5e160, build3.9.8-6cd926abca3eec24392e retained during gates.
Models8081/8083/8084 PIDs3400/14020/22336 and proxy20091 PID6784 unchanged.
Review current ONLINE, historical three failures REVIEW_EXIT_WITHOUT_PLAN_PREDICATE for RAYSOL/TIA; missing supported plan predicate is a decision-validation failure, not proven cause of low Primary dispatch.
2026-10-09T12:30:36.726Z signed openOrders read proves TP13/13 by both order IDs, symbol, side, reduceOnly and remaining quantity. Production writes0.
Intermittent private GET timeouts and stale Engine private snapshot leave execution facts BLOCKED although explicit Entry orderAuthorization=true. A fresh account/funds/protection preflight is required before the authorized lifecycle. No Engine/model/proxy restart has yet occurred.
21/35 historical origin journal mismatches remain UNKNOWN absent exact dual-ID and conserved fills; no artificial removal.
