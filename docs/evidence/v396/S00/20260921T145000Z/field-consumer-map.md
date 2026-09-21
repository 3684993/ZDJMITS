# S00 field consumer map (initial)

| Field | Current source / consumer | Current default | V396 rule / phase |
|---|---|---:|---|
| `humanHandoffAfterMinutes` | `settings.ts`; position lifecycle/human managed services | 1440 | Deadline is a separate ownership boundary; S02/S08 |
| `lossHandoffBars` | `lossHandoff.ts` | 4 | Deterministic handoff signal; S02/S03 |
| `takeProfit.minNetProfitUsd` | `settings.ts`, `economicEntryFeasibility.ts`, `tpGuardian.ts` | 1 USDT-labelled setting; currency must be explicit in V396 | Do not treat as proof of V396 exit threshold; S03/S06 |
| `takeProfit.minNetProfitRoiPct` | economic admission and TP economics | 0.15 | Preserve fee/slippage/buffer provenance; S03 |
| `tradeEconomics.admissionMode` | pre-AI envelope and entry economic feasibility | SHADOW | V396 feature states are `OFF/SHADOW/TESTNET_ENFORCE`; S00 only specifies |
| `riskGovernance.protectionMode` | settings/runtime control and TP protection | SHADOW | Protection maintenance remains independent of AI ownership; S02/S04 |
| `ai.secondBrainReview` | settings schema and AI orchestration | OFF | Default remains OFF; S07 may consume frozen interface |
| `directionReference` / direction preferences | settings and entry policy consumers | DEFAULT / mixed preference defaults | V396 must distinguish model output, capacity and policy filtering; S01/S06 |
| `executionMode` + exchange environment | `BinanceTransport`, `ExternalTradeAdapter`, API resource write gate | READ_ONLY + TESTNET | No new V396 path may bypass existing environment/egress gates; I07/I10 |
| `positionSide` / `ExecutionScope` | exchange adapters and runtime position/order keys | one-way may be `BOTH`; hedge uses LONG/SHORT | V396 canonical scope is `environment/account/symbol/positionSide`; S00-T05 |
