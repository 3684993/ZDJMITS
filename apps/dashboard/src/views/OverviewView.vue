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
// Engine side. The page only picks which one explains the silence; it never re-adds exposures.
const CAPACITY_BLOCKERS = ["POSITION_CAPACITY", "GROSS", "DIRECTION_LONG", "DIRECTION_SHORT"];
const SUPPLY_SIDE_WAITS = ["WAITING_CANDIDATE", "WAITING_NEW_FACTS", "NO_SUPPLY", "RULE_FILTERED"];
const capacityVisibility = computed(() => pipeline.value?.capacityVisibility ?? null);
const capacityBlocked = computed(() => {
  const view = capacityVisibility.value;
  if (!view || !CAPACITY_BLOCKERS.includes(view.firstBlocker)) return null;
  const eligible = pipeline.value?.eligibility?.count ?? 0;
  const executable = pipeline.value?.runtimeControl?.capital?.executableCandidateCount ?? 0;
  return eligible > 0 && executable === 0 ? view : null;
});
const firstExplanation = computed(() => {
  const view = capacityBlocked.value;
  if (view) return `CAPACITY_BLOCKED · Gross ${money(view.gross.notionalUsd)} / ${money(view.gross.limitUsd)}`;
  const analysis = pipeline.value?.analysis;
  return SUPPLY_SIDE_WAITS.includes(String(analysis?.reason ?? "")) ? (analysis?.text ?? "") : (pipeline.value?.noEntryReason ?? analysis?.text ?? "");
});

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
            <small v-if="pipeline?.analysis">最近调度：{{ pipeline.analysis.lastAttemptAt ? new Date(pipeline.analysis.lastAttemptAt).toLocaleString() : '本实例尚未派发' }}；最近分析成功：{{ pipeline.analysis.lastSuccessAt ? new Date(pipeline.analysis.lastSuccessAt).toLocaleString() : '本实例暂无' }}；静默 {{ Math.floor(pipeline.analysis.silenceMs / 60000) }} 分钟；资本候选 {{ pipeline.analysis.capitalExecutableCount }}</small>
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
        <div>
          <dt>仓位槽位（持仓 / 在途 / 预留）</dt>
          <dd>
            {{ capacityVisibility.slots.used }} / {{ capacityVisibility.slots.max }}（{{
              capacityVisibility.slots.positions
            }}/{{ capacityVisibility.slots.inFlight }}/{{ capacityVisibility.slots.reserved }}）
          </dd>
        </div>
        <div>
          <dt>组合总名义敞口 / 上限（剩余）</dt>
          <dd>
            {{ money(capacityVisibility.gross.notionalUsd) }} /
            {{ money(capacityVisibility.gross.limitUsd) }}（剩余
            {{ money(capacityVisibility.gross.remainingUsd) }}，已用
            {{ (capacityVisibility.gross.usedPct * 100).toFixed(1) }}%）
          </dd>
        </div>
        <div>
          <dt>LONG 名义敞口 / 上限（剩余）</dt>
          <dd>
            {{ money(capacityVisibility.direction.LONG.notionalUsd) }} /
            {{ money(capacityVisibility.direction.LONG.limitUsd) }}（剩余
            {{ money(capacityVisibility.direction.LONG.remainingUsd) }}）
          </dd>
        </div>
        <div>
          <dt>SHORT 名义敞口 / 上限（剩余）</dt>
          <dd>
            {{ money(capacityVisibility.direction.SHORT.notionalUsd) }} /
            {{ money(capacityVisibility.direction.SHORT.limitUsd) }}（剩余
            {{ money(capacityVisibility.direction.SHORT.remainingUsd) }}）
          </dd>
        </div>
        <div>
          <dt>首个容量阻断</dt>
          <dd>{{ capacityVisibility.firstBlocker }}</dd>
        </div>
      </div>
      <div
        v-if="capacityVisibility"
        class="policy-card"
        :class="capacityBlocked ? 'danger-lite' : ''"
        data-caps-first-explanation
      >
        <strong>{{ firstExplanation }}</strong
        ><span
          >额度与槽位取自 Engine 同一次风险计算；此额度只限制新增 Entry 风险，不强平已有仓位，也不撤已有
          TP/保护。持仓数未达上限不等于仍有新增风险额度。</span
        >
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
      <div v-if="pipeline?.pipelineState==='PAUSED_MARKET_DATA_UNAVAILABLE'" class="policy-card danger-lite"><strong>建仓管线：PAUSED_MARKET_DATA_UNAVAILABLE</strong><span>原因：{{pipeline.marketDataReason}}。智能选币等待实时行情恢复；自动执行模式保持 {{autoMode()}}。</span></div>
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
      ><Panel title="建仓活动状态"
        ><div class="facts">
          <div>
            <dt>Primary 30m</dt>
            <dd>{{ pipeline?.entryActivity?.primaryCount30m ?? 0 }}</dd>
          </div>
          <div>
            <dt>PLACE / REJECT</dt>
            <dd>
              {{ pipeline?.entryActivity?.placeCount30m ?? 0 }} /
              {{ pipeline?.entryActivity?.rejectCount30m ?? 0 }}
            </dd>
          </div>
          <div>
            <dt>Submit / Fill</dt>
            <dd>
              {{ pipeline?.entryActivity?.submitCount30m ?? 0 }} /
              {{ pipeline?.entryActivity?.fillCount30m ?? 0 }}
            </dd>
          </div>
        </div></Panel
      >
    </div>
    <Panel title="真实资产"
      ><table class="data-table">
        <thead>
          <tr>
            <th>资产</th>
            <th>钱包余额</th>
            <th>可用</th>
            <th>USD 估值</th>
            <th>保证金资产</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in assets" :key="a.asset">
            <td class="symbol">{{ a.asset }}</td>
            <td>{{ a.walletBalance }}</td>
            <td>{{ a.availableBalance }}</td>
            <td>{{ a.usdValue == null ? "—" : money(a.usdValue) }}</td>
            <td><StatusBadge :value="a.marginEligible ? 'YES' : 'NO'" /></td>
          </tr>
        </tbody></table
    ></Panel>
  </div>
</template>
