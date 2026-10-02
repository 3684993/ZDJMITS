# 8096 reviewed source snapshot — V3.9.7

This branch is a source backup of local release commit `2a6b8647d3c8359d3235ac40a0831c18664bdbac`. It is **not a merge candidate for GitHub main**. The local release and GitHub main have independent histories; integrating changes requires a separate branch based on main and module-by-module review. Do not merge unrelated histories or overwrite main with this snapshot.

## Contents and provenance

Production source, package manifests, lockfile, default configuration, scripts, and engine operation policy were read directly from tracked Git objects. `source-manifest.json` records the original commit, Git blob, SHA-256, mode, and excluded paths. No working-tree or untracked file was copied. Runtime data, local settings/credentials/proxy definitions, databases, deployed artifacts, and private deployment/account evidence are excluded. No `.github` workflow is included; publishing this branch must not run a migration or auto-commit workflow.

Two historical regression fixtures contained account/portfolio observations. Their public versions are **synthetic derivatives**, not native inference evidence. Account balances, portfolio counts/exposures, derived margin budgets, margin-factor/leverage/location policy examples, internal identifiers, and clocks were replaced; relative time intervals, technical market facts, input encoding, and candidate menu structure are retained. Prompt hashes were recomputed for the derivatives. `public-fixture-transformations.json` lists changed field paths and transformation categories without original values or private identifier mappings. Production `.ts`/`.vue` implementation files remain exact copies of the source commit. The research instruction document uses a generic `<checkout>` path instead of the original machine-specific absolute path; this documentation-only derivative is listed in the manifest.

Default configuration is an example from the tracked commit, not the active 8096 configuration. The engine operation policy in `AGENTS.md` requires an explicit manual lifecycle instruction. The snapshot contains no authorization to start an engine, call a model, or trade.

## Verification

During snapshot preparation, contracts, core, and engine TypeScript builds passed. The sanitized prompt-replay test passed **7/7** cases; the nine directly affected engine fixture test files passed **99/99** cases. Those checks used Node 22 and an isolated dependency link farm; no engine lifecycle or live service request was made. Build artifacts and dependency links are not part of this snapshot.

Earlier verification recorded by source commit `2a6b864` in `docs/deployment/entry-optimization-first-batch-preparation-20261003.json` passed engine **2334/2334**, core **207/207**, dashboard typecheck, and **44** structured-output grammar cases. Those full checks were **not rerun as part of this publication**; the private preparation receipt is deliberately excluded. The optimization improves contract consistency and audit truth, but it does not establish higher fill frequency or profit. Its offline token comparison found an input-cost increase of roughly **6.6%**, so this snapshot must not be described as a proved latency improvement.

For an isolated checkout, install dependencies with `npm ci`, then build packages in dependency order:

```sh
npm run build -w @zdj/contracts
npm run build -w @zdj/core
npm run build -w @zdj/engine
npm run build -w @zdj/dashboard
```

The existing top-level `npm run verify` has legacy references to scripts absent from the source commit. Their names are recorded under `knownLimitations` in the manifest; therefore a complete `npm run verify` is not claimed to be reproducible from this snapshot. These omissions predate this export. Main-line integration should repair verification wiring independently rather than importing unreviewed local files.

## Scope of the latest source changes

- R2 entry decisions bind model claims and candidate references to frozen request facts.
- V4 readable candidate input keeps lossless market facts and explicit candidate fields.
- Validated oMLX usage timings and cache counts are exposed without inventing unknown metrics.
- Durable terminal AI run outcomes are reconciled without reviving completed runs.

Order authority, live settings, engine lifecycle, and the GitHub main branch are not changed by preparing this source snapshot.
