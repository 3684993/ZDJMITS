# S00 isolation boundary and command classification

This is a boundary specification, not a claim that every existing repository script is safe to execute.

## Allowed in S00

- `node scripts/v396-s00-static-check.mjs`: static reads, JSON parsing, canonical fixture hashing, and one OS temporary directory.
- `git diff --check`, `node --check scripts/v396-s00-static-check.mjs`, and evidence JSON parsing.
- Pure/mock tests only after the test command is inspected and the test sets explicit temporary data and loopback port values.

## Explicitly excluded

- `scripts/start-zdj-lan.ps1`, `scripts/start-zdj-engine-host.ps1`, all `start-*`, `dev*`, guardian, endurance, acceptance, rollout and smoke scripts: they can launch a process, touch runtime paths, or alter host state.
- Root `verify` and `verify:scripts`: they aggregate scripts with lifecycle/data side effects and are not a proof of S00 isolation.
- Any command that uses the worktree's `data` directory, port 8080, configured credentials, Binance transport, external AI endpoints, or a real Engine entrypoint.

## Required boundary for later isolated tests

The test process must set a unique `ZDJ_DATA_DIR` under a temporary directory, a unique loopback `ZDJ_PORT`, and mock market/trade/AI adapters. The adapter must expose a write counter and throw on any unexpected network or exchange-write attempt. A test that cannot provide those controls is `NOT_RUN`, not PASS.

The recursive entrypoint scan in `entrypoint-index.json` ensures every candidate startup/test/package entry is either explicitly indexed or explicitly excluded by pattern. It does not execute excluded scripts and does not authorize Engine lifecycle actions.
