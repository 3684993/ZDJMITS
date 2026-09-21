# S00 isolation boundary and command classification

This is a boundary specification, not a claim that every existing repository script is safe to execute.

## Allowed in S00

- `node scripts/v396-s00-static-check.mjs`: reads source and evidence, writes one fixture copy below an OS temporary directory, and proves its own capability limit by checking its import list, rejecting process and network capability tokens in its own source, and requiring each write call site to name the temporary directory.
- `node scripts/v396-s00-build-entry-review.mjs`: regenerates the entrypoint review from the rule table. It is not part of the S00 verification command and writes only that evidence file.
- `git diff --check`, `node --check`, and JSON parsing of the evidence files.

## How the classification is produced

`scripts/v396-s00-isolation-rules.mjs` holds the only rule table: indicator patterns, the indicators that force `FORBIDDEN_OR_NOT_RUN`, the lifecycle naming rule, the single allowed static entrypoint and the required boundary text per indicator. `entrypoint-review.json` is generated from it, and the verifier re-derives every entry from the current tree and rejects a byte-level mismatch.

The scan is a conservative over-approximation. A keyword match can only push an entry to a stricter status, so an entry cannot be made runnable by deleting a label; only by changing the file itself, which changes the derived label. Reference indirection is followed one hop, so `dev = node scripts/dev.mjs` and `start-engine.ps1 -> start-zdj-lan.ps1` cannot hide a spawn behind an indirection.

## Result at this commit

107 entries: 98 forbidden, 8 boundary-eligible, and 1 executed by S00 (`ALLOWED_STATIC`, the verifier itself). Round 1 marked 19 entries boundary-eligible, twelve of them with no side effect recorded. Corrected as follows.

| Round 1 label | Actual content | Round 2 |
|---|---|---|
| `scripts/windows/start-engine.ps1` boundary-eligible, no side effects | invokes `scripts/start-zdj-lan.ps1`, the manual Engine launcher named in AGENTS | FORBIDDEN, lifecycle plus process plus data boundary |
| `scripts/windows/start-dev.ps1` boundary-eligible, no side effects | runs `npm run dev` | FORBIDDEN |
| `scripts/windows/start-dashboard.ps1` boundary-eligible, no side effects | runs `npm run dev:dashboard` | FORBIDDEN |
| `scripts/windows/verify.ps1` boundary-eligible, no side effects | runs the root aggregate `verify` | FORBIDDEN |
| `scripts/run-acceptance.ps1` boundary-eligible, no side effects | chains `acceptance-static.ps1` and a 3h endurance run against a data dir and port | FORBIDDEN |
| `scripts/v393-fix-entry-wiring.mjs`, `scripts/v393-contract-cleanup.mjs` boundary-eligible, no side effects | rewrite tracked source files under `apps/` and `packages/` in place | FORBIDDEN, source-tree mutation |
| `scripts/windows/credential-manager.ps1` boundary-eligible, no side effects | P/Invoke host credential store set, get and delete | FORBIDDEN |
| `scripts/audit-node-runtime.ps1` boundary-eligible, no side effects | enumerates host processes and writes an output file below `data/runtime` | FORBIDDEN |
| `apps/engine/package.json` and `apps/dashboard/package.json` boundary-eligible | each also declares a `dev` (and for engine `start`) command | entry FORBIDDEN; `build`, `typecheck` and `test` stay boundary-eligible per command |
| `scripts/v396-s00-static-check.mjs` allowed static with `process-lifecycle` and `network-or-exchange` recorded | neither capability exists | ALLOWED_STATIC with the temp write only |

No entry was moved in the permissive direction, and nothing that starts a process, reaches a network or exchange endpoint, mutates the host or the source tree, or runs an aggregate command is presented as runnable.

## Explicitly excluded

- Every `start-*`, `stop-*`, `dev*`, guardian, endurance, acceptance, rollout, canary, smoke and installer script: they launch a process, touch runtime paths, or alter host state.
- Root `verify`, `verify:isolated`, `verify:scripts`, `test`, `build`, `typecheck` and `acceptance`: none is boundary-eligible as a unit, and `entrypoint-index.json` records which member makes each unsafe. Per-workspace `build`, `typecheck` and `test` remain available to later stages under the boundary below.
- `.github/workflows/v392-verify.yml`: a repository verification entry with write permission on repository contents, which is why it is classified rather than ignored.
- Any command that uses the repository `data` directory, port 8080, configured credentials, the Binance transport, external AI endpoints, or a real Engine entrypoint.

## Required boundary for later isolated tests

The test process must set a unique `ZDJ_DATA_DIR` under a temporary directory, a unique loopback `ZDJ_PORT`, and mock market, trade and AI adapters. The adapter must expose a write counter and throw on any unexpected network or exchange-write attempt. A test that cannot provide those controls is `NOT_RUN`, not PASS.

Measured at this commit rather than assumed: 121 Engine test files exist, 7 of them open a database or store, and all 7 use an OS temporary directory or an in-memory database. No Engine test file references the repository `data` directory or port 8080. The check that enforces this is part of the S00 verification command, so a future test that opens the live store fails S00 rather than passing quietly.
