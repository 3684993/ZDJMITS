# Verification receipt

`npm ci` succeeded. Final `npm run verify` succeeded (exit 0): verify:deps, verify:scripts (Node and PowerShell), verify:release, verify:s00, workspace typecheck, full build and all workspace tests.

| Workspace | Test files | Tests |
|---|---:|---:|
| contracts | 1 | 2 |
| core | 9 | 61 |
| dashboard | 25 | 126 |
| engine | 212 | 1910 |
| Total | 247 | 2099 |

First full verification failed only the pre-existing 31,000-character prompt bound after the format explanation was added. The explanation is now concise and emitted only for non-empty encoded menus; the bound was not raised. Subsequent full verification passed, and the final delivery run includes startup/readiness separation regression tests. No test threshold or order validation was loosened.

Final log SHA256: c2f03a6e997bafff5ea5705fcc4871ab77333f279821e601283949e3322c6544

Tested candidate identity (before any lifecycle):

```json
{
  "sourceHash": "53856d74adc0241a04fac4bee7fc59cb0f7deaaac86a36b28beee0ea2e59af02",
  "artifactHash": "6cd926abca3eec24392ea4f51db845914309ceb974908be2fbfc549ed3afd169",
  "buildId": "3.9.8-6cd926abca3eec24392e",
  "entrypointSha256": "df014d7d4da78af092844fa646c3ac1409bff38ec27c35da5db3de0caf072376"
}
```

Actual Primary input replay: strict model/parser VALID PLACE_LONG; native tokens 25,784 equal actual usage; output 755. Candidate exists in supplied LONG menu; quantity null, TP restatement exact, price range valid. The archived-input test has no execution adapter and is not a natural trade acceptance.

All 43 FAILED archived inputs: lossless facts, both candidate menus retained, native budgets READY (20,800–26,560). Historical event replay: 31 READ_ONLY_NON_EXECUTABLE, zero false portfolio refusals. Genuine risk-refusal/identity/quantity/price/TP/no-add regressions remain in the full suite.

No hosted CI result is substituted for local verification or runtime acceptance. Exact-SHA remote status is recorded separately after push/PR creation.
