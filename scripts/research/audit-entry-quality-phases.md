# Fixed-window native Entry evidence audit

`audit-entry-quality-phases.py` is a Python standard-library offline tool. It does not import the engine or access HTTP, models, exchange endpoints, current Settings or credentials. SQLite uses `mode=ro`, `query_only=ON` and one read transaction. It only writes a report when explicitly given a new `--output` path; existing files are not overwritten. No observer or automation is created.

Existing `audit-ai-entry-quality.mjs` reports decision-episode returns over a moving day range; `audit-trading-quality-baseline.mjs` reads another research database. Neither supplies fixed end-time censoring, configuration phases or run→intent→exchange-order→unique-fill proof, so this tool does not replace those studies.

## Usage

```sh
python3 scripts/research/audit-entry-quality-phases.py \
  --db <checkout>/data/zdj-settings.sqlite \
  --start 1790863313680 --end 1790897763223 \
  --output /tmp/entry-quality-fixed-baseline.json
python3 -m unittest discover -s scripts/research -p 'test_audit_entry_quality_phases.py'
```

The example intentionally reuses the existing 8096 baseline's recorded final bounds. It does not move its cutoff or start a new observation. Supply explicit epoch milliseconds or timezone-qualified ISO timestamps; no default “now” or rolling window exists. The cohort is Primary Entry requests **started** within the inclusive window. Terminal results after the cutoff become RUNNING with no decision/failure in that window. Prior-start requests are not part of that start cohort. Retained archive coverage is not proof of complete event history.

`--json` accepts `{runs, events, intents, orders, fills, settingsChanges, configurationPhases}` instead of `--db`. Native AI-run payloads, native runtime-event payloads (dict or JSON string), native intent/order entities and canonical `executionFills` are used directly. Existing detail exports of `{runId: {run, execution}}` are accepted with completeness UNKNOWN. Existing `primary-summary.json` is deliberately marked INCOMPLETE_EVIDENCE: only its explicit place/recent rows are audited, while its precomputed totals appear separately under `reportedBaseline`; the tool never fabricates missing raw runs from totals.

## Configuration phases

An optional `--phases` file contains a list or `{configurationPhases:[...]}`:

```json
[{"id":"baseline-31","start":1790863313680,"end":1790897763224,
  "settingsVersion":31,"contractVersion":"V3.9.7","scoutMode":"SERIAL",
  "evidenceRef":"docs/deployment/entry-throughput-deployment-20261001.json"}]
```

Phase intervals are start-inclusive/end-exclusive; the audit's final endpoint is included when it exactly equals a phase endpoint. Overlapping phases or configuration assertions without `evidenceRef` fail. Do not copy this example for a new deployment: record actual config/contract/scout-mode boundaries and their receipts. Historical run contract/settings fields and settings-audit versions take precedence; disagreements become CONFLICT. No current Settings value is assigned retrospectively. Missing historical scout mode stays null without a referenced phase declaration. Requests crossing a recorded configuration boundary are separately labelled CROSS_CONFIGURATION_IN_FLIGHT and retained under their start-phase configuration; they are not mixed with clean same-configuration requests.

## Evidence interpretation

- PLACE is a decision, not an order. `ENTRY_SUBMIT_ATTEMPTED` is not an exchange acknowledgment. Current entity state updated after the cutoff cannot alone prove an order existed at the cutoff.
- A fill needs a positive quantity, exchange execution time inside the window, exchange-source provenance, unique exchange order/trade identity, symbol and unambiguous run→intent→internal-order linkage. Partial fills are deduplicated by symbol/exchangeOrderId/tradeId, then by entry intent. A filled intent is not necessarily an independent statistical strategy sample.
- `ENTRY_FILLED` event totals and execution projections without canonical fill identities never increment verified fill counts. Exit fills and older unrelated orders do not become new Entry fills merely because the symbol matches.
- Canonical fill facts can be reconciled retrospectively. The execution-time window is fixed; missing arrival/observation time remains UNKNOWN and any explicit observation after cutoff is reported. This does not claim every fact was available to the engine at the cutoff.
- Missing links, absent archive coverage and incomplete configuration remain explicit. Zero **observed** fills does not prove no trading occurred. Fees, funding, full exit cycles and strategy profitability are outside this tool's count evidence.
- This tool prepares offline acceptance evidence only. New deployment, engine lifecycle changes and any new live observation window retain their separate authorization boundaries. Do not mix old 8080 research or independent probes into an 8096 native source file.
