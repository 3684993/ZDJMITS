# GitHub and cutover readiness receipt

PR: https://github.com/3684993/ZDJMITS/pull/14 (open, ready for review, mergeable=true at readback; not merged).
Code commit: cb0de7b0a98ad41900d7f8b7c3dfddd327ee82a3; normal branch push and ls-remote equality verified. Main remains 90a1e459b4912e47378709db68d20ac331beaed3. This follow-up changes only delivery evidence, not tested application code.

GitHub exact-commit file readback: promptBudget, runExecutionOutcome, entryStartupPolicy, executionReadiness, entryCoordinator, aiFabric, main, compactEntry and reboot launcher blob SHAs all equal the local committed Git blobs. No source identity was inferred from a PR title.

Exact-code-SHA combined statuses=[] and pull-request workflow_runs=[] on both readbacks. Hosted CI is NOT OBSERVED/UNKNOWN, not PASS. Local complete verify passed with 2099 tests. Current runtime continuity and real natural order/stability acceptance remain separate.

Stable offline candidate prepared, npm ci succeeded, tested source bytes and built artifacts copied to preserve exact contentTreeHash (including Windows line endings). Git index tree equals code commit tree; no staged code modifications. No Engine process, approval file, task update or model/proxy lifecycle was started by this preparation.

```json
{
  "root": "D:\\MITS-RELEASES\\ZDJMITS-v398-ai-entry-cb0de7b",
  "commit": "cb0de7b0a98ad41900d7f8b7c3dfddd327ee82a3",
  "sourceHash": "53856d74adc0241a04fac4bee7fc59cb0f7deaaac86a36b28beee0ea2e59af02",
  "artifactHash": "6cd926abca3eec24392ea4f51db845914309ceb974908be2fbfc549ed3afd169",
  "buildId": "3.9.8-6cd926abca3eec24392e",
  "engineStarted": false,
  "approvalEnabled": false
}
```

Pre-confirm read-only refresh: PID 22988 / old build 3.9.8-97aa98c71e15a39ef7b6 / health HTTP 200 / private READY / process latch=1 / ANALYSIS_ONLY. Three model PIDs and proxy retained. Fresh signed v2 account canTrade=true; 12/12 exact TP identity/side/reduceOnly/quantity matches, current Entry/manual order readbacks READY with counts 0/0. Separate quote available balances at asOf=1791526150572: USDT 2103.07697055, USDC 3880.26015561. These are snapshots and must be reread immediately before any authorized cutover.

Production writes=0 and current instance TESTNET writes=0. Historical UNKNOWN, SQLite, Settings and WER preserved. Sensitive raw snapshots/model prompts/output/database backup stay local.

SQLite preservation receipt:

```json
{
  "method": "SQLite_online_backup_readonly_source",
  "source": "D:/MITS/data/zdj-settings.sqlite",
  "destination": "C:\\Users\\5700x\\AppData\\Local\\ZDJMITS\\diagnostics\\ai-entry-p0-20261009\\pre-confirm-settings.sqlite",
  "sha256": "ae8eca61285a4b21d2fd26bc979b26ec673b7af144c1809a7e71e82864e098b1",
  "bytes": 1052909568,
  "seconds": 12.88,
  "sourceWrites": 0
}
```

Awaiting the user's explicitly required confirmation for ONE TESTNET Engine stop -> MANUAL_START using this tested candidate. Preserve current positions/TP and enable only approved TESTNET Entry under the bound receipt. Models/proxy remain running. No additional restart/retry/rollback lifecycle is pre-authorized. See rollout.md for revocation without shutting down Engine.

Natural PLACE execution, exchange identity/fill/TP chain and sustained stability are PENDING; no order was manufactured. No Engine READY/CI success is counted as those acceptances.
