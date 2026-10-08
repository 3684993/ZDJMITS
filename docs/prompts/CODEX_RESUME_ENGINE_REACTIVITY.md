# Resume Engine Reactivity Remediation

The checkpoint reactivity work is no longer an unverified candidate.

Authoritative current main: `ce46b71cf45b2a16eef2c83fb91242619e71a65a`.

The fix has already passed isolated local verification:
- targeted RuntimeState + SettingsStore: 44/44 PASS
- contracts: 2/2 PASS
- core: 59/59 PASS
- dashboard: 123/123 PASS
- engine: 200 files / 1821 tests PASS
- release identity, S00, typecheck and build: PASS

Do not redo the old candidate verification or SSH/SOCKS diagnosis.

Continue with:
`docs/prompts/CODEX_DEPLOY_REACTIVITY_ACCEPTANCE.md`

The immediate goal is to deploy current main to 8080 only and produce a fresh 5–10 minute before/after runtime comparison against the prior baseline:
- persistRuntime inclusive CPU ~43.28%
- TQ ~10.74%
- event-loop max ~6.14s

Use log files for long command output and commit all runtime evidence to GitHub.
