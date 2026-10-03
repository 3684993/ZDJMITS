# V3.9.7 final system closeout — INCOMPLETE

Captured 2026-10-03 Asia/Shanghai. This is an evidence checkpoint, not runtime acceptance. The Engine is stopped, so current Engine-to-GPU2 Review, Web readback, runtime identity, and live recovery are unverified. No `main` promotion is authorized by this report.

## Current identity and lifecycle

- Source base: `221e7cd50d876d33d12570746ffbb765223cc68a`; the implementation is in isolated branch `codex/v397-final-system-closeout-20261003` and is not deployed.
- Last Engine identity file names PID 9548, instance `60a0f6b3-0e38-4d98-a5b2-131c726d50fe`, build `3.9.6-feeda074d7c07d4a307c`. These are historical, not current. No process listens on 8080.
- The detached host logged PID 9548 exiting at 2026-10-03 03:59:17 local with code `-1073740791` (`0xC0000409`). Windows recorded insufficient memory resources for Error Reporting at the same time, and Codex app processes crashed. **STRONG_EVIDENCE:** host commit pressure contributed to the incident. **UNKNOWN:** the exact native Node failure and whether VPN loss contributed. No Engine lifecycle action was taken in this audit.
- Current public TESTNET `/fapi/v1/time` responds through configured SOCKS proxy `127.0.0.1:20081`. This proves a network route, not private Engine readiness.

## TESTNET truth at 2026-10-03 08:44 local

A temporary database copy supplied the existing TESTNET credentials to the product adapter. Two signed GETs queried `demo-fapi.binance.com` (`openOrders`, `positionRisk`); exchange writes: **0**.

| Fact | Current readback |
|---|---:|
| Remote open Entry | 0 |
| Remote open TP, all matched to local TP identities | 13 |
| Remote open manual or unmatched orders | 0 |
| Remote nonzero physical positions | 13 |
| Local Entry rows | 1,826 total; 1 UNKNOWN; 0 active |
| Local TP rows | 1,034 total; 13 WORKING |
| Local manual rows | 42 total; 1 UNKNOWN; 0 active |

The old report's 15 active Entry is false as a current-state claim. The Engine's Web `/orders` projection cannot be checked while 8080 is stopped. The two historical UNKNOWN rows remain audit facts and were not rewritten.

## GPU2 and Review

- GPU2 HARNESS_ADVISOR is now PID 26524, watchdog 14900, physical Vulkan1, endpoint `127.0.0.1:8083/v1`, model `qwen/qwen3.8-27b`, context 16,384, health `ok`. GPU1 Primary PID 43468 remains on Vulkan2 and 8084. Scout remains at 8081. The HARNESS_ADVISOR script was backed up before one authorized restart; only its context was reduced from 65,536 to 16,384. Host committed memory fell from approximately 125.1 GB to 122.4 GB against a 126.7 GB limit.
- Settings version 243 maps `SCOUT_RESEARCH → scout-b580`, `ENTRY_PRIMARY → brain-7900-primary`, and both `PENDING_ENTRY_REVIEW` and `POSITION_REVIEW → review-7900-gpu2`. This is persisted routing, not proof of a current Engine request.
- Prior `totalRuns=0` counted successful runs only. The archive contains **two actual Engine → GPU2 Pending Entry Review model requests**, each with about 5.4k input tokens and exactly 600 output tokens; both failed with `AI_OUTPUT_INVALID: output token limit reached` under the harness's 4,096-token reasoning budget. The isolated code now sends `chat_template_kwargs.enable_thinking=false` for Review only. A replay of the archived real input through the restarted 8083 endpoint returned schema-valid `KEEP` with exact order identity, `finish_reason=stop`, 5,428 input / 209 output tokens in 12.8 seconds. This replay took no Engine or exchange action and is not a current-order acceptance sample.
- Seventeen durable Position Review budgets held 32 failures. All 32 matching historical JSONL events (including compressed archives) state `PRE_AI_EXECUTION_ENVELOPE_MISSING`; no Position Review model run exists in the archive. A full consistent SQLite backup was created at `D:\MITS\data\backups\v397-final-closeout-20261003\zdj-settings-before-review-budget-rebase.sqlite`. The stopped TESTNET database was rebaselined to zero failures for those 17 budgets, retaining old verdicts/usage, one provenance marker per budget, and 17 audit events. Both backup and modified database passed `PRAGMA integrity_check`; a future restart must verify hydration and actual scheduler progress.
- The scheduler now archives the known pre-inference envelope defect without counting it against the model failure budget; endpoint and model errors still count. No current Position Review verdict has been obtained or persisted.

## Exit and economics

- Retained SQLite contains 426 `AI_EXIT_FACTS_INCOMPLETE` events: all cite `FUNDING_ATTRIBUTION_UNKNOWN`, 408 cite `EXIT_DEPTH_INSUFFICIENT`, and 136 additionally cite `EXIT_DEPTH_UNPROVEN:NO_BID_AT_OR_ABOVE_BOUND`. These are historical event counts, not a current live tally. No missing fact was fabricated.
- Persisted Settings retain minimum USDT/USDC order notional 200 each, minimum initial margin 1 each, TP minimum net profit 1, minimum net ROI 0.15%, entry fee assumption 0.0004, 10% fee buffer, and TAKER exit assumption. Current settings alone do not prove a new post-deploy Entry/TP execution chain.
- The last instance logged `ENTRY_ORDER_TTL_CLOSED` for an exact identity after verified remote absence, with `ONE_HOUR_HARD_TTL` and no exchange write. A current one-hour live sample remains unverified.

## Gates and remaining work

- `npm run verify` ultimately passed on the isolated source after test workers were bounded to four and the Dashboard Settings mock was updated: Engine 192 files / 1,668 tests, Dashboard 22 files / 114 tests. Typecheck, build, and script checks passed. `git diff --check` passed. Hosted CI was not run.
- S00 static check is **FAILED** against its September baseline: the committed `config/settings.default.json` hash is `b318ac62...`, while S00's historical manifest expects `aa6319d8...`. The baseline artifact was not rewritten to manufacture a pass. New audit tools were kept below this report rather than added to the S00 entrypoint set.
- Runtime build identity closure 6/6, current `/health`, Web AI resource page, Web Orders page, scheduler considered/due/reserved/completed, current `AI_EXIT_FACTS_INCOMPLETE`, and Engine-origin GPU2 structured Review remain **UNKNOWN** until the Engine is manually launched and read back. Production writes by this audit: **0**. No claim is made about cumulative runtime writes after the old instance stopped.
- Repository `AGENTS.md` requires an explicit instruction for a particular Engine lifecycle action. A request to authorize one `scripts/start-zdj-lan.ps1` manual TESTNET launch is pending. This report must remain **INCOMPLETE** until that action, runtime verification, and the remaining closure gates are resolved. Do not fast-forward or push `main` on this evidence alone.
