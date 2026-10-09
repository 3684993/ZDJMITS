# PR #12 merge and deployment closeout

Status: PR `MERGED`; stable-root TESTNET cutover and 6/6 runtime identity closure complete. Hosted checks were not recorded. Twenty-four-hour runtime stability remains `PENDING`.

## Final closeout — 2026-10-09 12:59 +08

- PR #12 merged by ordinary merge as `a742e3aa3e0f14678178c508ccbde38b8406d97b`. After fetch, local `main` and `origin/main` matched this SHA. The final PR head was `4a8e079eb97327fc6daee8de6a8aabe099fc7013`; comparison was 10 commits ahead / 0 behind before merge.
- Exact GitHub combined status for the final PR head contained no statuses (`statuses=[]`): `NO_RECORDED_CHECKS`, not a hosted-CI pass. The committed source tree locally completed `npm run verify`: 210/210 test files and 1901/1901 tests, including typecheck/build, release identity and S00 T01-T06. No hosted workflow was dispatched or awaited.
- A stable checkout at `D:\\MITS-RELEASES\\ZDJMITS-main` was built from merged `main`. The scheduled reboot task now invokes that stable path, uses the existing model/proxy roots, and remains `Ready` (not started during verification). The independent read-only observer task remains `Running`.
- One controlled TESTNET cutover was performed after recording a local restricted pre-cutover position/TP snapshot. The previous PID 12432 was stopped by exact-owner lifecycle script; the stable-root lifecycle script then launched one Engine instance. No model or proxy listener was restarted. PID 22988, instance `322685fa-bd92-4f3b-9257-fd15a2ffdc68`, host PID 2472, build `3.9.8-97aa98c71e15a39ef7b6` is serving port 8080 and `/health` returned HTTP 200 READY.
- `scripts/v396-g1-g4-identity-closure.mjs` returned `IDENTITY_CLOSED` 6/6: remote `main` = local `main`; committed source hash = runtime source hash; built artifact hash and derived build ID match runtime identity; API identity matches the persisted instance receipt; hashed source folders are clean. Exact hashes are recorded in the local output and observer stream.
- Position/TP readback after cutover showed 13/13 positions `PROTECTED`, `tpStatus=PROTECTED`, `tpCoverageSource=BINANCE_OPEN_ORDER`; pre/post snapshots were stored locally with restrictive ACL. The cutover snapshot shows no new Entry orders and no manual open orders. Snapshot SHA-256 values: pre `597c91f595839ba466daa5db60b9e9214fee1286d9b0632f02743aaf59f0b0dd`, post `ea6bc8f5a1e5c6fe39491735a148fcf73905535d87c5fa36c7aa6b24aaa38303`. Raw identity/order mapping remains local.
- The three model listeners (8081/8083/8084) and required proxy listener (20091) remained present. `/api/v3/diagnostics/closeout` reports `environment=TESTNET`, `executionMode=TESTNET_ENABLED`, `lockedToTestnet=true`, `testnetWrites=0`, `productionWrites=0`, and `blockedProductionWriteAttempts=0`. This task created no order. Analysis-only Entry latch continues to block submission.
- Current stability window is under five minutes at this receipt and is **not** a long-duration stability acceptance. Historical PID 8524 cause is still `UNKNOWN`; WER native Node dump behavior is not proven. AI natural Primary quality is separately reported as insufficient in `AI_ENTRY_DISPATCH_AND_QUALITY_ACCEPTANCE_20261009.md`.

## 13:03 +08 runtime recheck

The same PID/build remained `READY`; identity closure was repeated after the docs-only main update and again returned `IDENTITY_CLOSED` 6/6. `/diagnostics/closeout` remained TESTNET-locked with Production writes 0. Thirteen positions still report exchange-backed TP protection. The AI run ledger now shows one natural Primary `PLACE_SHORT` decision with no intent/order, and six context-size failures that have opened the AI circuit. This finding does not change the Engine health/identity result; AI quality remains insufficient and the oversized request is a source-level follow-up not yet corrected or deployed.

## PR source and verification (pre-merge checkpoint)

- Repository: `3684993/ZDJMITS`; target branch `main` at `d1ecbe978df84805f30fc1126bac85584df78011` when checked; PR branch `codex/reboot-orchestration-20261009` at `8f5d90bef48dffac537582e6755a6fb498bc8a75` before this turn's changes.
- The exact remote PR HEAD had no combined commit statuses (`statuses=[]`). This means hosted CI is `NO_RECORDED_CHECKS`, not passed.
- Local complete `npm run verify` passed: 210/210 test files, 1901/1901 tests, typecheck, builds, script tests, release identity, and S00 T01-T06. Initial S00 entrypoint drift (187 recorded vs 190 derived) was regenerated using `buildEntrypointReview`; S00 reported zero network, Engine lifecycle, exchange writes, or Settings mutations.

## Runtime (pre-cutover checkpoint; superseded by final closeout above)

- At 12:44 +08, PID 12432 / instance `abae6740-87e3-4e89-9f90-b396426088a9` remained HTTP 200 `/health` READY, private READY, DB HEALTHY, build `3.9.8-b40c717775db32ddf33f`.
- Three model listeners and SOCKS proxy listener were present. Production writes observed by this work: 0.
- Current loaded build is not the proposed analysis-only dispatch repair. Keep Engine uninterrupted until verification, remote delivery, and a separately bounded cutover gate are complete.
- Read-only `/api/v3/positions` showed 13 positions; 13/13 report `PROTECTED`, source `BINANCE_OPEN_ORDER`, and a non-empty TP identity. This is the Engine's recent exchange-backed read model, not a substitute for preserving all exact exchange and durable identity facts at any later cutover boundary.
- Independent observer task has been verified Running and produced two 45-second samples after its FollowCurrentReceipt comparison fix. PID 12432 remained healthy through the check.

## Reboot task (pre-merge checkpoint; superseded above)

- Existing `ZDJ-MITS-AfterReboot-TESTNET` remains Ready, but its command and project root point to the temporary Codex worktree. A stable versioned root and task update are still required after merge.

## Closeout status at pre-merge checkpoint (superseded above)

- PR merge: `NOT_YET`; final commit/push, exact updated HEAD, and mergeability/check requirements remain to be verified.
- Latest source deployed: `SOURCE_NOT`; no restart or deployment occurred.
- Runtime acceptance: current Engine is healthy, but not on the proposed source. This report is not a 24-hour stability claim.
