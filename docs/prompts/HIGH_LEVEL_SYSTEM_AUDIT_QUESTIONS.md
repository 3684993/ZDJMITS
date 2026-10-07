# J-MITS V3.9.7 — HIGH-LEVEL SYSTEM AUDIT QUESTIONS

> Purpose: one-pass independent audit by a higher-capability Codex model.
> Mode: analysis/audit only.
> Repository: `3684993/ZDJMITS`
> Local root: `D:\MITS`
> Prepared against `main` observed at `ea531b5f51e717f0ead322733765f2d6de30b4cb`.
>
> This file intentionally contains questions, not conclusions.

## Audit rules

Before answering, read the current repository and the current maintenance handoff. Verify the actual current checkout, current configuration defaults, tests, runtime diagnostics, execution paths and recent commits yourself.

Do not assume that an existing test proves the real runtime behavior is correct.

Do not assume that a subsystem is faulty merely because this file asks about it.

Do not modify code, restart services, change settings, submit orders, clear state, or run destructive diagnostics in this audit.

Use read-only inspection and safe local analysis. If runtime evidence is necessary but unavailable, state exactly what evidence would be required.

For every material finding, distinguish:
- confirmed defect;
- latent reliability risk;
- trading-quality weakness;
- unnecessary conservatism / lost opportunity;
- observability blind spot;
- hypothesis requiring runtime evidence.

For each finding, identify the exact code/config/runtime evidence and explain the practical impact. Avoid generic best-practice commentary.

## 1. Overall system correctness

1. What assumptions does the current architecture make that are not actually enforced by code or tests?
2. Which important invariants are implemented in more than one place and can drift apart?
3. Which subsystem can currently report a healthy state while another dependent subsystem is actually stale, blocked or degraded?
4. Are there states where the dashboard says RUNNING/READY while the trading path is materially unable to create, manage or close trades?
5. Are there states where the system is conservative for reasons that no longer correspond to real execution risk?
6. Are there hidden global blockers caused by a local/candidate-specific problem?
7. Are there local/candidate-specific blockers incorrectly suppressed because a global subsystem appears healthy?
8. Which failure modes can survive current tests because tests mock away timing, concurrency, persistence, network or exchange behavior?
9. What important runtime behavior is not covered by an end-to-end or integration-level assertion?
10. Which recent fixes solved symptoms but may still leave a deeper architectural cause?

## 2. Entry quality

11. Does the current candidate-selection and Primary decision pipeline optimize for actual post-fee, post-slippage trading quality, or can it prefer statistically attractive but economically weak entries?
12. Which inputs have the greatest influence on entry quality, and are any of them noisy, stale, redundant or insufficiently validated?
13. Are candidate ranking, executable filtering and final Primary selection aligned to the same economic objective?
14. Can a candidate receive a high rank while its achievable maker price, spread, liquidity or short-horizon reachability makes the trade unattractive?
15. Are expected profit, fee burden, funding, spread, slippage and fill probability combined consistently throughout the pipeline?
16. Is there any double-counting or omission of costs between candidate selection, Primary reasoning, economic admission and final execution checks?
17. Does the system distinguish correctly between a good market thesis and a good executable entry?
18. Are there circumstances where the system enters too late because confirmation requirements consume the useful edge?
19. Are there circumstances where the system enters too early because the decision framework rewards direction confidence more than execution timing?
20. Are trend, volatility, order-book, microstructure and recent-trade signals used in a way that can become mutually contradictory without the system noticing?
21. Does the current system adapt entry standards to market regime, or does one threshold structure behave poorly across trending, ranging, low-volatility and high-volatility regimes?
22. Are long and short entries treated symmetrically where they should not be?
23. Are USDT and USDC markets treated equivalently where liquidity/fee/funding characteristics differ materially?
24. Which current entry filters likely improve win rate but reduce expected value or opportunity frequency too much?
25. Which current filters likely increase trade frequency but reduce expected value?
26. Which variables should be evaluated empirically from TradeRecord/history before changing any entry logic?
27. What evidence in existing trade history would falsify the current entry-quality assumptions?

## 3. Entry frequency and opportunity loss

28. Is the current entry frequency primarily constrained by genuine lack of opportunity, AI throughput, scheduler cadence, market-data gating, risk occupancy, stale UNKNOWN identities, cooldowns, candidate lifecycle or another bottleneck?
29. Which bottleneck currently dominates during normal healthy operation?
30. Are there independent candidates that are unnecessarily serialized?
31. Is Primary capacity being spent on candidates that deterministic filters could reject earlier?
32. Are useful candidates waiting because of global cooldown or resource ownership rules that could safely be candidate-scoped?
33. Are cooldown durations evidence-based or arbitrary relative to market half-life?
34. Do retry/quarantine policies suppress valid opportunities after transient AI/schema/network faults?
35. Can a stale historical UNKNOWN claim reduce practical entry frequency even when it no longer represents live exchange risk?
36. Does the current risk-occupancy model distinguish sufficiently between live risk, unresolved identity risk and historical observation?
37. Are there scheduler timing windows where a candidate can repeatedly miss its optimal entry because review/dispatch intervals are misaligned with market dynamics?
38. Is the configured candidate pool size appropriate for actual Primary throughput?
39. Is the current maximum pending-entry count economically justified relative to capital, correlation and order-management capacity?
40. Can multiple simultaneously valid opportunities be handled without increasing duplicate-order, stale-fact or reconciliation risk?
41. What is the estimated opportunity cost of current hard/soft gates, and which gate should be measured first before changing anything?

## 4. Position size and number of concurrent positions

42. Is position sizing based on a coherent risk model or mainly on available funds/leverage/limits?
43. Does sizing account for volatility, stop distance, expected adverse excursion, liquidity and correlation consistently?
44. Can the same nominal risk allocation produce materially different real risk across symbols?
45. Does the system size trades differently enough when volatility regimes change?
46. Is the maximum number of open positions scientifically related to capital, correlation and risk budget, or is it effectively a static operational limit?
47. Are portfolio limits too restrictive for low-correlation opportunities or too permissive for highly correlated opportunities?
48. Is correlation/cluster exposure measured using information sufficiently current for short-horizon futures trading?
49. Can multiple positions on different symbols still create the same underlying directional beta without being recognized?
50. Does pending-entry exposure reserve capital/risk realistically before fills occur?
51. Does partial fill handling reserve/release capital proportionally and safely?
52. Are quantity rounding, minimum notional and exchange filters capable of distorting the intended risk amount enough to matter?
53. Are small accounts or small residual balances treated in a way that creates systematic under-sizing or no-trade behavior?
54. Is there a better empirical metric than fixed position count for controlling portfolio complexity and risk?

## 5. Leverage

55. What economic objective is current leverage selection optimizing?
56. Is leverage fixed, model-selected, rule-selected or indirectly determined by margin constraints?
57. Does leverage adapt to volatility, liquidity, expected holding time and stop/exit structure?
58. Can higher leverage currently increase risk without improving capital efficiency in practice?
59. Can lower leverage unnecessarily suppress valid trades because of margin reservation rules?
60. Are liquidation distance and maintenance margin considered where necessary?
61. Is the leverage used in economic modeling guaranteed to match the leverage actually configured at the exchange before order submission?
62. Can exchange-side leverage drift from local assumptions after restart, manual intervention or symbol-level changes?
63. Are leverage-change REST calls safely bounded and verified?
64. Is there historical evidence that current leverage levels improve or harm realized risk-adjusted return?
65. Which leverage-related parameter should be estimated from actual MAE/MFE distributions rather than chosen statically?

## 6. Take-profit and exit quality

66. Is take-profit placement derived from expected edge, volatility and market structure, or primarily from fixed thresholds?
67. Is the TP distance appropriate relative to fees, funding, spread and typical short-horizon price movement?
68. Does the system distinguish between a high-probability small TP and a lower-probability large TP using expected value rather than raw profit target?
69. Are TP levels adapted after partial fills, average entry changes or changing position size?
70. Does the current TP logic handle different volatility regimes without becoming either unreachable or economically trivial?
71. Can TP orders remain technically protected while being economically poor?
72. Are there situations where a position should be exited or repriced before TP because the original thesis has invalidated?
73. Does Review/Primary/exit logic have enough authority separation to avoid turning advisory AI output into unsafe deterministic action?
74. Is there any path where exit review latency can materially increase realized loss?
75. Are maker/taker assumptions in exit economics consistent with actual order behavior?
76. Does the system measure realized execution quality of TP orders versus intended economics?
77. Are missed TP opportunities or near-miss reversals visible in current telemetry?
78. Does trade history suggest TP should be symbol-specific, regime-specific or horizon-specific?
79. Is the current minimum net-profit requirement statistically compatible with observed win rate and holding time?

## 7. Loss control and asymmetric outcomes

80. What is the real maximum loss mechanism for an Entry if no explicit stop-loss is used?
81. Is downside bounded by a deterministic rule, AI review, time-based exit, liquidation distance or another mechanism?
82. Are expected loss assumptions in the entry model consistent with actual worst adverse excursions?
83. Can a trade with small expected profit remain open long enough to accumulate disproportionately large downside?
84. Are time-to-live and exit timing scientifically related to the original forecast horizon?
85. Does the system learn anything from trades that were directionally correct but executed at a poor price?
86. Does it distinguish strategy error, timing error, execution error and market-regime error in postmortem data?
87. Which loss-control parameter most strongly affects expected value and should be validated from historical outcomes first?

## 8. Binance REST / WebSocket architecture

88. For every market/private fact used by the trading path, is the preferred source (market WS, user-data WS, REST, cache) appropriate?
89. Are any facts still polled by REST even though an authoritative fresh WS source already exists?
90. Are any critical facts trusted from WS without sufficient sequence/freshness/identity validation?
91. Can REST fallback overwrite newer WS truth with an older snapshot?
92. Can WS reconnect/replay ordering cause state regression?
93. Are event timestamps, exchange update times and local receive times distinguished correctly?
94. Is clock skew handled consistently for signed requests and freshness judgments?
95. Are all Binance REST endpoints classified correctly as critical, recovery, advisory or historical?
96. Can an advisory endpoint still indirectly block entry via a derived readiness object?
97. Are request weights and endpoint-specific limits represented accurately enough for normal latency and burst recovery?
98. Can retry behavior create synchronized bursts after network recovery?
99. Are Retry-After and exchange ban windows respected across all callers?
100. Are transport timeout, admission timeout, queue timeout and exchange processing timeout distinguishable in telemetry?
101. Can one physical timeout still appear as multiple incidents/counters elsewhere in the system?
102. Are exact-order queries deduplicated across all callers, processes and timing windows where they need to be?
103. Is a 15-second ABSENT cache appropriate for every exact-order recovery context, or are there contexts with different correctness requirements?
104. Can Binance return states that current order-status mapping mishandles?
105. Are partial fills and userTrades retrieval robust to REST lag after exact-order truth?
106. Can user-data WS temporarily miss an event without the system detecting the gap?
107. Is listen-key lifecycle/reconnect behavior sufficient under long-running operation?
108. Can private WS reconnect produce a period where the account looks READY while order state is incomplete?
109. Is market WS continuity validation strong enough for kline/depth streams under reconnect?
110. Are depth/book facts locally consistent enough for maker-price calculations?
111. Which Binance communication path is currently most likely to become a hidden latency amplifier?

## 9. Network and proxy behavior

112. Is proxy health evaluated by real Binance route behavior or by generic connectivity?
113. Can a proxy remain marked ACTIVE while its Binance latency/error profile has degraded materially?
114. Is active-proxy hot switching race-safe for in-flight REST and WS connections?
115. What happens to existing WS sessions after active proxy changes?
116. Can different subsystems temporarily use different proxy generations/configurations?
117. Is DNS resolution behavior consistent with the intended SOCKS5H semantics?
118. Are proxy test results representative of the actual signed/private/write path?
119. Could normal Singapore-route latency still trigger any false operational gate not covered by current tests?
120. Is there enough telemetry to distinguish exchange slowness, proxy slowness, local queue pressure and local CPU/event-loop delay?

## 10. Scheduler, concurrency and backpressure

121. Which scheduled job has the highest worst-case duration relative to its interval?
122. Can any recurring task overlap with itself?
123. Are overlapping tasks prevented by one global mutex where a narrower lock would be safer/faster?
124. Can one slow reconciliation/audit task starve market processing, order management or AI dispatch?
125. Are all async fire-and-forget tasks bounded and observable?
126. Can rejected promises disappear without affecting health state?
127. Are queues bounded by count, time and memory?
128. Can AI queue backlog create stale decisions that are still accepted later?
129. Is model capacity reservation fair between live Entry work and advisory Review/Research work?
130. Can Review/Research consume CPU, memory, network or event-loop capacity even when GPU resources are separate?
131. Are long synchronous SQLite or serialization operations possible on latency-sensitive paths?
132. Does the system have any unbounded Map/array/cache keyed by symbols/orders/events that can grow indefinitely?
133. Are cleanup policies correct after restart and long uptime?
134. What concurrency bug is most likely to escape current deterministic tests?

## 11. Reconciliation and historical UNKNOWN risk

135. What exact conditions keep reconciliation DEGRADED today?
136. Which historical UNKNOWN claims are genuinely unresolved exchange risk versus durable historical uncertainty?
137. Can current reconciliation ever prove old UNKNOWN identities safe without unbounded historical REST work?
138. Is remote-audit budgeting sufficient to make progress over time, or can deferred items starve forever?
139. Can one permanently unprovable historical row keep a global degraded state indefinitely?
140. Does DEGRADED have any current effect on Entry, operator behavior or resource usage?
141. Is there a distinction between "historical unresolved evidence" and "current unsafe execution state" everywhere it matters?
142. Can risk-bearing UNKNOWN rows ever be released without authoritative evidence?
143. Can authoritative no-risk evidence expire too quickly or too slowly?
144. Are reconciliation proofs durable across restart?
145. Is there a safe convergence strategy for historical UNKNOWN that does not delete history or fabricate certainty?
146. Which metrics would show whether reconciliation is actually converging during a 24-hour run?

## 12. SQLite, persistence and storage

147. Which writes occur on the hottest runtime paths?
148. Can SQLite locking/blocking delay trading-sensitive tasks?
149. Are transaction boundaries correct for order identity, reservation, position and provenance updates?
150. Can a crash between two durable writes create an impossible but recoverable state?
151. Which state transitions are not atomic but should be?
152. Are WAL checkpoint/retention policies safe under sustained write load?
153. Could bounded logs still fill disk faster than cleanup under an abnormal loop?
154. Are low-disk protections early enough to preserve SQLite integrity?
155. Can failed telemetry/log writes still cascade into runtime instability?
156. Are there durable records whose schema evolution can silently reinterpret old data?
157. Is startup migration safe with large real historical data?
158. Which persistence path is most likely to contribute to a native crash or process memory pressure?

## 13. Native/process stability

159. Which remaining code paths invoke native Node/SQLite/WebSocket/crypto/compression functionality heavily enough to be plausible contributors to process-level failure?
160. Is there any evidence of memory growth over long uptime that unit tests cannot reveal?
161. Are buffers, sockets, timers, event listeners and intervals always released on reconnect/reload/shutdown?
162. Can repeated WS reconnects leak listeners or sockets?
163. Can repeated AI requests leak request state or large prompt/result objects?
164. Can reconciliation retain large remote result sets longer than necessary?
165. Are foreground observation logs sufficient to identify the last successful subsystem before a future native crash?
166. Are health checks sensitive to event-loop stalls, memory pressure and scheduler lag, or only logical subsystem states?
167. What 6-hour, 12-hour and 24-hour runtime metrics should be compared to detect gradual degradation before a crash?

## 14. AI decision architecture

168. Is Primary provided with the minimum sufficient facts, or is prompt context unnecessarily large/noisy?
169. Are any important execution/economic facts omitted from Primary input?
170. Can stale facts remain in a Primary packet after newer market state arrives?
171. Is the frozen-candidate snapshot internally time-consistent?
172. Does Primary output schema allow ambiguous decisions that deterministic code interprets incorrectly?
173. Are model confidence values used as if they were calibrated probabilities?
174. Has confidence calibration ever been validated against realized outcomes?
175. Can prompt wording systematically bias toward PLACE, WAIT or REJECT?
176. Are there duplicated instructions that reduce model compliance or consume context without adding information?
177. Does Primary see enough counter-evidence to avoid confirmation bias?
178. Does Review add unique information or mostly repeat Primary reasoning?
179. Is Research fed into decisions at a horizon compatible with this trading system?
180. Can external-event research become stale before it is consumed?
181. Are model failures/circuit-breakers/cooldowns tuned to actual model latency and reliability?
182. Can model-side variability reduce reproducibility enough to complicate postmortem analysis?
183. Which parts of trading quality are currently delegated to AI but could be measured deterministically?
184. Which deterministic thresholds are currently hard-coded but would be better treated as empirically calibrated priors?

## 15. Review / Research resource utilization

185. Are Review and Research doing work that changes measurable post-trade or risk outcomes?
186. Is their utilization low because there is genuinely no useful work or because routing/scheduling is too restrictive?
187. Are there bounded asynchronous tasks that could increase decision quality without becoming Entry vetoes?
188. Is pending-entry review early enough to be useful but late enough to avoid noise?
189. Does position review occur at intervals compatible with actual position horizons?
190. Can Review identify deteriorating execution quality before deterministic rules notice?
191. Does Research have clear freshness/TTL semantics?
192. Are AI resource queues and latency visible enough to distinguish idle from blocked?
193. Can Review/Research failures ever indirectly suppress Primary throughput?
194. Is GPU/model resource assignment optimal for task complexity, latency and context size?

## 16. Economic model validity

195. Are expected net profit calculations dimensionally and economically correct across all quote assets and leverage levels?
196. Are fees modeled using the actual maker/taker path likely for each order type?
197. Is funding relevant at the actual holding horizons, and if so is it modeled consistently?
198. Is slippage modeled where a maker order may become a taker or require repricing?
199. Is fill probability explicitly modeled or only implied by reachability?
200. Is reachability calibrated against actual filled/not-filled historical entries?
201. Are opportunity cost and queue waiting time part of the economic decision?
202. Can a trade with positive modeled expected value still be inferior to WAIT because capital is scarce?
203. Does the system compare simultaneous candidate expected values on a common risk-adjusted basis?
204. Are expected profit and risk estimates calibrated per symbol/regime or globally?
205. What historical sample size is needed before changing any threshold scientifically?
206. Which parameters can be estimated from existing data now, and which currently lack enough observations?
207. Are backfilled/historical metrics subject to selection bias because only executed trades are observed?
208. Does the system record rejected/waited candidate outcomes well enough to estimate missed-opportunity cost?
209. Can the current data distinguish whether low profitability comes from selection, entry timing, sizing, leverage, TP, exits or execution friction?

## 17. Metrics and observability

210. Which key business outcome is currently impossible to calculate from stored data?
211. Can the system compute per-entry expected-vs-realized edge?
212. Can it compute fill latency and fill probability by symbol, volatility and distance from market?
213. Can it compute maker/taker realization rate?
214. Can it compute MAE/MFE for each position?
215. Can it compute expected-vs-realized holding horizon?
216. Can it compute TP reach probability and time-to-TP?
217. Can it compute opportunity loss from WAIT/REJECT decisions?
218. Can it attribute a losing trade to model selection, market regime, execution or exit?
219. Are operational incidents correlated with trading outcomes?
220. Are AI latency and network latency correlated with missed entries?
221. Can the dashboard expose enough truth to diagnose low entry frequency without reading logs?
222. Which five metrics would most improve future scientific tuning of entry frequency, leverage, size and TP?
223. Which existing metrics are easy to misinterpret or currently lack a clear denominator?

## 18. Tests versus reality

224. Which high-value behaviors are only unit-tested with mocks?
225. Which tests assert implementation details rather than economic/runtime invariants?
226. Which tests could stay green while a real Binance behavior changes?
227. Which tests could stay green while a long-running memory/resource leak exists?
228. Which tests could stay green while scheduler latency grows from seconds to minutes?
229. Which tests could stay green while trade frequency collapses?
230. Which tests could stay green while trading quality deteriorates?
231. Which tests rely on synthetic market data that is too clean compared with Binance reality?
232. What read-only shadow/replay tests would expose hidden issues without submitting orders?
233. What production-like TESTNET experiment would have the highest information value with the lowest execution risk?

## 19. Parameter science

234. Which current thresholds appear to be engineering defaults rather than empirically calibrated trading parameters?
235. Which parameters interact strongly enough that tuning them one at a time would be misleading?
236. Which parameters should be symbol-specific?
237. Which should be volatility/regime-specific?
238. Which should be account-size-specific?
239. Which should remain global invariants?
240. Are current entry frequency, leverage, position count and TP settings jointly coherent?
241. Could increasing trade frequency lower total expected return because of fees/edge dilution?
242. Could reducing trade frequency improve expected value but underutilize capital?
243. What objective function should be used to tune the system: absolute PnL, risk-adjusted PnL, drawdown, capital efficiency, hit rate, expected log growth or another measure?
244. What constraints should be held fixed before optimizing that objective?
245. What minimum historical evidence should be required before changing a live parameter?
246. Which current parameters should not be optimized from the available sample because of overfitting risk?

## 20. Adversarial audit

247. If the system loses money while remaining technically healthy, what are the five most plausible causes?
248. If entry frequency is much lower than expected while all health checks are green, what are the five most plausible causes?
249. If entry frequency is high but realized returns are poor, what are the five most plausible causes?
250. If the Engine crashes after 8–24 hours despite passing all tests, what are the five most plausible causes?
251. If Binance communication degrades intermittently without producing incidents, where could evidence be lost?
252. If NET-002/MARKET-DATA-001 never appear again, could the system still be silently trading on stale or incomplete facts?
253. If reconciliation remains DEGRADED for days, what practical harm could occur even if live trading appears healthy?
254. What single hidden coupling currently has the highest potential to cause both lower trade quality and lower system stability?
255. What single assumption in the current design should be challenged first because it has the largest expected impact if wrong?

## Required audit output

Answer the questions by inspecting the actual current system rather than by giving generic trading advice.

Produce a prioritized audit with:
- exact finding;
- classification;
- severity;
- confidence;
- concrete repository/runtime evidence;
- likely real-world impact;
- whether the issue affects trading quality, trading frequency, execution, stability, observability or multiple areas;
- what additional evidence would confirm/refute it;
- whether action is urgent, worth measuring first, or probably not worth changing.

Separate confirmed defects from hypotheses.

Do not modify the repository during this audit.
Do not restart services.
Do not submit test orders.
Do not tune parameters before establishing evidence.
