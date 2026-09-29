<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api/client';
import Panel from '../components/Panel.vue';
import EmptyState from '../components/EmptyState.vue';
import PositionConsole from '../components/PositionConsole.vue';
import { money, pct } from '../format';
import { useSystemStore } from '../stores/system';
import { cycleMoments, entryTimeSourceLabel, holdingDuration, positionCycleKey, type HoldingFacts } from '../utils/holdingDuration';
import { useNow } from '../utils/useNow';

const s=useSystemStore(),data=ref<any>({items:[],summary:null,policy:null}),selectedId=ref<string|null>(null),busyId=ref<string|null>(null),feedback=ref('');
const now=useNow(30_000);
let timer:number|undefined;
// The human-managed projection carries the row's own openedAt but not the cycle facts; those come from
// the snapshot position with the same id, so a hand-off row is read as the same physical cycle the
// positions page reads, and never as a fresh clock started at the moment of hand-off.
const cycleById=computed(()=>new Map<string,any>((s.positions??[]).map((p:any)=>[p.id,p])));
function holdingFacts(row:any):HoldingFacts{
  const p=cycleById.value.get(row.positionId);
  return {
    id:row.positionId,
    symbol:row.symbol??p?.symbol??null,
    side:row.side??p?.side??null,
    cycleId:row.cycleId??p?.cycleId??null,
    physicalCycleKey:row.physicalCycleKey??p?.physicalCycleKey??null,
    openedAt:p?.openedAt??row.openedAt??null,
    firstObservedAt:p?.firstObservedAt??row.firstObservedAt??null,
    entryTimeSource:p?.entryTimeSource??row.entryTimeSource??null,
    lastAddAt:p?.lastAddAt??row.lastAddAt??null,
    addCount:p?.addCount??row.addCount??null,
    lastReviewAt:p?.lastReviewAt??row.lastReviewAt??null,
    humanManagedAt:p?.humanManagedAt??row.humanManagedSince??null,
  };
}
const holding=(row:any)=>holdingDuration(holdingFacts(row),now.value);
const moments=(row:any)=>cycleMoments(holdingFacts(row));
const openedText=(row:any)=>{
  const facts=holdingFacts(row);
  if(!facts.openedAt)return '未知';
  const source=entryTimeSourceLabel(facts.entryTimeSource);
  return `${new Date(facts.openedAt).toLocaleString()}${source?` · ${source}`:''}`;
};
const environment=computed(()=>s.settings?.connections?.exchange?.environment??null);
const accountSource=computed(()=>s.snapshot?.account?.source??null);
const cycleKey=(row:any)=>positionCycleKey(holdingFacts(row),environment.value,accountSource.value);
const severityLabel=(value:string)=>({LOW:'低',MEDIUM:'中',HIGH:'高',CRITICAL:'严重'}[value]??value);
const sideLabel=(value:string)=>value==='LONG'?'多头':value==='SHORT'?'空头':value;
const funding=(row:any)=>row.fundingAttributionStatus==='EXACT'&&row.fundingImpact!==null?money(row.fundingImpact):'未知';
async function load(){data.value=await api.humanManaged();}
async function hold(row:any){
  if(busyId.value)return;
  busyId.value=row.positionId;feedback.value='';
  try{
    const result=await api.acknowledgeHumanManaged(row.positionId,'人工确认继续持有；不改变 TP，不发送交易所订单');
    feedback.value=`${row.symbol} 已记录“保持持仓”；交易所写入=${result.exchangeWrite?'是':'否'}`;
    await load();
  }catch(e){feedback.value=String(e);}finally{busyId.value=null;}
}
onMounted(async()=>{await load();timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},15000);});
onUnmounted(()=>{if(timer)window.clearInterval(timer);});
</script>

<template>
  <div class="page-stack human-managed-page">
    <div class="page-intro">
      <div><p class="eyebrow">HUMAN_MANAGED</p><h2>待人工处置</h2><p>人工扛单专用中心。严重度仅用于风险排序，不授权自动止损、超时平仓或 panic-close。</p></div>
      <button class="button secondary" @click="load">刷新</button>
    </div>

    <div v-if="data.summary" class="kpi-grid four">
      <Panel title="待处置持仓"><strong class="kpi-value">{{ data.summary.count }}</strong></Panel>
      <Panel title="待处置名义"><strong class="kpi-value">{{ money(data.summary.notionalUsd) }}</strong></Panel>
      <Panel title="浮动盈亏"><strong class="kpi-value">{{ money(data.summary.unrealizedPnl) }}</strong></Panel>
      <Panel title="新增风险门禁"><strong class="kpi-value">{{ data.summary.newEntryBlockedByCaps ? '已阻止' : '可用' }}</strong></Panel>
    </div>

    <div v-if="feedback" class="feedback">{{ feedback }}</div>
    <EmptyState v-if="!data.items?.length" title="当前没有待人工处置仓位"/>

    <article v-for="row in data.items" :key="cycleKey(row)" class="management-card">
      <div class="position-card-head">
        <div><span class="eyebrow">{{ row.symbol }}</span><strong>{{ sideLabel(row.side) }} · 严重度 {{ severityLabel(row.severity) }}（{{ row.severityScore }}）</strong></div>
        <span class="mode-pill">HUMAN_MANAGED</span>
      </div>
      <div class="holding-line">
        <strong data-holding-duration="">{{ holding(row).text }}</strong>
        <small data-holding-provenance="">{{ holding(row).detail }}</small>
      </div>
      <div class="facts wide console-facts">
        <div><dt>数量</dt><dd>{{ row.qty }}</dd></div>
        <div><dt>入场价 / 标记价</dt><dd>{{ row.entry }} / {{ row.mark }}</dd></div>
        <div><dt>浮动盈亏</dt><dd>{{ money(row.unrealizedPnl) }} · {{ pct(row.unrealizedPnlPercent) }}</dd></div>
        <div><dt>名义 / 保证金</dt><dd>{{ money(row.notional) }} / {{ money(row.margin) }}</dd></div>
        <div><dt>杠杆</dt><dd>{{ row.leverage }}x</dd></div>
        <div data-position-cycle-key=""><dt>周期标识</dt><dd class="mono">{{ cycleKey(row) }}</dd></div>
        <div><dt>建仓时间</dt><dd>{{ openedText(row) }}</dd></div>
        <div><dt>进入人工处置</dt><dd>{{ row.humanManagedSince ? new Date(row.humanManagedSince).toLocaleString() : '未知' }}</dd></div>
        <div><dt>TP 状态 / 价格</dt><dd>{{ row.tpStatus }} / {{ row.tpPrice ?? '—' }}</dd></div>
        <div><dt>距离 TP</dt><dd>{{ row.distanceToTpPct===null?'—':row.distanceToTpPct.toFixed(2)+'%' }}</dd></div>
        <div><dt>资金费影响</dt><dd>{{ funding(row) }} · {{ row.fundingAttributionStatus }}</dd></div>
        <div><dt>组合敞口贡献</dt><dd>{{ row.portfolioExposureContributionPct.toFixed(2) }}%</dd></div>
        <div><dt>名义 / 权益</dt><dd>{{ row.equityNotionalPct.toFixed(2) }}%</dd></div>
        <div><dt>同底层资产敞口贡献</dt><dd>{{ row.underlyingExposureContributionPct.toFixed(2) }}%</dd></div>
        <div><dt>TP 来源</dt><dd>{{ row.tpSource }}</dd></div>
      </div>
      <div class="cycle-moments" data-cycle-moments=""><small v-for="m in moments(row)" :key="m.key" data-cycle-moment="">{{ m.text }}</small></div>
      <div class="action-grid">
        <button class="button secondary" :disabled="busyId===row.positionId" @click="hold(row)">保持持仓</button>
        <button class="button primary" @click="selectedId=selectedId===row.positionId?null:row.positionId">{{ selectedId===row.positionId?'收起处置控制台':'打开处置控制台' }}</button>
      </div>
      <p class="muted">处置控制台继续使用现有唯一人工链：修改/重建 TP、Reduce、Emergency Close 均进入原有人工 Intent / Dispatcher / AccountExecutor；本页面不新增第二套退出链。</p>
      <PositionConsole v-if="selectedId===row.positionId" :position-id="row.positionId" @close="selectedId=null"/>
    </article>
  </div>
</template>
