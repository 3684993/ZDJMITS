# S00 isolated verification results

Command:

```powershell
node scripts/v396-s00-static-check.mjs
```

Result: the static verifier completed without assertion failures. S00-T01 is now `PASS`: `entrypoint-review.json` contains an exact item-by-item review of 99 scripts/package/test-config entries; the verifier recomputes the candidate set and requires exact path equality. Fixture identity (canonical JSON SHA-256): `e28f32fc66bd0eae4df31c78c0a8d037d4b265046eb0c7b333121766afc63e00`; raw fixture file SHA-256: `9deaa02907b4334852ac2a59080d95681191e7d95a96133a1de0a87e156325df`.

| Test ID | Result | Evidence |
|---|---|---|
| S00-T01 | PASS | Exact 99-entry item-by-item review in `entrypoint-review.json`; each entry records source path, static side-effect indicators, status, and required isolation boundary. The verifier rejects missing or extra entries; no wildcard exclusion is used. |
| S00-T02 | PASS | The verifier scans delivered evidence (excluding only the redaction declaration) and rejects credential-shaped material. |
| S00-T03 | PASS | Fixture byte mutation changed SHA-256 in an OS temp directory. |
| S00-T04 | PASS | `legacy-auto-no-plan` requires `MANUAL_REVIEW_REQUIRED`; no automatic plan/deadline is supplied; versioned event fixture is present. |
| S00-T05 | PASS | One-way example uses `BOTH`; hedge example uses a directional side in the canonical scope; claim/version/time fields are explicit. |
| S00-T06 | PASS | `invariant-consumer-map.json` covers I01-I12 with consumer and responsible phase. |

Test count: 6 passed, 0 failed, 0 skipped. Baseline product tests were not run because S00's required evidence is static/isolated and the full root `verify` includes scripts with lifecycle/data side effects that are individually marked NOT_RUN. No baseline failure is claimed.

Safety evidence: network `NOT_USED`; exchange writes `0`; Engine lifecycle `NOT_USED`; Settings/live data `NOT_MODIFIED`. The verifier imports no process or network module, rejects process/network call sites in itself, and never imports or starts the Engine. It does not claim to prove unreviewed commands safe; they are explicitly NOT_RUN per `isolation-boundary.md`.
