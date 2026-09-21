# S00 experiment pre-registration skeleton

Status: `NOT_CONFIGURED`. This file freezes the shape and anti-leakage rules only; no risk budget, threshold, sample size, or acceptance number is silently defaulted.

- **Identity:** `experimentId`, source commit, contract version, settings hash, fixture hash, prompt/model hashes, and signed registration timestamp must be recorded before test-set inspection.
- **Data:** manifest with source IDs, UTC coverage, schema version, complete/partial/unknown status, and an explicit train/tune/validation/test split. Test rows cannot be used for parameter selection.
- **Groups:** control = existing path with feature OFF; shadow = proposal observed without write effect; testnet enforce = separately authorized and account-isolated only. No live production group in S00.
- **Primary metrics:** to be frozen by S09 after S05/S06 inputs; candidates include evidence completeness, ownership conflicts, unresolved UNKNOWN retention, quantity-claim conservation, cost attribution, and tail-loss/response-cost measures.
- **Safety metrics:** production writes, reverse/opening risk from exit paths, duplicate claims, unknown-to-zero conversions, human-capacity bypasses, and protection gaps. Any hard invariant failure is a gate failure independent of aggregate score.
- **Costs:** fee, funding, slippage, model tokens/latency, manual response latency, and data gaps must remain separate. Unknown cost is `UNKNOWN`, never zero.
- **Versioning:** `OFF`, `SHADOW`, and `TESTNET_ENFORCE` are distinct feature states. S00 defines no enablement and no runtime consumer.
- **Stop rules:** no entry forcing, no production write, no Engine lifecycle action, no threshold relaxation, no deletion of failure samples, and no use of test results to tune the test split.

Required S05/S06/S09 inputs: numeric portfolio budget, trade-plan horizon/quantity rules, frozen metrics and confidence/uncertainty reporting. Missing inputs remain `NOT_CONFIGURED`.
