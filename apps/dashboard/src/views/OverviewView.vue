<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useSystemStore } from "../stores/system";
import { api } from "../api/client";
import { money } from "../format";
import Panel from "../components/Panel.vue";
import StatusBadge from "../components/StatusBadge.vue";
const s = useSystemStore(),
  pipeline = ref<any>(null),
  assets = ref<any[]>([]),riskOverridePreview=ref<any>(null),riskOverrideOpen=ref(false),riskOverrideBusy=ref(false),riskOverrideError=ref<string|null>(null),riskOverrideReason=ref('Testnet 日内风险人工复核'),
  account = () => s.snapshot?.account as any,
  control = () => pipeline.value?.runtimeControl ?? s.snapshot?.runtimeControl;
const autoMode = () =>
  pipeline.value?.entryPermission?.autoExecutionMode ?? "SHADOW_ONLY";
const entryEnabled = () =>
  pipeline.value?.entryPermission?.executionMode === 'TESTNET_ENABLED' &&
  autoMode() === "AUTO_RUNNING" &&
  control()?.mode === "RUNNING" &&
  control()?.entrySafetyMode === "AUTO";
const entryPermissionText = () =>
  pipeline.value?.analysis?.mode === 'ANALYSIS_ONLY' ? pipeline.value.analysis.text : entryEnabled()
    ? `Testnet 自动流程已启用；${pipeline.value?.noEntryReason ?? '分析与订单维护运行中'}`
    : autoMode() === "AUTO_READY"
      ? "资金可用但执行锁仍未释放；资金驱动 Testnet AUTO 正在启用"
      : autoMode() === "WEEKLY_REVIEW_PENDING"
        ? "旧验证窗口仅保留审计记录；新建仓由资金驱动模式管理"
        : `执行安全锁生效：${pipeline.value?.noEntryReason ?? autoMode()}`;
// Slot fill and new-risk headroom are different gates, and both numbers already exist on the
// Engine side. The page only reads the projected verdict; it never re-derives or guesses it.
const capacityVisibility = computed(() => pipeline.value?.capacityVisibility ?? null);
// G4: the Engine publishes the one authoritative blocker and the next action that matches it. The page
// renders that pair verbatim and labels everything else subordinate; it must not rank the same facts again.
const authoritative = computed(() => pipeline.value?.authoritativeBlocker ?? null);
const admissionReadback = computed(() => authoritative.value?.evidence?.riskAdmissionReadback ?? capacityVisibility.value?.admission ?? null);
const admissionGateLines = computed(() => (admissionReadback.value?.gates ?? authoritative.value?.evidence?.riskAdmissionGates ?? []).slice(0, 12).map((gate: any) =>
  `${gate.name} · ${gate.unit} · used ${gate.usedUsd == null ? "—" : fmt(gate.usedUsd)} / limit ${gate.limitUsd == null ? "—" : fmt(gate.limitUsd)} · headroom ${gate.maxAdditionalUsd == null ? "—" : fmt(gate.maxAdditionalUsd)} · candidate ${gate.candidateImpactUsd == null ? "—" : fmt(gate.candidateImpactUsd)} · shortfall ${(gate.candidateShortfallUsd ?? gate.shortfallUsd) == null ? "—" : fmt(gate.candidateShortfallUsd ?? gate.shortfallUsd)}`));
const authoritativeStage = computed(() => authoritative.value?.stage ?? "NOT_EVALUATED");
const authoritativeText = computed(() =>
  authoritative.value
    ? `${authoritative.value.code} · ${authoritative.value.nextAction}`
    : "Engine 尚未投影权威首因（本实例尚未完成一次管线评估）",
);
const secondaryDiagnostics = computed(() =>
  (authoritative.value?.secondary ?? []).map((row: any) => `${row.code}${row.detail ? ` · ${row.detail}` : ""}`),
);
// G3: symbols held back for their own data facts stay visible as facts about themselves.
const marketIsolation = computed(() => pipeline.value?.marketDataIsolation ?? null);
const isolatedSymbolLines = computed(() =>
  (marketIsolation.value?.isolated ?? []).map((row: any) => `${row.symbol}：${(row.reasons ?? []).join(" · ")}`),
);
// The Engine already decides whether a model call can be acted on and whether the risk profile is
// actually configured; the page renders those verdicts instead of guessing a READY of its own.
const readiness = computed(() => pipeline.value?.executionReadiness ?? null);
const riskProfile = computed(() => pipeline.value?.portfolioRiskProfile ?? null);
const riskProfileNote = () => {
  const profile = riskProfile.value;
  if (!profile) return "本实例尚未读回组合风险档案";
  if (profile.status === "READY") return `档案版本 ${profile.version ?? "—"} 已配置`;
  const missing = (profile.missingFields ?? []).join(" · ");
  return `${(profile.blockers ?? []).join(" · ") || "PROFILE_NOT_CONFIGURED"}${missing ? `；缺失字段：${missing}` : ""}`;
};
const capacityBlocked = computed(() => (pipeline.value?.authoritativeBlocker?.stage === "CAPACITY" ? capacityVisibility.value : null));
// The four Engine blocks, projected as four lines. Each one answers a different question, and the page
// never adds a number of its own: funding is money, exposure is notional, limits are policy, and the
// entry block is the only answer to "how much new Entry risk is there room for".
const fmt = (value: unknown) => money(Number(value ?? 0));
const capacityFunding = computed(() => {
  const assets = capacityVisibility.value?.funding?.quoteAssets ?? [];
  const perAsset = assets.map((row: any) => `${row.quoteAsset}：可用 ${fmt(row.availableBalanceUsd)} − 预留 ${fmt(row.reservedMarginUsd)} − 租约 ${fmt(row.executionLeaseMarginUsd)} = 可执行保证金 ${fmt(row.executableMarginUsd)}`);
  return { perAsset, totalExecutableMarginUsd: capacityVisibility.value?.funding?.totalExecutableMarginUsd ?? 0, proven: capacityVisibility.value?.funding?.proven === true };
});
const capacityEntry = computed(() => {
  const view = capacityVisibility.value;
  if (!view) return null;
  const admission=view.admission??{},blocked=admission.status==='UNAVAILABLE'||admission.exhausted===true;
  // Which authority produced the number the side line shows. The page never picks the bigger of two
  // numbers: a BOOK ceiling is named as such, a funds-only run says the risk side is not applicable
  // and the funding fact is what binds, and an unavailable book stays PRE-RISK.
  const ceilingOf = (name: 'LONG' | 'SHORT') => admission.ceilingUsdBySide?.[name] ?? null;
  const sourceOf = (name: 'LONG' | 'SHORT') => blocked
    ? "PRE-RISK / NOT EXECUTABLE"
    : ceilingOf(name) !== null ? "来源 风险权威上限（BOOK admission）"
      : admission.status === 'NOT_APPLICABLE' ? "来源 资金与交易所事实（风险侧 NOT_APPLICABLE）"
        : `来源 资金与交易所事实（风险权威 ${admission.status ?? 'NOT_EVALUATED'}）`;
  const side = (name: 'LONG' | 'SHORT') => {
    const row = view.entryCapacity?.[name] ?? {};
    const route = row.symbol && row.quoteAsset ? ` via ${row.symbol}/${row.quoteAsset}` : "";
    const amount = blocked || ceilingOf(name) === null ? row.executableNotionalUsd : ceilingOf(name);
    return `${name} ${blocked ? "候选估算" : "可执行新增名义"} ${fmt(amount)}${route} · 首因 ${row.firstBindingConstraint ?? "NOT_EVALUATED"} · ${sourceOf(name)}`;
  };
  const finalStatus=admission.status??'NOT_EVALUATED',finalLine=blocked
    ? `权威最终 Entry 容量：LONG $0.00 / ${finalStatus}；SHORT $0.00 / ${finalStatus} · ${admission.code??admission.detail??'BOOK admission unavailable'}`
    : ceilingOf('LONG') === null && ceilingOf('SHORT') === null
      ? `权威最终 Entry 容量：风险权威未给出上限（${finalStatus}），两侧由资金与交易所事实决定：LONG ${fmt(view.entryCapacity?.LONG?.executableNotionalUsd)} / SHORT ${fmt(view.entryCapacity?.SHORT?.executableNotionalUsd)}`
      : `权威最终 Entry 容量：LONG ${fmt(ceilingOf('LONG') ?? view.entryCapacity?.LONG?.executableNotionalUsd)} / ${finalStatus}；SHORT ${fmt(ceilingOf('SHORT') ?? view.entryCapacity?.SHORT?.executableNotionalUsd)} / ${finalStatus}`;
  return { LONG: side('LONG'), SHORT: side('SHORT'), finalLine, constraint: view.entryCapacity?.LONG?.firstBindingConstraint ?? view.entryCapacity?.SHORT?.firstBindingConstraint ?? "NOT_EVALUATED" };
});
// Which balances the Engine counted as Entry funding, read back from its ledger rather than re-listed here.
const entryFundingAssets = computed(() => new Set((capacityVisibility.value?.funding?.quoteAssets ?? []).map((row: any) => String(row.quoteAsset).toUpperCase())));
const excludedEntryFunding = computed(() => (capacityVisibility.value?.funding?.excludedAssets ?? []).map((row: any) => `${row.asset}（估值 ${fmt(row.usdValue)}）`));
const capacitySides = ['LONG', 'SHORT'] as const;
// The sizing layer's own binding capacity, verbatim from the Engine trace: which ceiling, how much of it
// is already used, and what room is left. A zero on one side has to read as these three numbers.
const capacityRoomText = (row: any) => {
  const room = row?.plan?.capacityRoom;
  if (!room) return "";
  // A ceiling the Engine did not prove stays unnamed: no number is substituted for it.
  if (room.ceilingUsd == null) return `｜容量上限未提供（来自 ${room.source}）`;
  // Whether this room may veto at all is part of the fact, so an observational room is never read
  // as a rejection.
  const disposition = room.enforced === undefined ? "" : room.enforced ? " · ENFORCE 可否决" : " · OBSERVE 仅展示不否决";
  return `｜容量上限 ${fmt(room.ceilingUsd)}（已用 ${fmt(room.usedUsd)}，剩余 ${fmt(room.roomUsd)}）来自 ${room.source}${disposition}`;
};
const sideCandidateRows = (side: 'LONG' | 'SHORT') =>
  (capacityVisibility.value?.entryCapacity?.[side]?.candidates ?? []).map((row: any) =>
    `${row.symbol} ${row.side}：资金容量 ${fmt(row.funding?.executableNotionalUsd)}｜风险后 ${fmt(row.finalNotionalBeforeRoundingUsd)}｜交易所最小合法名义 ${row.minimumLegalNotionalUsd == null ? "未验证" : fmt(row.minimumLegalNotionalUsd)}｜计划 ${row.plan?.admission ?? "未生成"}${capacityRoomText(row)}｜${row.executable ? "可执行" : `首因 ${row.firstBindingConstraint}`}`);
const capacitySideStatusText = computed(() => capacityVisibility.value?.sideStatus?.text ?? "Engine 尚未投影两侧状态");

// P7: an active commission is only live when the exchange says so. These four numbers answer four
// different questions and are never summed into one "活动委托" figure; a local UNKNOWN row is an
// accounting exposure, not an order the exchange is working.
const truth = computed(() => (s.snapshot as any)?.executionTruth ?? null);
const commissions = computed(() => truth.value?.activeCommissions ?? null);
const COMMISSION_ROWS: Array<[string, string, string]> = [
  ["remoteConfirmedEntry", "交易所确认 · 建仓委托", "交易所在 open orders / exact order 中确认仍存活"],
  ["remoteConfirmedTakeProfit", "交易所确认 · 止盈委托", "交易所确认仍存活的 reduce-only 止盈委托"],
  ["manual", "人工委托", "人工控制台提交且仍未进入终态的委托"],
  ["localUnresolvedUnknown", "本地未决 UNKNOWN", "账面敞口：交易所并未确认其存活"],
];
const commissionRows = computed(() =>
  COMMISSION_ROWS.map(([key, label, hint]) => ({ key, label, hint, count: key==='remoteConfirmedEntry'&&pipeline.value?.pendingEntries?.status==='READY'?Number(pipeline.value.pendingEntries.count):Number(commissions.value?.[key] ?? 0) })),
);
// An older Engine does not project executionTruth: show its two numbers, labelled as unclassified
// instead of pretending the split exists.
const legacyActiveOrders = computed(() => ({
  entry: account()?.activeEntryOrders ?? account()?.pendingEntries ?? null,
  tp: account()?.activeTpOrders ?? null,
}));

const STATUS_LABELS: Record<string, string> = {
  HEALTHY: "健康",
  DEGRADED: "降级",
  OFFLINE: "离线",
  UNKNOWN: "未知",
  PARTIAL: "部分覆盖",
  DISABLED: "未启用",
};
const statusLabel = (value: string) => STATUS_LABELS[String(value ?? "").toUpperCase()] ?? "未知";

// Eight separate checks. None of them may stand in for another one, and a missing projection renders as
// unknown rather than inheriting a settled/healthy impression from elsewhere on the page.
const TRUTH_CHECKS: Array<{ key: string; label: string; question: string }> = [
  { key: "exchangeIngestion", label: "交易所数据摄取", question: "行情与私有数据是否真的在进来" },
  { key: "orderTerminalParity", label: "订单终态一致性", question: "本地订单终态与交易所是否逐单一致" },
  { key: "exitClaimConvergence", label: "退出声明收敛", question: "退出意图是否被持续轮询并释放" },
  { key: "takeProfitCoverage", label: "止盈覆盖", question: "每个应受保护的持仓是否真的有 TP" },
  { key: "positionCoverage", label: "持仓覆盖", question: "本地持仓集合与交易所是否一致" },
  { key: "fillCycleConservation", label: "成交周期守恒", question: "成交是否都归入周期且不重复计数" },
  { key: "fundingCoverage", label: "资金费覆盖", question: "已平仓交易的资金费是否都已确认" },
  { key: "reviewAuthority", label: "复核授权", question: "周期复核是否被授权并在运行" },
];
const msText = (value: unknown) => {
  const ms = Math.max(0, Number(value ?? 0));
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.floor(ms / 1000)} 秒`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`;
};
const checkFacts = (key: string, row: any): Array<[string, string]> => {
  if (!row) return [];
  if (key === "orderTerminalParity") return [["当前订单终态不一致", String(row.mismatchCount ?? 0)],["最近扫描差异",String(row.scanDriftCount??'—')],["混合风险声明（另项）",String(row.mixedRiskClaimCount??'—')]];
  if (key === "exitClaimConvergence")
    return [["未收敛任务", String(row.openTasks ?? 0)], ["终态未释放", String(row.terminalUnreleasedClaims ?? 0)], ["最久未轮询", msText(row.oldestUnpolledAgeMs)]];
  if (key === "takeProfitCoverage")
    return [["需要", String(row.required ?? 0)], ["已保护", String(row.protected ?? 0)], ["缺失", String(row.missing ?? 0)], ["仓位事实未决", String(row.unresolved ?? 0)]];
  if (key === "positionCoverage") return [["本地持仓", String(row.local ?? 0)], ["交易所持仓", String(row.remote ?? 0)]];
  if (key === "fillCycleConservation") return [["账本不一致", String(row.ledgerInconsistent ?? 0)], ["不守恒", String(row.unconserved ?? 0)], ["守恒", `${String(row.conserved ?? 0)}（含在持仓 ${String(row.openConserved ?? 0)}）`], ["未证明", String(row.unproven ?? 0)]];
  if (key === "fundingCoverage")
    return [["周期资金费归因精确", String(row.recordsWithExactFunding ?? 0)], ["周期归因未知", String(row.recordsUnknown ?? 0)], ["交易所资金费流水", String(row.incomeRows ?? 0)], ["交易所查询时间窗口完整", row.coverageComplete ? "是（不代表周期归因完整）" : "否"]];
  if (key === "reviewAuthority")
    return [["已启用", row.enabled ? "是" : "否"], ["AI 活跃周期", String(row.aiActiveCycles ?? 0)], ["待复核", String(row.scheduledDue ?? 0)], ["最近结果", row.lastOutcome ?? "—"]];
  return [];
};
const truthChecks = computed(() =>
  TRUTH_CHECKS.map(({ key, label, question }) => {
    const row: any = truth.value?.[key] ?? null;
    return {
      key,
      label,
      question,
      status: String(row?.status ?? "UNKNOWN"),
      detail: row?.detail ?? (truth.value ? null : "EXECUTION_TRUTH_NOT_PROJECTED"),
      facts: checkFacts(key, row),
    };
  }),
);
const convergence = computed(() => (s.snapshot as any)?.exitConvergence ?? null);
const convergenceFacts = computed<Array<[string, string, string]>>(() => {
  const row: any = convergence.value;
  if (!row?.available) return [];
  return [
    ["openTasks", "排队中的退出任务", String(row.openTasks ?? 0)],
    ["oldestUnpolledAgeMs", "最久未轮询", msText(row.oldestUnpolledAgeMs)],
    ["terminalUnreleasedClaims", "终态未释放声明", String(row.terminalUnreleasedClaims ?? 0)],
    ["maxServiceIntervalMs", "最大服务间隔阈值", msText(row.maxServiceIntervalMs)],
  ];
});
// Raw exchange fills by provenance: attribution, external and unproven are different answers.
const fillProvenanceRows = computed(() => {
  const tally: Record<string, number> = (s.snapshot as any)?.exchangeFillFacts?.fillsByProvenanceLast1h ?? {};
  return Object.entries(tally).map(([key, count]) => ({ key, count }));
});

const capacityPolicyText = computed(() => {
  const policy = capacityVisibility.value?.exposure?.gross?.mode === undefined ? null : capacityVisibility.value;
  if (!policy) return "政策未投影";
  const e = policy.exposure;
  return `Gross=${e.gross.mode} · Direction=${e.LONG.mode} · Cluster=${policy.limits?.policy?.cluster ?? "ENFORCE"}（OBSERVE 仅展示不否决，ENFORCE 一票否决）`;
});
// The funnel is the Engine's fold over its own durable journal. This page counts nothing: a stage
// appears here only because the layer that creates it wrote an event saying so.
const FUNNEL_STAGES: Array<[string, string]> = [
  ["primaryCompleted", "Primary 完成"],
  ["place", "PLACE"],
  ["authorizedPlace", "已授权 Primary PLACE"],
  ["riskAllowed", "组合风险准入（TESTNET 可不适用）"],
  ["tradePlanReady", "TradePlan 就绪"],
  ["reservationCreated", "Reservation 建立"],
  ["intentCreated", "Intent 建立"],
  ["orderSubmitted", "订单已提交"],
  ["entryFilled", "建仓成交"],
];
const conversionWindowKey = ref<"thirtyMinutes" | "oneHour">("thirtyMinutes");
const conversionWindow = computed(() => pipeline.value?.entryConversion?.[conversionWindowKey.value] ?? null);
const stageCount = (key: string) => Number(conversionWindow.value?.[key] ?? 0);
const percent = (value: unknown) => (typeof value === "number" ? `${value}%` : "—");
const physicalReasonLabel=(reason:string)=>{
  if(/MARGIN|FUNDS|BALANCE/.test(reason))return '决策后真实资金不足';
  if(/FILTER|PRECISION|MINIMUM_NOTIONAL|EXCHANGE_LEGALITY/.test(reason))return '交易所价量规则变化或不合法';
  if(/FROZEN_IDENTITY|CANDIDATE_PROVENANCE/.test(reason))return '冻结候选身份损坏';
  if(/PERSISTENCE|DURABILITY/.test(reason))return '持久化失败';
  if(/PERMISSION|AUTO|TESTNET_ENABLED/.test(reason))return 'TESTNET 自动执行已关闭';
  if(/PRIVATE_ACCOUNT/.test(reason))return '私有账户数据无法证明';
  if(/SET_LEVERAGE/.test(reason))return '设置杠杆失败';
  if(/BINANCE_SUBMIT|BINANCE.*REJECT/.test(reason))return 'Binance 提交拒绝';
  if(/UNKNOWN|EXACT/.test(reason))return '提交结果未知，等待身份查询';
  return '执行链事实未证明';
};

const labels: Record<string, string> = {
  market: "行情中心",
  restBudget: "交易所REST预算",
  freshMarkets: "新鲜度",
  universe: "候选全集",
  eligibility: "资格筛选",
  pool: "交易池",
  scout: "9B 事实抽取",
  primaryBrain: "Primary 本次运行",
  existingPositions: "现有持仓",
  excludedSymbols: "非驻留标的",
  pendingEntries: "交易所活动建仓",
  entryPermission: "下单许可",
  binancePrivate: "交易所私有数据",
  reconciliation: "交易所对账",
  takeProfit: "止盈保护",
  scheduler: "调度器",
  entryActivity: "建仓活动",
};
let loading: Promise<void> | null = null;
let disposed = false;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
const refreshError = ref<string | null>(null);
function load(): Promise<void> {
  if (loading) return loading;
  loading = loadCurrent().finally(() => { loading = null; });
  return loading;
}
async function loadCurrent() {
  try {
    const [p, a] = await Promise.all([api.pipeline(), api.accountAssets()]);
    if (disposed) return;
    pipeline.value = p;
    assets.value = a.assets ?? [];
    refreshError.value = null;
  } catch { if (!disposed) refreshError.value = '状态刷新失败，以下为最后一次成功快照'; }
}
async function pause() {
  await api.pauseTrading("Dashboard 手动暂停新建仓");
  await Promise.all([load(), s.refresh()]);
}
async function resume() {
  await api.resumeTrading();
  await Promise.all([load(), s.refresh()]);
}
async function openRiskOverride(){riskOverrideError.value=null;try{riskOverridePreview.value=await api.riskPausePreview();if(!riskOverridePreview.value?.canOverride){riskOverrideError.value='当前状态不允许人工解除风险暂停';return;}riskOverrideOpen.value=true;}catch(e){riskOverrideError.value=e instanceof Error?e.message:String(e);}}
async function confirmRiskOverride(){riskOverrideBusy.value=true;riskOverrideError.value=null;try{await api.overrideRiskPause(riskOverrideReason.value);riskOverrideOpen.value=false;await Promise.all([load(),s.refresh()]);}catch(e){riskOverrideError.value=e instanceof Error?e.message:String(e);}finally{riskOverrideBusy.value=false;}}
function refreshVisible() { if (!document.hidden) void load(); }
onMounted(() => {
  void load();
  refreshTimer = setInterval(refreshVisible, 3000);
  document.addEventListener('visibilitychange', refreshVisible);
});
onUnmounted(() => {
  disposed = true;
  clearInterval(refreshTimer);
  document.removeEventListener('visibilitychange', refreshVisible);
});
</script>
<template>
  <div class="page-stack">
    <div v-if="refreshError" class="policy-card danger-lite">{{ refreshError }}</div>
    <div class="kpi-grid five">
      <div class="kpi">
        <span>总资产（USDT + USDC）</span
        ><strong>{{
          account()?.valuation?.totalEquityUsd == null ? (account()?.equityUsd == null ? "—" : money(account().equityUsd)) : money(account().valuation.totalEquityUsd)
        }}</strong
        ><small>同一 Binance Futures 快照的 USDT + USDC 钱包与浮动盈亏；不包含 BTC/其它资产</small>
      </div>
      <div class="kpi">
        <span>USDT + USDC 浮动盈亏</span
        ><strong
          :class="
            (account()?.unrealizedPnlUsd ?? 0) >= 0 ? 'positive' : 'negative'
          "
          >{{
            account()?.unrealizedPnlUsd == null
              ? "—"
              : money(account().unrealizedPnlUsd)
          }}</strong
        >
      </div>
      <div class="kpi">
        <span>当前持仓</span
        ><strong>{{ account()?.activePositions ?? "—" }}</strong>
      </div>
      <div class="kpi">
        <span>本地已确认净收益</span
        ><strong
          :class="(s.snapshot?.tradeLocalConfirmedNetPnl ?? 0) >= 0 ? 'positive' : 'negative'"
          >{{ s.snapshot?.tradeLocalConfirmedNetPnl == null ? "—" : money(s.snapshot.tradeLocalConfirmedNetPnl) }}</strong
        >
        <small>仅统计本系统 SYSTEM 周期：交易收益（不含资金费） {{ money(s.snapshot?.tradeLocalTradingNetExFunding ?? 0) }} · 已确认资金费 {{ money(s.snapshot?.tradeLocalConfirmedFunding ?? 0) }} · {{ s.snapshot?.tradeCompletedExFundingCount ?? 0 }} 个完整周期<span v-if="(s.snapshot?.tradeFundingUnknownCount ?? 0) > 0"> · {{ s.snapshot?.tradeFundingUnknownCount }} 笔资金费未确认，未计入上方数字</span><span v-else> · 资金费覆盖已闭合</span>；全量最终净收益 {{ s.snapshot?.tradeNetPnl == null ? '未证明' : money(s.snapshot.tradeNetPnl) }}</small>
      </div>
      <div class="kpi" data-active-commissions>
        <span>{{ commissions ? "活动委托 · 按证明来源分列（不相加）" : "活动委托 · 分类不可用" }}</span>
        <ul v-if="commissions" class="commission-list">
          <li v-for="row in commissionRows" :key="row.key" :data-commission="row.key">
            <span>{{ row.label }}</span
            ><strong :class="row.key === 'localUnresolvedUnknown' && row.count > 0 ? 'negative' : ''">{{ row.count }}</strong>
            <small>{{ row.hint }}</small>
          </li>
        </ul>
        <template v-else>
          <ul class="commission-list" data-commissions-unavailable>
            <li data-commission="legacyEntry"><span>建仓委托（旧口径，未区分证明来源）</span><strong>{{ legacyActiveOrders.entry ?? "—" }}</strong></li>
            <li data-commission="legacyTp"><span>止盈委托（旧口径，未区分证明来源）</span><strong>{{ legacyActiveOrders.tp ?? "—" }}</strong></li>
          </ul>
          <small>本实例 Engine 未提供 executionTruth：无法区分交易所确认与本地未决，以上两项不构成委托分类。</small>
        </template>
      </div>
    </div>
    <div v-if="account()?.valuation" class="policy-card" :class="account().valuation.status==='ACCOUNT_VALUATION_INCONSISTENT'?'danger-lite':''" data-account-valuation><strong>{{account().valuation.status==='ACCOUNT_VALUATION_INCONSISTENT'?'ACCOUNT_VALUATION_INCONSISTENT':'USDT + USDC 账户总资产口径'}}</strong><span>钱包合计 {{money(account().valuation.totalWalletUsd ?? account().valuation.stablecoinWalletUsd)}} + 浮动盈亏 {{money(account().valuation.totalUnrealizedPnlUsd ?? 0)}} = 总资产/保证金权益 {{money(account().valuation.totalEquityUsd ?? account().valuation.stablecoinMarginUsd)}}；可用余额合计 {{money(account().valuation.totalAvailableUsd ?? account()?.availableUsd ?? 0)}}。仅统计 USDT、USDC；{{(account().valuation.excludedAssets??[]).length?'以下资产只在明细展示、不计入总资产：'+account().valuation.excludedAssets.join('、'):'没有其它资产计入总额。'}} Entry 可执行保证金仍按 USDT/USDC 各自 availableBalance 分开路由。</span></div>
    <Panel title="最近 1 小时交易事实" subtitle="Binance 成交按系统归因、外部成交和 UNPROVEN 分列；总 Entry fills 不等于已证明的系统成交。"><div class="facts wide"><div><dt>交易所 Entry 方向 fills（含 UNPROVEN）</dt><dd>{{s.snapshot?.exchangeFillFacts?.entryFillsLast1h??0}}</dd></div><div><dt>Exit fills</dt><dd>{{s.snapshot?.exchangeFillFacts?.exitFillsLast1h??0}}</dd></div><div><dt>Closed trades</dt><dd>{{s.snapshot?.exchangeFillFacts?.closedTradesLast1h??0}}</dd></div><div><dt>Net PnL</dt><dd>{{money(s.snapshot?.exchangeFillFacts?.netPnlLast1h??0)}}</dd></div><div><dt>External / unlinked fills</dt><dd :class="(s.snapshot?.exchangeFillFacts?.externalFillsLast1h??s.snapshot?.exchangeFillFacts?.unattributedFillsLast1h??0)>0?'negative':''">{{s.snapshot?.exchangeFillFacts?.externalFillsLast1h??s.snapshot?.exchangeFillFacts?.unattributedFillsLast1h??0}}</dd></div></div><div v-if="s.snapshot?.exchangeFillFacts?.systemFillParityAlert && (s.snapshot?.exchangeFillFacts?.systemFillAttributionGapLast1h??0)>0" class="policy-card danger-lite"><strong>EXCHANGE_FILL_ATTRIBUTION_GAP</strong><span>疑似 Engine 成交未完成本地归因，请在交易记录页面执行事实审计。</span></div><div v-if="fillProvenanceRows.length" class="facts wide" data-fill-provenance><div v-for="row in fillProvenanceRows" :key="row.key" :data-fill-provenance-row="row.key"><dt>证明来源 {{row.key}}</dt><dd>{{row.count}} 笔</dd></div></div><p v-else class="muted" data-fill-provenance-unavailable>本实例未投影按证明来源分列的成交事实：归因成交与外部成交无法逐项核对。</p></Panel>
    <Panel title="执行真相 · 八项独立检查" subtitle="每一项只回答自己的问题，任何一项都不代替其它项；未投影或 UNKNOWN 一律显示为未知，不显示为健康">
      <div class="compact-summary">{{ truthChecks.filter(check=>check.status==='HEALTHY').length }} / 8 项健康 · {{ truthChecks.filter(check=>check.status!=='HEALTHY').length }} 项需关注</div><details class="compact-details"><summary>查看八项明细</summary>
      <div class="facts wide" data-execution-truth>
        <div v-for="check in truthChecks" :key="check.key" class="truth-card" :data-truth-check="check.key">
          <dt>{{ check.label }} · <StatusBadge :value="check.status" /><span class="truth-status">{{ statusLabel(check.status) }}</span></dt>
          <dd>
            <small class="truth-question">{{ check.question }}</small>
            <ul v-if="check.facts.length" class="truth-facts"><li v-for="fact in check.facts" :key="fact[0]">{{ fact[0] }} {{ fact[1] }}</li></ul>
            <small v-if="check.detail" class="truth-detail">{{ check.detail }}</small>
            <small v-else class="truth-detail">本项未提供文字说明</small>
          </dd>
        </div>
      </div>
      <p v-if="!truth" class="policy-card danger-lite" data-truth-unavailable><strong>EXECUTION_TRUTH_NOT_PROJECTED</strong><span>本实例 Engine 未投影执行真相：以上八项均为未知，不以管线聚合状态或“已对账”标签代替。</span></p>
      <div class="facts wide" data-exit-convergence>
        <template v-if="convergenceFacts.length">
          <div v-for="row in convergenceFacts" :key="row[0]" :data-convergence="row[0]"><dt>{{ row[1] }}</dt><dd>{{ row[2] }}</dd></div>
        </template>
        <p v-else data-exit-convergence-unavailable><strong>退出收敛队列未投影</strong><span>{{ convergence?.available === false ? (convergence?.reason ?? "EXIT_RUNTIME_NOT_ATTACHED") : "EXIT_CONVERGENCE_NOT_PROJECTED" }}；未知不等于已收敛，不据此判定退出链正常。</span></p>
      </div></details>
    </Panel>
    <Panel
      title="新建仓执行权限"
      subtitle="自动流程、可执行容量与交易所数据分别显示；9B 事实抽取与 Primary 独立调度，写入限于 Testnet"
      ><div class="compact-summary"><StatusBadge :value="autoMode()"/> {{entryEnabled()?'TESTNET 自动建仓已启用':'新建仓受限'}} · {{control()?.capital?.executableCandidateCount??0}} 个可执行候选 · {{authoritative?.code??'待评估'}}</div><details class="compact-details"><summary>查看执行权限明细</summary><div class="facts wide">
        <div>
          <dt>自动执行模式</dt>
          <dd>
            <StatusBadge :value="autoMode()" />
            {{ entryEnabled() ? "允许 Testnet 自动建仓" : "禁止自动建仓" }}
          </dd>
        </div>
        <div>
          <dt>分析管线状态</dt>
          <dd>
            <StatusBadge :value="control()?.mode ?? 'RUNNING'" />
            {{ pipeline?.analysis?.text ?? control()?.reasonText ?? "运行中" }}
            <small v-if="pipeline?.analysis">调度心跳 {{ pipeline.analysis.schedulerStatus ?? 'UNKNOWN' }}（{{ pipeline.analysis.heartbeatAt ? new Date(pipeline.analysis.heartbeatAt).toLocaleTimeString() : '尚未收到' }}）；最近派发意图：{{ pipeline.analysis.lastAttemptAt ? new Date(pipeline.analysis.lastAttemptAt).toLocaleString() : '本实例尚未派发' }}；最近模型请求：{{ pipeline.analysis.lastRequestAt ? new Date(pipeline.analysis.lastRequestAt).toLocaleString() : '本实例尚无' }}；距最近分析成功 {{ Math.floor((pipeline.analysis.primarySuccessAgeMs ?? pipeline.analysis.silenceMs ?? 0) / 60000) }} 分钟；抑制原因 {{ pipeline.analysis.suppression?.suppressionReason ?? pipeline.analysis.reason }}{{ pipeline.analysis.suppression?.authoritativeBlocker ? ` · 首因 ${pipeline.analysis.suppression.authoritativeBlocker}` : '' }}；下次评估 {{ pipeline.analysis.nextEvaluationAt ? new Date(pipeline.analysis.nextEvaluationAt).toLocaleTimeString() : '待定' }}；候选 {{ pipeline.analysis.capitalExecutableCount }}</small>
          </dd>
        </div>
        <div>
          <dt>Entry Safety</dt>
          <dd>
            <StatusBadge
              :value="control()?.entrySafetyMode ?? 'SAFETY_REVIEW_PAUSED'"
            />
          </dd>
        </div>
        <div data-execution-readiness>
          <dt>执行就绪判定</dt>
          <dd>
            <StatusBadge :value="readiness?.mode ?? 'NOT_EVALUATED'" />
            {{ readiness?.text ?? "本实例尚未评估执行事实" }}
            <small v-if="readiness">首因 {{ readiness.firstBlocker ?? "NONE" }}；最近就绪：{{ readiness.lastReadyAt ? new Date(readiness.lastReadyAt).toLocaleString() : '本实例暂无' }}</small>
          </dd>
        </div>
        <div data-risk-profile>
          <dt>组合风险档案（权威 readback）</dt>
          <dd>
            <StatusBadge :value="riskProfile?.status ?? 'NOT_EVALUATED'" />
            <small>{{ riskProfileNote() }}</small>
          </dd>
        </div>
        <div>
          <dt>可执行候选</dt>
          <dd>
            {{ control()?.capital?.executableCandidateCount ?? 0 }} / 最低
            {{ s.settings?.runtimeControl?.minExecutableCandidates ?? 1 }}
          </dd>
        </div>
        <div>
          <dt>USDT 可用 / 可路由标的</dt>
          <dd>
            {{ money(control()?.capital?.usdtAvailable ?? 0) }} /
            {{ control()?.capital?.usdtExecutableUnderlyings ?? 0 }}
          </dd>
        </div>
        <div>
          <dt>USDC 可用 / 可路由标的</dt>
          <dd>
            {{ money(control()?.capital?.usdcAvailable ?? 0) }} /
            {{ control()?.capital?.usdcExecutableUnderlyings ?? 0 }}
          </dd>
        </div>
        <div>
          <dt>下次资金检查</dt>
          <dd>
            {{
              control()?.nextCapitalCheckAt
                ? new Date(control().nextCapitalCheckAt).toLocaleTimeString()
                : "—"
            }}
          </dd>
        </div>
        <div>
          <dt>实际路由</dt>
          <dd>
            {{
              (control()?.capital?.routedCandidates ?? [])
                .slice(0, 4)
                .map((x: any) => `${x.symbol} ${x.quoteAsset}`)
                .join(" · ") || "暂无"
            }}
          </dd>
        </div>
      </div>
      <div v-if="capacityVisibility" class="facts wide" data-capacity-visibility>
        <div data-capital-block="funding">
          <dt>1 · 资金与保证金容量（可动用）</dt>
          <dd>
            {{ capacityFunding.perAsset.length ? capacityFunding.perAsset.join("；") : "未投影计价资产资金事实" }} ·
            <strong data-entry-trading-capital>Total Entry Trading Capital
            {{ fmt(capacityFunding.totalExecutableMarginUsd) }}</strong>
            <span v-if="!capacityFunding.proven">（资金事实不完整，按 0 处理）</span>
            <span v-if="excludedEntryFunding.length"> · 不参与新建仓资金：{{ excludedEntryFunding.join("、") }}</span>
          </dd>
        </div>
        <div data-capital-block="exposure">
          <dt>2 · 组合名义敞口（事实，不等于可用资金）</dt>
          <dd>
            Gross {{ fmt(capacityVisibility.exposure.gross.notionalUsd) }} / 上限
            {{ fmt(capacityVisibility.exposure.gross.limitUsd) }}（已用
            {{ (capacityVisibility.exposure.gross.usedPct * 100).toFixed(1) }}%）· LONG
            {{ fmt(capacityVisibility.exposure.LONG.notionalUsd) }} /
            {{ fmt(capacityVisibility.exposure.LONG.limitUsd) }} · SHORT
            {{ fmt(capacityVisibility.exposure.SHORT.notionalUsd) }} /
            {{ fmt(capacityVisibility.exposure.SHORT.limitUsd) }}
          </dd>
        </div>
        <div data-capital-block="limits">
          <dt>3 · 风险与安全限制</dt>
          <dd>
            {{ capacityPolicyText }} · {{ pipeline?.entryResourcePolicy?.mode === 'TESTNET_FUNDS_ONLY' ? '审计风险槽位（TESTNET 不执行）' : '槽位' }} {{ capacityVisibility.limits.slots.used }} /
            {{ capacityVisibility.limits.slots.max }}（持仓 {{ capacityVisibility.limits.slots.positions }} / 在途风险身份
            {{ capacityVisibility.limits.slots.inFlight }} / 预留 {{ capacityVisibility.limits.slots.reserved }}；交易所活动建仓 {{ pipeline?.pendingEntries?.count ?? '未核实' }}）·
            首个饱和硬维度 {{ capacityVisibility.firstBlocker }}
          </dd>
        </div>
        <div data-capital-block="entry">
          <dt>4 · 最终可执行新增 Entry 容量</dt>
          <dd data-final-entry-capacity>{{ capacityEntry.finalLine }}</dd>
          <dd data-entry-capacity>{{ capacityEntry.LONG }}</dd>
          <dd data-entry-capacity>{{ capacityEntry.SHORT }}</dd>
          <dd data-side-status>{{ capacitySideStatusText }}</dd>
          <dd>
            {{
              capacityVisibility.exhaustedForNewRisk
                ? `新增风险额度已用尽 · ${capacityVisibility.exhaustedReason}`
                : `仍有空间（可执行保证金 ${fmt(capacityFunding.totalExecutableMarginUsd)}）`
            }}
          </dd>
          <dd v-for="side in capacitySides" :key="side" class="wide" data-capacity-trace>
            <details>
              <summary>{{ side }} 逐候选容量（{{ sideCandidateRows(side).length }} 个可路由候选）</summary>
              <ul><li v-for="row in sideCandidateRows(side)" :key="row">{{ row }}</li></ul>
            </details>
          </dd>
        </div>
      </div>
      <div
        class="policy-card"
        :class="authoritativeStage === 'NONE' ? '' : 'danger-lite'"
        data-caps-first-explanation
      >
        <strong>{{ authoritativeText }}</strong
        ><span
          >权威首因与下一步由 Engine 在同一次评估中给出（stage {{ authoritativeStage }}）；额度与槽位取自同一次风险计算，此额度只限制新增
          Entry 风险，不强平已有仓位，也不撤已有 TP/保护。持仓数未达上限不等于仍有新增风险额度。</span
        >
        <details v-if="admissionReadback" data-risk-admission-readback>
          <summary>权威风险读数 · {{ admissionReadback.status }} · {{ admissionReadback.scope }} · generation {{ admissionReadback.riskGeneration ?? "—" }}</summary>
          <p>评估 {{ admissionReadback.evaluatedAt ? new Date(admissionReadback.evaluatedAt).toLocaleString() : "—" }} · snapshot {{ admissionReadback.snapshotHash ?? "—" }} · profile {{ admissionReadback.profileVersion ?? "—" }} · settings {{ admissionReadback.settingsVersion ?? "—" }}</p>
          <p v-if="admissionReadback.symbol">候选 {{ admissionReadback.symbol }} {{ admissionReadback.side }} · {{ admissionReadback.quoteAsset }} · leverage {{ admissionReadback.leverage ?? "—" }} ({{ admissionReadback.leverageFact ?? "—" }})</p>
          <p v-if="admissionReadback.firstBinding">首个绑定 {{ admissionReadback.firstBinding.code }} · {{ admissionReadback.firstBinding.unit ?? "—" }} · used {{ admissionReadback.firstBinding.usedUsd ?? "—" }} / limit {{ admissionReadback.firstBinding.limitUsd ?? "—" }} · headroom {{ admissionReadback.firstBinding.headroomUsd ?? "—" }} · shortfall {{ admissionReadback.firstBinding.shortfallUsd ?? "—" }}</p>
          <ul><li v-for="line in admissionGateLines" :key="line">{{ line }}</li></ul>
        </details>
        <div v-if="isolatedSymbolLines.length" data-market-isolation>
          <span
            >已按 symbol 隔离 {{ marketIsolation?.isolatedCount ?? 0 }}/{{ marketIsolation?.candidateCount ?? 0 }}
            个行情故障合约（健康候选 {{ marketIsolation?.healthyCandidates ?? 0 }} 个继续走管线）：</span
          >
          <ul><li v-for="line in isolatedSymbolLines" :key="line">{{ line }}</li></ul>
        </div>
        <details v-if="secondaryDiagnostics.length" data-secondary-diagnostics>
          <summary>次级诊断 {{ secondaryDiagnostics.length }} 项（不作为第二个首因）</summary>
          <ul><li v-for="line in secondaryDiagnostics" :key="line">{{ line }}</li></ul>
        </details>
      </div>
      <div class="policy-card" :class="entryEnabled() ? '' : 'danger-lite'">
        <strong>{{ entryPermissionText() }}</strong
        ><span
          >行情、私有数据、对账、持仓、止盈和人工控制台不受该 Entry
          权限影响。</span
        >
      </div>
      <div v-if="control()?.manualRiskOverride?.active || control()?.manualRiskOverride?.override" class="policy-card danger-lite"><strong>MANUAL_RISK_OVERRIDE_ACTIVE</strong><span>日内风险指标保持告警；人工覆盖仅在当前上海交易日有效，重置时间：{{control()?.manualRiskOverride?.nextRiskCycleAt?new Date(control().manualRiskOverride.nextRiskCycleAt).toLocaleString():'—'}}</span></div>
      <p v-if="riskOverrideError" class="error-text">{{riskOverrideError}}</p>
      <div class="toolbar">
        <button v-if="entryEnabled()" class="button secondary" @click="pause">
          暂停新建仓</button
        ><button
          v-else-if="
            autoMode() === 'AUTO_RUNNING' && control()?.mode === 'PAUSED_MANUAL'
          "
          class="button primary"
          @click="resume"
        >
          恢复新建仓</button
        ><button v-else-if="autoMode()==='AUTO_PAUSED_RISK' && control()?.mode==='PAUSED_DAILY_RISK_LIMIT'" class="button primary" @click="openRiskOverride">人工解除风险暂停</button
        ><span v-if="(control()?.capital?.noUsdtMargin ?? 0)>0 || (control()?.capital?.noUsdcContract ?? 0)>0" class="muted"
          >{{ control()?.capital?.noUsdtMargin ?? 0 }} 个 USDT 资金不足 ·
          {{ control()?.capital?.noUsdcContract ?? 0 }} 个 USDC
          合约不可执行</span
        >
      </div></details></Panel
    ><div v-if="riskOverrideOpen&&riskOverridePreview" class="modal-backdrop" @click.self="riskOverrideOpen=false"><div class="modal"><div class="toolbar"><h2>人工复核并恢复自动建仓</h2><button class="button secondary" @click="riskOverrideOpen=false">关闭</button></div><p class="muted">仅 Testnet 有效。风险指标不会清零，当前上海交易日结束时自动失效。</p><div class="facts wide"><div><dt>暂停原因</dt><dd>{{riskOverridePreview.pauseReason}}</dd></div><div><dt>周期收益 / 回撤</dt><dd>{{money(riskOverridePreview.riskMetrics.capitalEpochRealizedPnlUsd)}} / {{(riskOverridePreview.riskMetrics.riskDrawdownPct*100).toFixed(2)}}%</dd></div><div><dt>可用资金</dt><dd>USDT {{money(riskOverridePreview.availableCapital.usdt)}} · USDC {{money(riskOverridePreview.availableCapital.usdc)}}</dd></div><div><dt>可执行候选</dt><dd>{{riskOverridePreview.executableCandidates}}</dd></div><div><dt>当前持仓</dt><dd>{{riskOverridePreview.currentPositions.map((p:any)=>`${p.symbol} ${p.side}`).join(' · ')||'无'}}</dd></div><div><dt>活动委托</dt><dd>{{riskOverridePreview.workingOrders.length}}</dd></div><div><dt>下一次周期重置</dt><dd>{{new Date(riskOverridePreview.override.nextRiskCycleAt).toLocaleString()}}</dd></div></div><label>复核说明<input v-model="riskOverrideReason" maxlength="240"/></label><div class="toolbar"><button class="button primary" :disabled="riskOverrideBusy||!riskOverrideReason.trim()" @click="confirmRiskOverride">{{riskOverrideBusy?'处理中…':'确认恢复 Testnet AUTO'}}</button><button class="button secondary" :disabled="riskOverrideBusy" @click="riskOverrideOpen=false">取消</button></div><p v-if="riskOverrideError" class="error-text">{{riskOverrideError}}</p></div></div>
    ><Panel
      title="Portfolio Intelligence"
      subtitle="组合暴露、资金路由与动态分配只影响新 Entry，不自动修改已有仓位"
      ><div class="facts wide">
        <div>
          <dt>LONG exposure</dt>
          <dd>
            {{ money(s.snapshot?.portfolioIntelligence?.longNotionalUsd ?? 0) }}
            /
            {{
              (
                (s.snapshot?.portfolioIntelligence?.longExposurePct ?? 0) * 100
              ).toFixed(1)
            }}%
          </dd>
        </div>
        <div>
          <dt>SHORT exposure</dt>
          <dd>
            {{
              money(s.snapshot?.portfolioIntelligence?.shortNotionalUsd ?? 0)
            }}
            /
            {{
              (
                (s.snapshot?.portfolioIntelligence?.shortExposurePct ?? 0) * 100
              ).toFixed(1)
            }}%
          </dd>
        </div>
        <div>
          <dt>Speculative</dt>
          <dd>
            {{
              money(
                s.snapshot?.portfolioIntelligence?.speculativeNotionalUsd ?? 0,
              )
            }}
            /
            {{
              (
                (s.snapshot?.portfolioIntelligence?.speculativeExposurePct ??
                  0) * 100
              ).toFixed(1)
            }}%
          </dd>
        </div>
        <div>
          <dt>Allocation Plans</dt>
          <dd>
            {{ s.snapshot?.portfolioIntelligence?.recentAllocationPlans ?? 0 }}
          </dd>
        </div>
      </div></Panel
    ><Panel
      title="实时执行链"
      subtitle="Market → Underlying → Capital Admission → Policy → Exposure → Location → Allocation → AI → Entry"
      ><div class="pipeline-strip">
        <div
          v-for="(item, name) in pipeline"
          v-show="
            !['asOf', 'observationVersion', 'capacity', 'capacityVisibility', 'privateSync', 'noEntryReason', 'work', 'stagnation', 'runtimeControl', 'pipelineState', 'marketDataReason', 'marketDataDetail'].includes(
              String(name),
            )
          "
          :key="name"
        >
          <span>{{ labels[String(name)] ?? name }}</span
          ><StatusBadge :value="item?.status ?? 'READY'" /><small>{{
            item?.count ?? item?.current ?? item?.runs ?? ""
          }}</small>
        </div>
      </div>
      <div v-if="pipeline?.restBudget?.lastLimitedAt" class="policy-card danger-lite"><strong>{{ pipeline.restBudget.status==='RATE_LIMITED'?'交易所REST限流中':'交易所REST已恢复，保留限流记录' }}</strong><span>418：{{pipeline.restBudget.http418}}，429：{{pipeline.restBudget.http429}}；本实例最近限流：{{new Date(pipeline.restBudget.lastLimitedAt).toLocaleString()}}。{{pipeline.restBudget.status==='RATE_LIMITED'?'等待至 '+new Date(pipeline.restBudget.blockedUntil).toLocaleString()+'；私有状态未恢复前不新增建仓。':'恢复不代表长期验收通过。'}}</span></div>
      <div class="work-card">
        <span>事实时间：{{ pipeline?.asOf ? new Date(pipeline.asOf).toLocaleTimeString() : '—' }}；容量：{{ pipeline?.capacity?.used ?? '—' }} / {{ pipeline?.capacity?.max ?? '—' }}</span>
        <strong>当前：{{ pipeline?.work?.current ?? "等待运行数据" }}</strong
        ><span
          >最近方向 / 决策：{{
            pipeline?.work?.recentDecision?.direction ?? "—"
          }}
          / {{ pipeline?.work?.recentDecision?.decision ?? "—" }}</span
        ><span>下一步：{{ pipeline?.work?.next ?? "—" }}</span>
      </div>
      <div v-if="pipeline?.pipelineState==='PAUSED_MARKET_DATA_UNAVAILABLE'" class="policy-card danger-lite"><strong>建仓管线：PAUSED_MARKET_DATA_UNAVAILABLE</strong><span>系统级原因：{{pipeline.marketDataReason}}；健康候选 {{ marketIsolation?.healthyCandidates ?? 0 }} 个（已隔离 {{ marketIsolation?.isolatedCount ?? 0 }} 个）。只有行情源整体故障或全部候选都失去数据时才暂停整条管线；单 symbol 缺口只隔离该 symbol。自动执行模式保持 {{autoMode()}}。</span></div>
      <div v-if="pipeline?.noEntryReason && pipeline?.pipelineState!=='PAUSED_MARKET_DATA_UNAVAILABLE'" class="policy-card danger-lite">
        <strong>当前未建新仓：{{ pipeline.noEntryReason }}</strong
        ><span>新建仓流水线暂停时，已有仓位和保护链不受影响。</span>
      </div></Panel
    >
    <Panel title="AI Recovery / Candidate Lifecycle" subtitle="单币失败隔离；Primary 只使用一个 27B 槽位，Scout 可预取下一候选。">
      <div class="facts wide"><div><dt>AI completed / failed (30m)</dt><dd>{{pipeline?.aiHealth?.completed??0}} / {{pipeline?.aiHealth?.failed??0}}</dd></div><div><dt>Schema / normalized</dt><dd>{{pipeline?.aiHealth?.schemaInvalid??0}} / {{pipeline?.aiHealth?.normalized??0}}</dd></div><div><dt>Cooldown / quarantine</dt><dd>{{pipeline?.aiHealth?.cooldown??0}} / {{pipeline?.aiHealth?.quarantine??0}}</dd></div><div><dt>Next candidate</dt><dd>{{pipeline?.candidateLifecycle?.nextCandidate??'—'}}</dd></div></div>
      <div v-if="pipeline?.aiHealth?.alert" class="policy-card danger-lite"><strong>{{pipeline.aiHealth.alert}}</strong><span>连续 AI 失败；已将受影响 Symbol 单独冷却/隔离，恢复完成会自动清除告警。</span></div>
      <div class="permission-note">上次未建仓：{{pipeline?.work?.recentDecision?.decision??'—'}}；下一步：{{pipeline?.work?.next??'—'}}。</div>
    </Panel>
    <div class="grid-2">
      <Panel title="资金准入明细"
        ><div class="facts">
          <div>
            <dt>USDT 可用</dt>
            <dd>{{ money(control()?.capital?.usdtAvailable ?? 0) }}</dd>
          </div>
          <div>
            <dt>USDT 可执行保证金</dt>
            <dd>
              {{
                money(
                  (control()?.capital?.usdtAvailable ?? 0) > 0
                    ? (control()?.capital?.usdtAvailable ?? 0)
                    : 0,
                )
              }}
            </dd>
          </div>
          <div>
            <dt>USDC 可用</dt>
            <dd>{{ money(control()?.capital?.usdcAvailable ?? 0) }}</dd>
          </div>
          <div>
            <dt>USDC 可执行保证金</dt>
            <dd>
              {{
                money(
                  (control()?.capital?.usdcAvailable ?? 0) > 0
                    ? (control()?.capital?.usdcAvailable ?? 0)
                    : 0,
                )
              }}
            </dd>
          </div>
        </div></Panel
      ><Panel title="建仓转化漏斗"
        ><div class="compact-summary">30 分钟：已授权 PLACE {{pipeline?.entryConversion?.thirtyMinutes?.authorizedPlace??0}} · 提交 {{pipeline?.entryConversion?.thirtyMinutes?.orderSubmitted??0}} · 成交 {{pipeline?.entryConversion?.thirtyMinutes?.entryFilled??0}}</div><details class="compact-details"><summary>查看转化与首因</summary><div class="toolbar">
          <button
            class="button"
            :class="conversionWindowKey === 'thirtyMinutes' ? 'primary' : 'secondary'"
            @click="conversionWindowKey = 'thirtyMinutes'"
          >30 分钟</button>
          <button
            class="button"
            :class="conversionWindowKey === 'oneHour' ? 'primary' : 'secondary'"
            @click="conversionWindowKey = 'oneHour'"
          >1 小时</button>
        </div>
        <p v-if="!conversionWindow" class="muted">Engine 尚未提供转化投影</p>
        <template v-else>
          <div class="facts wide" data-entry-conversion>
            <div v-for="[key, label] in FUNNEL_STAGES" :key="key">
              <dt>{{ label }}</dt>
              <dd>{{ conversionWindow.stageSemantics?.[key]==='NOT_REQUIRED'?'不适用（N/A）':stageCount(key) }}</dd>
            </div>
            <div>
              <dt>等待价格</dt>
              <dd>{{ stageCount("waitingPrice") }}</dd>
            </div>
            <div>
              <dt>REJECT 30m</dt>
              <dd>{{ pipeline?.entryActivity?.rejectCount30m ?? 0 }}</dd>
            </div>
          </div>
          <div class="facts">
            <div>
              <dt>PLACE→TradePlan</dt>
              <dd>{{ percent(conversionWindow.ratios?.placeToTradePlan) }}</dd>
            </div>
            <div>
              <dt>TradePlan→Submit</dt>
              <dd>{{ percent(conversionWindow.ratios?.tradePlanToSubmit) }}</dd>
            </div>
            <div>
              <dt>PLACE→Submit</dt>
              <dd>{{ percent(conversionWindow.ratios?.placeToSubmit) }}</dd>
            </div>
            <div><dt>已授权 PLACE→Submit</dt><dd>{{ percent(conversionWindow.ratios?.authorizedPlaceToSubmit) }}</dd></div>
            <div>
              <dt>Submit→Fill</dt>
              <dd>{{ percent(conversionWindow.ratios?.submitToFill) }}</dd>
            </div>
          </div>
          <p class="permission-note">已授权但未提交的首因：{{ conversionWindow.authorizedNoSubmit?.map(row=>`${physicalReasonLabel(row.reason)} ${row.count}`).join("；")||"无" }}</p>
          <p class="permission-note" data-conversion-drop>
            最大流失：{{ conversionWindow.topDropStage ?? "无阻断事件" }}
            <template v-if="conversionWindow.topDropReason">
              · {{ conversionWindow.topDropReason }} · {{ conversionWindow.topDropCount }} 次</template
            >
          </p>
          <p v-if="conversionWindow.degraded" class="error-text" data-conversion-degraded>
            ENTRY_CONVERSION_DEGRADED：{{ conversionWindow.degradedReason }}（仅告警，不会自动暂停 Testnet 执行）
          </p>
          <p class="muted">
            执行就绪只说明有权进入链路；“已挂单”必须是交易所已接受订单，成交另计。
          </p>
        </template></details>
      </Panel>
    </div>
    <Panel title="真实资产"
      ><table class="data-table">
        <thead>
          <tr>
            <th>资产</th>
            <th>钱包余额</th>
            <th>可用</th>
            <th>USD 估值</th>
            <th>交易所保证金资产</th>
            <th>可用于新建仓（Entry）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in assets" :key="a.asset">
            <td class="symbol">{{ a.asset }}</td>
            <td>{{ a.walletBalance }}</td>
            <td>{{ a.availableBalance }}</td>
            <td>{{ a.usdValue == null ? "—" : money(a.usdValue) }}</td>
            <td><StatusBadge :value="a.marginEligible ? 'YES' : 'NO'" /></td>
            <td data-entry-funding-eligible><StatusBadge :value="entryFundingAssets.has(String(a.asset).toUpperCase()) ? 'YES' : 'NO'" /></td>
          </tr>
        </tbody></table
    ></Panel>
  </div>
</template>
