# Reversible TESTNET Entry rollout (not executed)

This receipt is a release procedure, not operator approval. No valid Entry approval file has been created, and the running process has not been switched. The user explicitly required separate confirmation for one TESTNET Engine cutover.

## Before asking for cutover

1. Finish `npm ci`, all `npm run verify` gates and actual model input validation; push the tested commit to the isolated branch and create its PR. Read code back from GitHub by exact SHA and compare bytes/hashes; read exact-SHA Actions/status without interpreting absent status checks as success.
2. Record current PID/instance/build, stable source/artifact hashes, Settings version, data-root identity, positions and TP exact exchange identities, Entry/manual open orders, account canTrade and separate quote balances. Preserve SQLite through an online backup (no deletion/reset), runtime journal, operational logs, host lifecycle and WER evidence in an ACL-protected local directory. Recheck immediately before stopping anything because positions, balance and TP may change naturally.
3. Prepare the exact tested PR commit in a new stable release directory, e.g. D:\MITS-RELEASES\ZDJMITS-v398-ai-entry-<commit8>. Build there without connecting an Engine to the live database. Never copy over files used by PID 22988. Compare full runtime source/artifact contentTreeHash in the candidate with the tested receipt. Existing live root D:\MITS-RELEASES\ZDJMITS-main remains the rollback artifact.
4. Present PR, local verification, account/TP facts, candidate hashes and the one-switch scope to the user. Await confirmation. No automatic retry, model/proxy restart, receipt enablement, or live Settings change is authorized by this document.

## After explicit confirmation only

Create a local ACL-protected approval file outside Git with the following values bound to the candidate. Use existing `contentTreeHash` from candidate `apps/engine/dist/runtime/runtimeIdentity.js` for both tree hashes (folders in implementation receipt); use Get-FileHash on candidate `apps/engine/dist/main.js` for entrypointSha256. Settings version must be reread from the unchanged live database; expiration is an explicit finite UTC Unix millisecond value chosen for the approved observation period.

```json
{
  "version": 1,
  "mode": "TESTNET_ENTRY_ENABLED",
  "operatorApproval": "ONE_TESTNET_ENGINE_SWITCH",
  "revoked": false,
  "settingsVersion": 253,
  "dataRoot": "D:\\MITS\\data",
  "sourceSha256": "EXACT_CANDIDATE_SOURCE_TREE_SHA256",
  "artifactSha256": "EXACT_CANDIDATE_ARTIFACT_TREE_SHA256",
  "entrypointSha256": "EXACT_CANDIDATE_MAIN_JS_SHA256",
  "expiresAt": "REPLACE_WITH_APPROVED_NUMERIC_UTC_UNIX_MS"
}
```

The template above is intentionally invalid (placeholder hashes/string expiry); it cannot enable writes.

Stop only the verified current Engine once through the controlled lifecycle procedure, retaining host exit-code receipt. Confirm PID exited and port 8080 is free. Keep all exchange TP orders and database/settings records. Launch only the candidate Engine using the formal `start-zdj-engine-host.ps1`, with hidden PowerShell host and dedicated stdout/stderr/lifecycle/current-receipt paths; do not use the stack launcher for this one-switch operation, as stack startup could launch missing model/proxy processes.

Set these variables in the new child launch environment, never in a shell as a claim of unlocking the existing Node process:

```powershell
$env:ZDJ_CONFIG_DIR = Join-Path $candidateRoot 'config'
$env:ZDJ_DATA_DIR = 'D:\MITS\data'
$env:ZDJ_HOST = '0.0.0.0'
$env:ZDJ_PORT = '8080'
$env:ZDJ_START_REASON = 'MANUAL_START'
$env:ZDJ_ENTRY_EXECUTION_POLICY = 'TESTNET_ENTRY_ENABLED'
$env:ZDJ_ENTRY_ADMISSION_DISABLED = '0'
$env:ZDJ_ENTRY_APPROVAL_FILE = $approvedReceiptPath
$env:ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256 = $approvedArtifactHash
```

The Engine itself binds its computed full source/artifact identity before creating Runtime. The policy rechecks receipt, identity, data root, Settings, environment, mode and expiry on admission/submission. Merely setting latch=0 without a valid approval cannot enable a new real main process.

For later reboot operation, update the installed task only after this cutover is approved and accepted, targeting the stable candidate script/root (never a temporary Codex checkout):

```powershell
& (Join-Path $candidateRoot 'scripts\start-zdj-stack-after-reboot.ps1') -RegisterAtLogon -ProjectRoot $candidateRoot -DataRoot 'D:\MITS\data' -EntryMode TESTNET_ENTRY_ENABLED -EntryApprovalFile $approvedReceiptPath
```

Invalid/expired approval falls back to analysis-only while preserving Engine startup, account sync, health, reconciliation and TP diagnosis. RegisterAtLogon is a future authorized installation action, not executed in this task.

## Verify and revoke

Immediately read PID/8080 health/build/identity 6-of-6, private account freshness, three model routes, same TP identities and Production writes=0. Confirm runtime `entryExecutionPolicy.orderAuthorization=true`, executionReadiness no startup lock, funds-only mode and all exact-order guards. Keep crash observer running; observe naturally without adding any forced order.

One natural valid PLACE must join the same brainRunId, candidateId/candidateSetHash, exact quantity/price/TP, TradePlan, Reservation, Intent, JIT, clientOrderId/exchangeOrderId, fills and TP. Preserve every refusal's actual layer/cause. No signal => WAITING_NATURAL_SIGNAL. Engine READY/CI does not close this gate or sustained stability.

To disable subsequent Entry writes while keeping Engine/TP services alive, atomically replace the approval with revoked=true or remove the file. Receipt is reread before admission/submission. Already-in-flight network actions or an existing submitted order cannot be retroactively cancelled by revocation; their existing lifecycle/idempotency and TP protections continue. Never clear SQLite or mutate historical UNKNOWN. Another code rollback/restart requires its own lifecycle authorization; do not silently perform a second switch if the first fails.
