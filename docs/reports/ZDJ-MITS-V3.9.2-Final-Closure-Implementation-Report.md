# ZDJ-MITS V3.9.2 Final Closure Implementation Report

Date: 2026-09-10 (Asia/Shanghai)  
Scope: P0-A, P0-B, deployment, and 2h natural-acceptance baseline. Status: **DEPLOYMENT-READY / NATURAL-ACCEPTANCE-RUNNING.**

## Evidence and changes

- Current read-only runtime evidence is from the manually restarted Testnet instance (PID 16776, instance `b6ee5cb2-bdf4-430a-aabe-e8d4bb6cd47e`) running the verified V3.9.2 build; no Production write or firewall change was performed.
- A frozen archived Primary input lacked a closed-bar OHLCV event anchor. `TechnicalCard` now carries `lastClosedBar`; the compact facts expose it without inventing a trigger.
- The Primary contract now separates 15m direction from 1m/5m timing: a PLACE opposite an explicit UP/DOWN 15m structure is rejected. This does not force PLACE, widen an authorization range, or change a risk/capital/position gate.
- Live market updates are split so quote, book and recent-trade facts reach management even if strict 1m technical-card construction fails. The technical failure remains Entry-blocking. Unchanged bad OHLCV sequences are not recalculated or re-emitted; a changed sequence is reported once again.

## Verification

- Targeted: core 8/8; engine P0 tests 14/14.
- Full: `npm run verify` PASS. Core 39 tests, dashboard 15 tests, engine 288 tests (60 files); typecheck and production build passed. The current build is reused unchanged for the natural run.
- Source hashes: `marketDataHub.ts` 5645730F446C160130C9E95982CFF923F53F79A3113D90F07802BB5432E4317F; `aiFabric.ts` 6C9D6E2C6C9693BAF2FDADA71130A06E8F7BDADAB00ABE8875C8896D3DE824B0. Built engine hashes: `marketDataHub.js` 5B7FBB1033234A83A6B6F7D8FEFCB4EBD4D487FB4754AF122E0A95E028530BB1; `aiFabric.js` 352EF9D9D6392BFAD16FB6FE5B624426790718F2FFC27318327C5EB479E2AD1F.

## Acceptance state

| Item | Status |
| --- | --- |
| P0-A parser/facts/prompt and symmetric replay | PASS |
| P0-B local update isolation and sequence dedup | PASS |
| Current-instance Primary attempts/completed/decision distribution | Read-only baseline only; PENDING after deployment |
| 1m/5m/15m 2h freshness and gap reduction | PENDING natural isolated run |
| PLACE → Intent → Order → Fill, LONG/SHORT, Maker range | PENDING; no samples fabricated |
| TP/reconciliation | Unchanged; read-only baseline retained |
| P1-A/P1-B/P1-C | Not started |

Risk: P0 changes are not loaded into the current engine. A deployment requires a separate explicit Engine lifecycle instruction after isolated acceptance review.

## P0 minimal hardening update

Root cause: `hydrateLiveTechnical` compared `latestClose` to the old card before calculating OHLCV content, so an exchange revision with the same close time could be skipped. It now fingerprints full closed OHLCV first. A failed sequence is retained as an explicit Primary blocker until a new validated technical-card object is produced; bounded failure/dedup caches avoid both error storms and permanent locks. New regression coverage verifies blocker/recovery, unchanged failure dedup, changed sequence retry, and independent quote/book updates. `npm run verify` PASS: Engine 286 tests. Source hashes: provider `A6F89668608FD88A5431DD094854D740F949DB9483B97DC0EF8D49F48FE3FA0E`; hub `0372A8FE3FB9A61FCA41CF342D9621AC4EA49759DCBE579CC300A5C7AA5866CE`. Build hashes: provider `5BFD387CA6AAF5E7280C66377BD00E9C6F0F7CE6F556D09D77B5900B0D1A7F71`; hub `AA780B3983A5F96C0B0ABF39487DB3E1C3C2BC46457F51958B490CF3D3DF3243`.

## Read-only observability

`entryObservation` is the single server-side source for seven mutually exclusive decisions plus a separate RUNNING count. It exposes a read-only API at `/api/v3/observability/entry`, joins only durable runId→intentId→order identities, deduplicates fills by tradeId, and marks missing/ambiguous/external evidence UNKNOWN/EXTERNAL. It does not execute or mutate trading state. Verify PASS: 60 Engine files / 288 tests.

## Manual Testnet deployment

Status: **DEPLOYMENT-READY / NATURAL-ACCEPTANCE-PENDING**.

The old instance was stopped only after a SQLite/WAL/SHM and runtime-identity backup. The validated build was launched with `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`; the new switch bypasses only the optional firewall block and preserves the existing Engine launch/identity logic. No firewall command, network rule, Production write, database rebuild, or configuration expansion was performed.

Runtime identity is PID `16776`, instance `b6ee5cb2-bdf4-430a-aabe-e8d4bb6cd47e`, buildId `3.9.2-84d58ba7d91508e3fa7b`. The loaded artifact hash `84d58ba7d91508e3fa7b109e266121947ddb84b21f39dcda3baf4216b06bf389` and source hash `2d4ec930c75fc42a9fa6c7a9b14d27d05d8d8ef15727257bff1df0b204a9c118` match the local V3.9.2 tree hashes.

Read-only smoke checks passed: `/health=READY`, scheduler `RUNNING`, private data `READY`, WS `LIVE`, 157 market snapshots, reconciliation drift `0`, unresolved `0`, four recovered positions, four protected TP orders, and zero active entry orders. Config is `TESTNET` / `TESTNET_ENABLED`; Production write is `0`.

Natural observation baseline from the unique `/api/v3/observability/entry` source: completed `199`, RUNNING `1`; PLACE_LONG `2`, PLACE_SHORT `1`, WAIT_FOR_PRICE `2`, RESELECT_SYMBOL `0`, NO_DIRECTION_EDGE `193`, DATA_TECHNICAL_BLOCK `0`, AI_PROTOCOL_FAILURE `1`. NO_DIRECTION_EDGE is not a rejection, WAIT is not a PLACE failure, DATA_TECHNICAL_BLOCK is not an AI decision, and RUNNING is excluded from the completed denominator. Observed exchange-fill facts and the position/TP chain are retained, but entry-quality MAE/MFE and complete exit quality remain `PENDING`/`UNKNOWN` until complete attributable natural samples exist.

No new P0 blocker was found in deployment smoke/readiness. Natural acceptance remains pending; do not infer quality from fill counts or from mark prices without executable bid/ask facts.

Local plan/report/JSON delivery is complete. Google Drive upload to `zdj` is pending because the connected Drive action was rejected by the account usage limit; no workaround or third-party upload was attempted.

## Two-hour natural acceptance in progress

The current build remains unchanged. A detached read-only collector (PID `19076`) polls every 60 seconds for 120 minutes and writes redacted samples to `data/reports/v392-natural-acceptance-*`. It records per-Hot-symbol 1m/5m/15m closed-bar freshness and gap counts, quote/book age during technical blocks, the seven Primary categories with RUNNING separate, and exact durable lifecycle links. It performs no Engine control, trade/configuration write, firewall operation, or data interpolation. P1-A and P1-B are explicitly held until the completed 2h summary provides evidence; the post-window decision will be `ENTER P1-A`, `ENTER P1-B`, or `CONTINUE OBSERVING` with reasons.

Initial sample (20:15 local, 20 Hot symbols) had quote freshness 100% and book freshness 100%; strict closed-frame freshness was 1m 35%, 5m 40%, 15m 45%, with missing-latest-closed reasons recorded rather than relaxed. The same sample showed `PLACE_LONG=2`, `PLACE_SHORT=2`, `WAIT_FOR_PRICE=3`, `RESELECT_SYMBOL=0`, `NO_DIRECTION_EDGE=191`, `DATA_TECHNICAL_BLOCK=0`, `AI_PROTOCOL_FAILURE=1`, completed `199`, RUNNING `1`; chain counts were 3 intents, 2 orders, 1 first/complete fill and 197 UNKNOWN/EXTERNAL links. This is a baseline observation, not a quality pass or a P1 trigger.
