<script setup lang="ts">
import {computed} from 'vue';
import {numberOrNull,stale} from '../utils/performanceFacts';

/** Independent financial facts: account equity, gross risk notional, funding attribution,
 * and live-order proof are NOT components of one interchangeable "capital" total. */
const props=defineProps<{snapshot:any;valuation:any|null;now:number}>();
const fresh=computed(()=>!stale(props.snapshot?.ts,props.now,60_000));
const nonnegative=(v:unknown)=>{const n=numberOrNull(v);return n!==null&&n>=0?n:null;};
const count=(v:unknown)=>{const n=nonnegative(v);return n!==null&&Number.isInteger(n)?n:null;};
const money=(v:number)=>v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const equity=computed(()=>{
 if(!fresh.value||props.snapshot?.account?.status!=='READY'||stale(props.snapshot?.account?.asOf,props.now,60_000)||!props.valuation)return null;
 const usdt=nonnegative(props.valuation.usdtMarginEquityUsd),usdc=nonnegative(props.valuation.usdcMarginEquityUsd),total=nonnegative(props.valuation.combinedStablecoinMarginEquityUsd);
 if(usdt===null||usdc===null||total===null||total<=0||Math.abs(usdt+usdc-total)>Math.max(0.02,total*0.00001))return null;
 return {usdt,usdc,total,usdtPct:usdt/total*100,usdcPct:usdc/total*100};
});
const exposure=computed(()=>{
 if(!fresh.value)return null;
 const long=nonnegative(props.snapshot?.portfolioIntelligence?.longNotionalUsd),short=nonnegative(props.snapshot?.portfolioIntelligence?.shortNotionalUsd);
 if(long===null||short===null)return null;
 const total=long+short;
 return {long,short,longPct:total?long/total*100:0,shortPct:total?short/total*100:0};
});
const funding=computed(()=>{
 if(!fresh.value)return null;
 const local=props.snapshot?.performanceTracking?.rolling?.local;
 const cycles=count(local?.completeCycles),unknown=count(local?.fundingUnknownCycles);
 if(cycles===null||unknown===null||unknown>cycles)return null;
 return {cycles,unknown,known:cycles-unknown,missingPct:cycles?unknown/cycles*100:0};
});
const orders=computed(()=>{
 if(!fresh.value)return null;
 const comm=props.snapshot?.executionTruth?.activeCommissions;
 const confirmedTp=count(comm?.remoteConfirmedTakeProfit),confirmedEntry=count(comm?.remoteConfirmedEntry),localUnknown=count(comm?.localUnresolvedUnknown);
 return confirmedTp===null||confirmedEntry===null||localUnknown===null?null:{confirmedTp,confirmedEntry,localUnknown,max:Math.max(1,confirmedTp,confirmedEntry,localUnknown)};
});
const orderWidth=(v:number,max:number)=>Math.min(100,v/max*100);
</script>
<template>
 <section class="finance-atlas" aria-label="资金及执行证据仪表盘" data-finance-atlas>
  <article class="atlas-card" data-finance-atlas-equity>
   <div class="atlas-heading"><h3>权益构成</h3><span>交易所估值 · USD</span></div>
   <template v-if="equity">
    <div class="equity-main">
     <svg viewBox="0 0 120 120" role="img" :aria-label="'USDT权益占'+equity.usdtPct.toFixed(1)+'%；USDC权益占'+equity.usdcPct.toFixed(1)+'%'">
      <circle cx="60" cy="60" r="44" stroke="#a0afc0" stroke-width="12" fill="none" opacity=".16"/>
      <circle cx="60" cy="60" r="44" stroke="#329bb5" stroke-width="12" fill="none" transform="rotate(-90 60 60)" :stroke-dasharray="`${equity.usdtPct/100*276.46} 276.46`"/>
      <circle cx="60" cy="60" r="44" stroke="#8277c8" stroke-width="12" fill="none" transform="rotate(-90 60 60)" :stroke-dasharray="`${equity.usdcPct/100*276.46} 276.46`" :stroke-dashoffset="-equity.usdtPct/100*276.46"/>
      <text x="60" y="60" text-anchor="middle" class="ring-text">STABLE</text>
      <text x="60" y="73" text-anchor="middle" class="ring-small">EQUITY</text>
     </svg>
     <div class="atlas-values">
      <div><i class="dot usdt"></i><span>USDT</span><strong>${{money(equity.usdt)}}</strong><small>{{equity.usdtPct.toFixed(1)}}%</small></div>
      <div><i class="dot usdc"></i><span>USDC</span><strong>${{money(equity.usdc)}}</strong><small>{{equity.usdcPct.toFixed(1)}}%</small></div>
     </div>
    </div>
    <p class="atlas-foot">合计 ${{money(equity.total)}} · 两币种估值之和校验通过；BTC 不包含</p>
   </template>
   <p v-else class="atlas-empty">— · 缺少同一新鲜签名账户的可核对双币种权益</p>
  </article>

  <article class="atlas-card" data-finance-atlas-exposure>
   <div class="atlas-heading"><h3>多空敞口结构</h3><span>名义价值 · USD</span></div>
   <template v-if="exposure">
    <div class="atlas-values tall">
     <div><i class="dot long"></i><span>LONG</span><strong>${{money(exposure.long)}}</strong><small>{{exposure.longPct.toFixed(1)}}%</small></div>
     <div><i class="dot short"></i><span>SHORT</span><strong>${{money(exposure.short)}}</strong><small>{{exposure.shortPct.toFixed(1)}}%</small></div>
    </div>
    <div class="split-bar" role="img" :aria-label="'多单名义占'+exposure.longPct.toFixed(1)+'%，空单占'+exposure.shortPct.toFixed(1)+'%'">
     <span class="long" :style="{width:exposure.longPct+'%'}"></span><span class="short" :style="{width:exposure.shortPct+'%'}"></span>
    </div>
    <p class="atlas-foot">多空为持仓名义敞口，并非资产余额；百分比为两侧名义合计内的构成</p>
   </template>
   <p v-else class="atlas-empty">— · 组合敞口缺少新鲜的独立投影</p>
  </article>

  <article class="atlas-card" data-finance-atlas-funding>
   <div class="atlas-heading"><h3>资金费归因覆盖</h3><span>本地完整 cycle</span></div>
   <template v-if="funding">
    <div class="atlas-tally"><strong>{{funding.unknown}}</strong><span>/ {{funding.cycles}} 笔资金费 UNKNOWN</span></div>
    <div class="split-bar" role="img" :aria-label="'资金费未知'+funding.unknown+'笔，共'+funding.cycles+'笔'">
     <span class="missing" :style="{width:funding.missingPct+'%'}"></span><span class="unproven" :style="{width:(100-funding.missingPct)+'%'}"></span>
    </div>
    <div class="atlas-values"><div><i class="dot missing"></i><span>未知归因</span><strong>{{funding.unknown}}</strong></div><div><i class="dot unproven"></i><span>其余周期</span><strong>{{funding.known}}</strong></div></div>
    <p class="atlas-foot">其余周期不等于全口径收益已合格；缺手续费或守恒证明时仍保持 UNKNOWN</p>
   </template>
   <p v-else class="atlas-empty">— · 没有可核对的完整周期及资金费缺口</p>
  </article>

  <article class="atlas-card" data-finance-atlas-orders>
   <div class="atlas-heading"><h3>订单证据分层</h3><span>笔数 · 不互相相加</span></div>
   <template v-if="orders">
    <div v-for="row in [{label:'交易所确认 TP',value:orders.confirmedTp,tone:'remote'},{label:'交易所确认 Entry',value:orders.confirmedEntry,tone:'entry'},{label:'本地未决 UNKNOWN',value:orders.localUnknown,tone:'unknown'}]" :key="row.label" class="order-row">
     <div><span>{{row.label}}</span><strong>{{row.value}}</strong></div>
     <div class="order-track"><span :class="row.tone" :style="{width:orderWidth(row.value,orders.max)+'%'}"></span></div>
    </div>
    <p class="atlas-foot">本地 UNKNOWN 不是交易所活动挂单；本地 TP 数也不能替代新鲜签名 TP 核验</p>
   </template>
   <p v-else class="atlas-empty">— · 活动委托的权威来源分层未确认</p>
  </article>
 </section>
</template>
<style scoped>
.finance-atlas{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;min-width:0}
.atlas-card{min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:205px}
.atlas-heading{display:flex;justify-content:space-between;align-items:baseline;gap:5px;flex-wrap:wrap}.atlas-heading h3{margin:0;font-size:13px;font-weight:700}.atlas-heading span,.atlas-foot,.atlas-empty{color:var(--muted);font-size:10px;line-height:1.6}.atlas-foot{margin:auto 0 0}.atlas-empty{margin:auto 0;min-height:72px;display:grid;place-items:center}
.equity-main{display:flex;gap:8px;align-items:center;min-width:0}.equity-main svg{width:104px;min-width:84px;height:104px}.equity-main svg .ring-text{font-size:11px;font-weight:700;fill:var(--text)}.equity-main svg .ring-small{font-size:8px;fill:var(--muted)}
.atlas-values{display:grid;gap:9px;min-width:0;flex:1}.atlas-values>div{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0}.atlas-values strong{font-variant-numeric:tabular-nums;font-size:12px;overflow-wrap:anywhere}.atlas-values small{font-size:10px;color:var(--muted)}.atlas-values span{font-size:10px;min-width:32px}.atlas-values.tall{align-content:start;flex:0}.dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex-shrink:0}.dot.usdt,.dot.long{background:#329bb5}.dot.usdc,.dot.short{background:#8277c8}.dot.missing{background:#d49b30}.dot.unproven{background:#99a7b5}
.split-bar,.order-track{width:100%;height:14px;border-radius:7px;overflow:hidden;display:flex;background:var(--background)}.split-bar>span,.order-track>span{height:100%}.split-bar .long{background:#329bb5}.split-bar .short{background:#8277c8}.split-bar .missing{background:#d49b30}.split-bar .unproven{background:#99a7b5}
.atlas-tally{display:flex;align-items:baseline;gap:5px}.atlas-tally strong{font-size:27px;font-variant-numeric:tabular-nums;color:var(--text)}.atlas-tally span{font-size:11px;color:var(--muted)}
.order-row{display:grid;gap:5px}.order-row>div:first-child{display:flex;justify-content:space-between;gap:8px;font-size:11px}.order-row strong{font-variant-numeric:tabular-nums}.order-track{height:7px}.order-track .remote{background:#329bb5}.order-track .entry{background:#8277c8}.order-track .unknown{background:#d49b30}
@media(max-width:1400px){.finance-atlas{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:680px){.finance-atlas{grid-template-columns:1fr}.atlas-card{min-height:0}.equity-main svg{height:100px}.atlas-values>div{gap:7px}}
</style>
