<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue';
import {api} from '../api/client';
import Panel from '../components/Panel.vue';
import LegacyTradeRecordsView from './TradeRecordsViewLegacy.vue';
import {money} from '../format';
import {financialClass} from '../positionModel';
const summary=ref<any>(null);let timer:ReturnType<typeof setInterval>|null=null;
async function refresh(){try{summary.value=(await api.tradeRecords('page=1&limit=1&category=COMPLETE')).summary}catch{}}
onMounted(()=>{void refresh();timer=setInterval(()=>void refresh(),30_000)});onUnmounted(()=>{if(timer)clearInterval(timer)});
</script>
<template>
  <div class="page-stack">
    <Panel title="V3.9.3 交易经济资格" subtitle="账本闭环、ex-funding 与正式含 funding 收益是独立资格；此区域只读，不触发回填或对账。">
      <div class="kpi-grid five">
        <div class="kpi"><span>CLOSED COMPLETE</span><strong>{{summary?.closedCompleteCount??'—'}}</strong><small>不要求 funding EXACT</small></div>
        <div class="kpi"><span>Trading net ex-funding</span><strong>{{summary?money(summary.tradingNetExFunding??0):'—'}}</strong><small>{{summary?.tradingNetExFundingEligibleCount??'—'}} 条合格账本</small></div>
        <div class="kpi"><span>正式净收益合格交易数</span><strong>{{summary?.canonicalPnlEligibleCount??'—'}}</strong><small>{{summary?.canonicalNetPnlStatus??'—'}}</small></div>
        <div class="kpi"><span>Canonical net PnL</span><strong :class="financialClass(summary?.canonicalNetPnl)">{{summary?.canonicalNetPnl==null?'—':money(summary.canonicalNetPnl)}}</strong><small>eligible=0 时不显示 0</small></div>
        <div class="kpi"><span>Funding UNKNOWN / Legacy</span><strong>{{summary?.fundingUnknownCount??'—'}} / {{summary?.legacyEconomicInconsistentCount??'—'}}</strong><small>不等于账本缺失</small></div>
      </div>
      <p class="muted">Prospective：{{summary?.prospective?.status??'—'}}；Entry {{summary?.prospective?.entryCycleCount??'—'}} / Closed {{summary?.prospective?.closedCycleCount??'—'}} / Canonical {{summary?.prospective?.canonicalPnlEligibleCount??'—'}}。缺 Manifest 时保持“—”，不会伪装成 0。</p>
      <p class="muted">下方兼容控制台中的 <code>completed</code> 字段仅为旧客户端兼容别名，语义等同“正式净收益合格交易数”，不是 CLOSED COMPLETE 数。</p>
    </Panel>
    <LegacyTradeRecordsView />
  </div>
</template>
