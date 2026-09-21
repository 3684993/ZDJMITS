# Offline migration and rollback rehearsal

- S01 risk coverage fields are additive runtime facts; adapter coverage metadata is optional for compatibility, while the production external adapter emits requested start/end and `coverageComplete=true` only after its paged calls return.
- Trading-quality collector adds `tq_collector_samples` with an additive `CREATE TABLE IF NOT EXISTS`; it records scope identity, timestamp and durable event count. No existing facts are deleted or rewritten.
- No Settings schema, live SQLite, `data`, `dist`, credentials or running Engine were touched. Dependencies were installed only in this worktree with `npm install --offline --ignore-scripts --no-audit --no-fund`.
- Rollback is a code revert of `1d7d68f`; the collector table is additive and can remain unread by an older reader. No live migration or irreversible data operation was executed.
- Shared execution scope is canonicalized to environment/account/symbol/positionSide; one-way `BOTH` is not split. Quantity claims remain offline and fail closed when requested units are invalid or exceed shared available units.
