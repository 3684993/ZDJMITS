# V3.9.8 P0 / PR #20 GitHub-only review — 2026-10-09

## Evidence boundary
This report is based on **live GitHub connector readback**, not Windows or Ubuntu access. It does not attest that Engine, TCP tunnel, private facts, TP, or cadence have changed.

- Readback main before report write: `e9623c53380b6d8df41f2b8c8a5a0898246c28f1` (PR #19 already merged via `39931a7`).
- PR #20: OPEN / NOT_MERGED, latest reviewed HEAD `4a0ddb3d16f5504d4fc5cd86f97778651e6c86b0`, seven affected files.
- Hosted main verify `37930909464` for PR #19 merge **SUCCESS**; main `37938125083` for `e9623c5` **SUCCESS** (actual GitHub runs, not historical local claims).
- The current workflow `.github/workflows/v392-verify.yml` does not automatically trigger for `codex/v398-passive-proxy-health-20261009`; there is no successful PR #20 head CI. Do not treat another SHA's CI as PR #20 verification.
- PR #20 **OFFLINE_VERIFIED = NOT_PROVEN**, `MERGED=false`, `LIVE_DEPLOYED=false`, `PRIVATE_READY=UNKNOWN_LIVE`, `CADENCE_90MIN=NOT_STARTED`.

## Remote source review and remedial commits on existing PR #20 branch

1. `2c40541` / `4e894d6`: replaced coarse six 10-second inbound WS buckets with bounded sixty 1-second buckets. Original implementation was not an exact rolling 60s measurement and could prematurely exclude up to nearly 10 seconds of still-recent traffic at a bucket boundary. Added `last60sByType` / `totalByType` classes for BOOK_TICKER, TICKER_24H, MARK_PRICE, DEPTH, KLINE, AGG_TRADE, CONTROL_OR_OTHER, INVALID_JSON and MIXED_OR_OTHER. Attribution happens after JSON parse but **before retained-symbol filtering**, includes inbound messages rejected by symbol, and stores counts only (no symbol, raw payload, account data or credential). Added time-boundary and 70-second bounded-history fixtures.
2. `61b5087` / `755e6db`: passive cache now distinguishes observed admitted HTTP 451 eligibility refusals and HTTP 502 upstream responses from pre-dispatch queue timeout and socket failures. A recent 451 remains a warning even if a public 2xx is observed afterward; 2xx does **not** prove account/product/region eligibility. Tests use in-memory request-budget metadata, not real Binance probes.
3. `3b5d82b`: Settings proxy tab distinguishes 451 and 502; passive GET on tab activation and 30s only while that tab is open (still no new Binance GET). Existing manual POST test still performs actual health probe and remains unchanged.
4. `4a0ddb3`: subscription telemetry renamed `requestedGlobalStreams` with `subscriptionEvidence=LOCAL_REQUESTED_NOT_EXCHANGE_ACKED`; local subscription bookkeeping is not proof of exchange ACK.
5. No subscribe/unsubscribe policy, request budget admission, private TTL, network route, order submission, TP Guardian, risk guard, no-add rule or Production path was modified by these review changes. PR #20 still needs independent build/test verification before merge.

Measurement limitations: 1s bucket quantization gives approximate rolling 60s (up to <1s edge error). Byte counts reflect **decoded application messages** on PUBLIC and MARKET WS only. They exclude TLS/TCP framing/retransmits/SSH overhead and the PRIVATE user-data WS and REST. Type grouping identifies event types; it alone cannot prove which upstream requested stream sent each message or account for total SSH bytes. Reconcile with host-level SSH stats and private traffic separately. Until an approved instrumented Engine is running, **no real per-lane Mbps/share is known**, so reducing global subscriptions now would be speculative.

## Original incident, kept separate
- Existing Windows-via-SOCKS5H HTTP 451, HTTP 502 and roughly 15s timeout are three distinct observations. A successful Ubuntu `/fapi/v1/time` HTTP 200 from a prior sample does not establish current Windows/private eligibility.
- Prior Ubuntu SSH send backlog (`1,149,236→826,680` bytes), `notsent` (`1,063,104→791,380`), RTT (~377→403ms), and increasing cumulative retransmitted bytes support SSH-downlink congestion, **not exact attribution to all-market WS**.
- Private-sync failure evidence and 60s private TTL require fail-closed NEW_ENTRY until fresh signed funds/account/positions/orders/TP facts are proved.
- Formal Engine lifecycle previously returned `blocked by policy`; do not retry that forbidden operation via another command/tool/UI/task scheduler. Authorization on business policy is not host execution permission.

## P0.0–P0.6 gate decisions
- **P0.0**: GitHub main/PR/Issue and source checked; current host PID/build/8080, SOCKS owner, private sync, current TP and Production write truth **not checked** in this session.
- **P0.1**: Instrument code amended + focused cases committed; `npm ci && npm run verify` **not run for PR #20 head**. Codex must run clean isolated worktree tests, capture exit/log SHA, and review corrected version; no merge yet.
- **P0.2**: Host `ss`, TCP and Binance eligibility remain for properly authorized Codex/operator. Do not circumvent 451 by changing egress geography.
- **P0.3**: HTTP 451/502 passive categories added; more detailed queue/SOCKS/healthy-slow/private-sync phase UI can follow tests and evidence, must not synthesize unknown durations.
- **P0.4**: No market subscription pruning yet: wait for synchronized instrumented PUBLIC/MARKET bytes + type breakdown, PRIVATE REST/WS, Linux SSH send/ack/notsent, retained count, freshness and backfill/reconnect audit. Optimize only the source shown material by measured data, with rollback and unchanged 5s quote/closed Kline requirements.
- **P0.5**: `LIVE_DEPLOYED=false`. Before any one legal TESTNET Engine cutover, refresh signed account/order/TP, Production=0, approval+source/artifact/Settings identity, SQLite backup, WER, current PID/ownership and permission. A prior policy block does not become permission by repetition.
- **P0.6**: `CADENCE_90MIN=NOT_STARTED`. T0 needs actual new Engine child identity and fresh eligible candidate supply; 18 windows ×5 minutes must prove effective Primary requested/valid completion and no forced trades.

## Next Codex entrypoint
See `docs/prompts/V398_P0_CODEX_REMOTE_REVIEW_FOLLOWUP_20261009.md` in main. Codex must independently re-read current PR #20 HEAD; these SHAs are historical review anchors, not future runtime facts.
