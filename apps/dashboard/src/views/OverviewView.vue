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
  const side = (name: 'LONG' | 'SHORT') => {
    const row = view.entryCapacity?.[name] ?? {};
    const route = row.symbol && row.quoteAsset ? ` via ${row.symbol}/${row.quoteAsset}` : "";
    return blocked
      ? `${name} 候选估算 ${fmt(row.executableNotionalUsd)}${route} · PRE-RISK / NOT EXECUTABLE · 首因 ${row.firstBindingConstraint ?? "NOT_EVALUATED"}`
      : `${name} 可执行新增名义 ${fmt(admission.ceilingUsdBySide?.[name] ?? row.executableNotionalUsd)}${route} · 首因 ${row.firstBindingConstraint ?? "NOT_EVALUATED"}`;
  };
  const finalStatus=admission.status??'NOT_EVALUATED',finalLine=blocked
    ? `权威最终 Entry 容量：LONG $0.00 / ${finalStatus}；SHORT $0.00 / ${finalStatus} · ${admission.code??admission.detail??'BOOK admission unavailable'}`
    : `权威最终 Entry 容量：LONG ${fmt(admission.ceilingUsdBySide?.LONG??view.entryCapacity?.LONG?.executableNotionalUsd)} / ${finalStatus}；SHORT ${fmt(admission.ceilingUsdBySide?.SHORT??view.entryCapacity?.SHORT?.executableNotionalUsd)} / ${finalStatus}`;
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
  return `｜容量上限 ${fmt(room.ceilingUsd)}（已用 ${fmt(room.usedUsd)}，剩余 ${fmt(room.roomUsd)}）来自 ${room.source}`;
};
const sideCandidateRows = (side: 'LONG' | 'SHORT') =>
  (capacityVisibility.value?.entryCapacity?.[side]?.candidates ?? []).map((row: any) =>
    `${row.symbol} ${row.side}：资金容量 ${fmt(row.funding?.executableNotionalUsd)}｜风险后 ${fmt(row.finalNotionalBeforeRoundingUsd)}｜交易所最小合法名义 ${row.minimumLegalNotionalUsd == null ? "未验证" : fmt(row.minimumLegalNotionalUsd)}｜计划 ${row.plan?.admission ?? "未生成"}${capacityRoomText(row)}｜${row.executable ? "可执行" : `首因 ${row.firstBindingConstraint}`}`);
const capacitySideStatusText = computed(() => capacityVisibility.value?.sideStatus?.text ?? "Engine 尚未投影两侧状态");

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
  ["riskAllowed", "风险准入通过"],
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
  excludedSymbols: "排除标的",
  pendingEntries: "待成交建仓",
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
        <span>总资产估值</span
        ><strong>{{
          account()?.equityUsd == null ? "—" : money(account().equityUsd)
        }}</strong
        ><small>真实资产 USD 估值</small>
      </div>
      <div class="kpi">
        <span>浮动盈亏</span
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
        <span>已实现交易收益（不含资金费）</span
        ><strong
          :class="(s.snapshot?.tradeTradingNetExFunding ?? 0) >= 0 ? 'positive' : 'negative'"
          >{{ money(s.snapshot?.tradeTradingNetExFunding ?? 0) }}</strong
        >
        <small>正式净收益 {{ money(s.snapshot?.tradeNetPnl ?? 0) }} · {{ s.snapshot?.tradeCompletedExFundingCount ?? 0 }} 个完整周期<span v-if="(s.snapshot?.tradeFundingUnknownCount ?? 0) > 0"> · {{ s.snapshot?.tradeFundingUnknownCount }} 笔资金费未确认</span></small>
      </div>
      <div class="kpi">
        <span>活动委托</span
        ><strong>{{
          (account()?.activeEntryOrders ?? account()?.pendingEntries ?? 0) +
          (account()?.activeTpOrders ?? 0)
        }}</strong>
      </div>
    </div>
    <Panel title="最近 1 小时交易事实" subtitle="Binance 成交按系统归因与外部成交分开统计；外部成交只进入审计，不触发建仓循环。"><div class="facts wide"><div><dt>Entry fills</dt><dd>{{s.snapshot?.exchangeFillFacts?.entryFillsLast1h??0}}</dd></div><div><dt>Exit fills</dt><dd>{{s.snapshot?.exchangeFillFacts?.exitFillsLast1h??0}}</dd></div><div><dt>Closed trades</dt><dd>{{s.snapshot?.exchangeFillFacts?.closedTradesLast1h??0}}</dd></div><div><dt>Net PnL</dt><dd>{{money(s.snapshot?.exchangeFillFacts?.netPnlLast1h??0)}}</dd></div><div><dt>External / unlinked fills</dt><dd :class="(s.snapshot?.exchangeFillFacts?.externalFillsLast1h??s.snapshot?.exchangeFillFacts?.unattributedFillsLast1h??0)>0?'negative':''">{{s.snapshot?.exchangeFillFacts?.externalFillsLast1h??s.snapshot?.exchangeFillFacts?.unattributedFillsLast1h??0}}</dd></div></div><div v-if="s.snapshot?.exchangeFillFacts?.systemFillParityAlert && (s.snapshot?.exchangeFillFacts?.systemFillAttributionGapLast1h??0)>0" class="policy-card danger-lite"><strong>EXCHANGE_FILL_ATTRIBUTION_GAP</strong><span>疑似 Engine 成交未完成本地归因，请在交易记录页面执行事实审计。</span></div></Panel>
    <Panel
      title="新建仓执行权限"
      subtitle="自动流程、可执行容量与交易所数据分别显示；9B 事实抽取与 Primary 独立调度，写入限于 Testnet"
      ><div class="facts wide">
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
            <small v-if="pipeline?.analysis">调度心跳 {{ pipeline.analysis.schedulerStatus ?? 'UNKNOWN' }}（{{ pipeline.analysis.heartbeatAt ? new Date(pipeline.analysis.heartbeatAt).toLocaleTimeString() : '尚未收到' }}）；最近 Primary dispatch：{{ pipeline.analysis.lastAttemptAt ? new Date(pipeline.analysis.lastAttemptAt).toLocaleString() : '本实例尚未派发' }}；距最近分析成功 {{ Math.floor((pipeline.analysis.primarySuccessAgeMs ?? pipeline.analysis.silenceMs ?? 0) / 60000) }} 分钟；抑制原因 {{ pipeline.analysis.suppression?.suppressionReason ?? pipeline.analysis.reason }}{{ pipeline.analysis.suppression?.authoritativeBlocker ? ` · 首因 ${pipeline.analysis.suppression.authoritativeBlocker}` : '' }}；下次评估 {{ pipeline.analysis.nextEvaluationAt ? new Date(pipeline.analysis.nextEvaluationAt).toLocaleTimeString() : '待定' }}；候选 {{ pipeline.analysis.capitalExecutableCount }}</small>
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
            {{ capacityPolicyText }} · 槽位 {{ capacityVisibility.limits.slots.used }} /
            {{ capacityVisibility.limits.slots.max }}（持仓 {{ capacityVisibility.limits.slots.positions }} / 在途
            {{ capacityVisibility.limits.slots.inFlight }} / 预留 {{ capacityVisibility.limits.slots.reserved }}）·
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
      </div></Panel
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
        ><div class="toolbar">
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
              <dd>{{ stageCount(key) }}</dd>
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
            <div>
              <dt>Submit→Fill</dt>
              <dd>{{ percent(conversionWindow.ratios?.submitToFill) }}</dd>
            </div>
          </div>
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
        </template>
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
