# S00 isolated verification results

Round 2 (master-design audit re-verification). Round 1 results are kept in `audit-correction-20260921.md` and `audit-round-2-20260921.md` records what changed and why.

Command:

```powershell
node --check scripts/v396-s00-isolation-rules.mjs
node --check scripts/v396-s00-static-check.mjs
node scripts/v396-s00-static-check.mjs
```

Result: exit 0, no assertion failures. Identities (canonical JSON SHA-256 `295c949a0cf5b2c7c06db81db91e42fd6fd4437fe5a2f23143c09ac4a7fbab21`; delivered fixture file SHA-256 over LF-normalised text `9c2afe9bf75644f0705292ef708e3a4f7e1746d01ae92031b5644ea1f8a20332`).

| Test ID | Result | What is actually checked |
|---|---|---|
| S00-T01 | PASS | 107 entrypoints, each re-derived from current file text plus one indirection hop, compared byte-for-byte against `entrypoint-review.json`; the candidate set must match exactly, so a new script fails the run. 98 forbidden, 8 boundary-eligible, 1 executed. The verifier also proves its own capability limit (import allowlist, no process or network tokens, every write call site names the temp dir) and measures Engine test isolation: 121 test files, 7 open a store, all 7 use an OS temp dir or an in-memory database, 0 references to the repository `data` directory or port 8080. |
| S00-T02 | PASS | The delivered evidence is scanned for credential-shaped material; only the redaction declaration itself is exempt, and it contains no value. |
| S00-T03 | PASS | Five declared identities are bound to named files in `baseline-manifest.json` and recomputed: package lock, default settings, CONTRACTS, the S00 stage file, and the fixture. One-byte drift in any of them fails the run, and the identity is hashed after CRLF-to-LF normalisation because the same committed markdown had different working-tree bytes in two worktrees. |
| S00-T04 | PASS | `legacy-auto-no-plan` carries no plan and no deadline, is marked `legacy`, and expects `MANUAL_REVIEW_REQUIRED`; no fixture invents an `ownerState` outside the CONTRACTS section 4 enum. |
| S00-T05 | PASS with a recorded gap | The scope examples are canonical, and the real `executionScope` implementation and both call sites are now inventoried in `write-path-inventory.md`: today the fourth key element is `'ENTRY'` on one path and `position.side` on another, with no claim at all on the TP path. A single canonical identity is therefore an S02/S04 precondition, not an S00 achievement. |
| S00-T06 | PASS | I01-I12 each have a consumer, a phase, planned test stages and a CONTRACTS section number that exists in the file; I10 and I12 additionally name the authority outside CONTRACTS, because section 6 does not carry the Engine lifecycle rule. |

Test count: 6 passed, 0 failed, 0 skipped. Product test suites were not run: the root aggregate commands that would run them are individually forbidden, and no baseline failure is claimed.

## Fail-closed proof

A PASS that cannot fail is not evidence. Each of the following was executed and then reverted.

| Tamper | Outcome |
|---|---|
| Set `scripts/windows/start-engine.ps1` to `CONDITIONAL_NOT_RUN` directly in the review file | `entrypoint review differs from the derived classification: scripts/windows/start-engine.ps1` |
| Delete `aggregate-verification-chain` from the forbidden indicator list in the rule table | `indicator aggregate-verification-chain is not forbidden` |
| Add an unreviewed `scripts/start-audit-probe.ps1` containing `npm run dev` | `entrypoint review count 107 does not match the derived 108` |
| Append one byte to `config/settings.default.json` | `baseline identity hash no longer matches its source: settingsDefault -> config/settings.default.json` |
| Replace a fixture `ownerState` with a state outside the contract enum | `baseline identity hash no longer matches its source: fixtureFile -> .../fixtures/s00-fixtures.json` (identity binds first; the enum assertion is reachable once the hash is updated) |

Safety evidence: network `NOT_USED`; exchange writes `0`; Engine lifecycle `NOT_USED`; Settings and live data `NOT_MODIFIED`. The verification command reads files and writes one fixture copy below the OS temp directory, which it removes.
