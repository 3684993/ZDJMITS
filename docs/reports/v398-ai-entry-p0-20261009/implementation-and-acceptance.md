# V3.9.8 AI Entry P0 implementation and acceptance

Authority: issue #13 and `docs/plans/V398_AI_PLACE_NO_ORDER_AND_CONTEXT_BUDGET_P0_20261009.md`, completely read before implementation. Branch based on main `90a1e459b4912e47378709db68d20ac331beaed3`, with the supplied plan commit `bcf8514`. No main push or live deployment in this task.

## Proven blockers

1. The live x64 Node process PID 22988 has `ZDJ_ENTRY_ADMISSION_DISABLED=1`, read through query/read-only process permissions from its real environment. Runtime independently reports ANALYSIS_ONLY. Settings TESTNET_ENABLED and AUTO_RUNNING do not remove this process latch. PLACE therefore calls `completeReadOnlyAnalysis` and never creates a new execution Intent/Reservation/order.
2. Old publisher sent `analysisOnly:true,allowed:false` without `entryVetoEnforced:false`. Projection treated it as enforced portfolio refusal. Replaying 31 durable completed runs with the new projection yields 31 READ_ONLY_NON_EXECUTABLE, zero false PORTFOLIO_RISK blocks. All 31 decisions were PLACE (15 LONG/16 SHORT). Raw observed risk reasons remain accessible; actual non-analysis risk refusals still block.
3. Distinct FAILED reasons are documented individually in [failed-cohort.md](failed-cohort.md). Do not group schema contradictions as context failures or loosen validation to pass them.
4. Old execution readiness ignored startup authorization. The new snapshot shows the real write lock while permitting healthy analysis/observation. READY is no longer a claim of Entry write permission.

## Changes

- Publisher supplies explicit analysisOnly/orderAuthorization/entryVetoEnforced/observedAllowed/observedReasons.
- Projection supports existing historical analysisOnly events without rewriting SQLite; order/fill facts still take precedence and contradictory readonly facts are reported. Funnel separates readonly PLACE from executable conversion denominators. Dashboard displays readonly counts and raw risk observation separately.
- Lossless COMMON_COLUMNS_V1 candidate presentation shares repeated fields/proofs and names variable columns. Every LONG/SHORT row decodes exactly to the frozen candidate. Original packet, candidateSetHash, candidateId, quantity, entry price, TP, funds and market/risk facts are unchanged.
- Primary preflight reads current model props, applies its actual chat template, tokenizes through the same native model and rereads identity. Budget is min(28,000, n_ctx-outputReserve-512), outputReserve 900. Unknown model/alias/template/tokenizer, identity change or excess budget produces PROMPT_BUDGET_UNAVAILABLE before completion. Actual completion usage is compared again; missing/excess/mismatched usage cannot authorize a decision. Schema/response-format grammar is not extra textual prompt content in this local llama route; safety reserve covers template differences, and the actual usage check guards drift.
- Metadata records native input tokens/budget/context/alias/template and prompt hashes plus actual usage delta, with no full prompt in the new budget event. Full existing archive evidence remains local.
- Real `main.ts` defaults absent policy to ANALYSIS_ONLY. Explicit TESTNET Entry approval is bound to full runtime artifact/source identity, Settings version, unchanged data root, expiry and non-revoked operator approval. Missing/invalid approval still starts Engine in analysis mode. Removing/revoking/expiring the receipt immediately blocks subsequent Entry admission/submission; enabling requires a new explicit startup policy. Existing TP/account/reconciliation services keep running.
- Reboot task forwards mode/approval parameters from a stable project path. This task did not modify the installed task. Readonly TP candidate diagnostic now recognizes reduceOnly LIMIT protection orders; its candidate match remains UNVERIFIED until exact durable identity comparison.

## Account admission snapshot (bounded, must refresh before cutover)

- Environment TESTNET, funds policy TESTNET_FUNDS_ONLY; portfolio risk is observation, execution correctness still enforced.
- Signed TESTNET `/fapi/v2/account` returned `canTrade=true`. `/fapi/v3/account` omitted canTrade, and `/accountConfig` failed on TESTNET; omission/failure was not converted to false or true. The v2 fact is retained locally. This is an account-level permission fact, not a substitute for per-order exchange authorization.
- Assets snapshot asOf=1791525682523:
- USDT: availableBalance 2094.03629551 (quote units).
- USDC: availableBalance 3883.78919433 (quote units).
- Current capacity: 12 positions, 0 inFlight, 0 reserved. Sample frozen Entry account and capital budget independently show zero committed/reserved/lease margin and available quote balance as the source. These values are time-specific, not a permanent spending grant.
- Current exchange open Entry orders=0 and manual orders=0 (READY readbacks). There are 12 reduceOnly LIMIT TP orders. Joined current position.tpOrderId -> durable local TP -> exact exchangeOrderId AND clientOrderId gives 12/12 matches; symbol, positionSide, closing side, reduceOnly and remaining quantity also match. The old prefix/type heuristic incorrectly counted zero; that was not evidence of missing TP.
- Historical UNKNOWN: 4 visible records (EXPIRED), 211 older hidden records retained. They were not cleared or automatically attributed to all current orders. Existing exact-submission identity isolation and non-resubmittable UNKNOWN protections remain unchanged.
- no-separate-add remains mandatory for the same symbol/side, including durable origin, physical cycle, pending order/authorization and exact quantity checks. Opposite side does not select/veto Primary direction. Regression suite retains frozen selection, quantity/price/TP authorization and idempotency protections.

## Actual model validation

One archived failing input was sent once to the already-running Primary, with the formal JSON schema and production Entry parser, without an Engine/order adapter. Valid PLACE_LONG; native input count=25,784, completion usage input=25,784 (delta 0), output=755. Selected frozen LONG candidate exists; quantityUnits=null; target price/range/horizon are exact; idealPrice is within the returned entry range. No orders were created, no account writes were made. Archived replay is not a current trading signal or natural pipeline acceptance.

## Runtime/evidence continuity

Live PID 22988 / instance 322685fa-bd92-4f3b-9257-fd15a2ffdc68 / build 3.9.8-97aa98c71e15a39ef7b6 kept running throughout. Model PIDs 3400 (8081), 14020 (8083), 22336 (8084); proxy PID 6784 (20091) retained. Main trading runtime was not restarted or patched in place.

HKLM WER node.exe full dump configuration remains DumpType=2, DumpCount=2, local diagnostics/engine-wer. Independent crash observer task remains Running. Existing HKCU legacy configuration was recorded, not modified. SQLite, Settings and all historical evidence retained. Write-boundary telemetry remains TESTNET writes=0, Production writes=0 for the current instance. Sensitive snapshots, full prompts, raw outputs and dumps stay local; only redacted reports and hashes are committed.

## Acceptance boundaries

Completed: offline repair; native input budget and lossless fact validation; strict model replay; current scoped account/TP/identity readback; source/remote verification described in delivery receipt.

Pending: user-confirmed single TESTNET Engine cutover, natural PLACE -> frozen selection -> TradePlan -> Reservation -> Intent -> JIT -> submit -> exchange identity -> fill -> TP. No manufactured signal/order is allowed. No natural signal means WAITING_NATURAL_SIGNAL, not failure or permission to relax gates. Deployment and sustained stability/alpha acceptance remain NOT COMPLETED. READY and CI do not prove those outcomes.

See [rollout.md](rollout.md) for the explicit reversible release procedure. Test receipts are in [verification.md](verification.md).
