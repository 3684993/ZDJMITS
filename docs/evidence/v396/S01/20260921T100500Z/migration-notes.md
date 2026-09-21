# S01 migration and rollback notes

- Migration version: none. The S01 change is a type-compatible projection addition; no SQLite schema, Settings payload, runtime data, or `dist` file is changed.
- `ExperienceSummary.coverage` is optional, so old readers continue to consume the existing fields. New readers can distinguish eligible canonical-net samples from closed records excluded for unknown net PnL/funding.
- Existing UNKNOWN and cycle-accounting state remains durable. The new pure projections are read-only and do not rewrite orders, fills, positions, or historical trade records.
- Rollback is a normal code revert before review/merge. No in-flight order, ownership, or database rollback is required because this worktree was not connected to a running Engine.
- The S00 whitelist, required boundaries and `write-path-inventory.md` were not relaxed.
