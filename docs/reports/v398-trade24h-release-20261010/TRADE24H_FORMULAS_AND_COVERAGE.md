# 24h economics and dashboard changes

Rolling interval `[asOf - 86400000, asOf)` uses settled CLOSED `closedAt`. Only proved local, unique physical cycles with both entry/exit orders, linked fills, CONSERVED ledger and existing economic eligibility qualify. A duplicate cycle in incomplete or outside-window retained records also quarantines the candidate. Missing conservation cannot pass. Gross profit is the sum of positive ex-funding nets; loss remains negative; net is their sum; fees are already included and never deducted twice. USDT/USDC stay native; no 1:1 USD conversion. No qualifying facts yields null, not invented zero. Formal all-in eligibility retains exact funding and authority evidence.

Initial three failed tests had invalid fixtures (hardcoded gross inconsistent with fees/net, close before open at the boundary). Fixtures were corrected without loosening gates. Regression covers unknown conservation, cross-window collisions, synchronization errors, native currencies, stale/error masking, visibility and unmount cleanup.

24h endpoint has a router-local 10s cache retaining the original asOf; no exchange requests, worker writes or automatic repair. Frontend single-flight 8s abort, 30s visible-only polling and 60s freshness masking bound requests. This cache is not a claim of full exchange history coverage.

User additions: real asset table is now the first homepage panel and exists once. Duplicate capital-admission panel removed; performance funds/profit/trend charts from PR31 preserved. AUTO quote routing now carries the selected underlying's existing positive qualification rank to an eligible funded alternative, preventing an otherwise selected USDC pair from being dropped solely because its pre-selection rank was zero. Liquidity/qualification/no-add/dedup/Primary and explicit routing policies unchanged; no forced allocation.

Offline browser QA at 1440/390 widths: no page errors or document overflow; screenshots are labelled fixtures, not live runtime. Rendering includes a fixed 600ms wait and is not a benchmark of production.
