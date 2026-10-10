<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import Panel from './Panel.vue';
import PerformanceTrend from './PerformanceTrend.vue';
import {financePerformance} from '../utils/financePerformance';
import {withSampleGaps,type LampTone} from '../utils/performanceFacts';
const props=defineProps<{snapshot:unknown;now:number;rangeMs:number;instanceId:string|null}>();
const facts=computed(()=>financePerformance(props.snapshot,props.now));
type Sample={ts:number;facts:ReturnType<typeof financePerformance>};
const history=ref<Sample[]>([]);let instance:string|null=null;
watch(()=>[props.snapshot,props.instanceId,props.now],()=>{
 if(instance!==props.instanceId){history.value=[];instance=props.instanceId;}
 if(!instance)return;
 const ts=(props.snapshot as any)?.account?.asOf;
 if(typeof ts!=='number'||ts>props.now||props.now-ts>60000)return;
 if(history.value.at(-1)?.ts===ts)return;
 // No storage of account balances on disk or across Engine instances.
 history.value.push({ts,facts:facts.value});if(history.value.length>720)history.value.splice(0,history.value.length-720);
},{immediate:true});
const labels:Record<LampTone,string>={bad:'红 · 低于500',warn:'黄 · 500–999.99',good:'绿 · 至少1000',unknown:'灰 · UNKNOWN / 过期'};
const number=(n:number|null)=>n===null?'UNKNOWN':n.toFixed(2);
function points(asset:string,key:'available'|'exFundingNet'|'allInNet'|'unrealized'){
 return withSampleGaps(history.value.filter(p=>p.ts>=props.now-props.rangeMs).map(p=>({ts:p.ts,value:p.facts.find(f=>f.asset===asset)?.[key]??null})),60000);
}
</script>
<template>
 <Panel title="资金可用与收益趋势" subtitle="USDT、USDC分别展示。资金颜色仅提示余额；收益来自按币种归因的完整交易，不把钱包变化当收益。">
  <p class="finance-note">可用资金：低于500红色，500–999.99黄色，至少1000绿色；缺失/过期灰色。历史仅覆盖本页同一Engine实际采样时间，未覆盖时段不补0。</p>
  <div class="finance-grid">
   <article v-for="fact in facts" :key="fact.asset" :class="['finance-card',fact.tone]">
    <h3>{{fact.asset}} 可用资金</h3><strong class="finance-value">{{number(fact.available)}} {{fact.asset}}</strong><p>{{labels[fact.tone]}}</p>
    <small>私有采样 {{fact.asOf?new Date(fact.asOf).toLocaleString('zh-CN',{hour12:false}):'UNKNOWN'}}</small>
    <PerformanceTrend :points="points(fact.asset,'available')" :unit="fact.asset" :label="fact.asset+'可用资金趋势'" funding-thresholds/>
    <dl><div><dt>完整交易净收益（不含资金费）</dt><dd>{{number(fact.exFundingNet)}} {{fact.asset}}</dd></div><div><dt>已确认含资金费净收益</dt><dd>{{number(fact.allInNet)}} {{fact.asset}}</dd></div><div><dt>资金费准确归因 / 完整cycle</dt><dd>{{fact.canonicalEligible??'UNKNOWN'}} / {{fact.completeCycles??'UNKNOWN'}}</dd></div><div><dt>当前未实现盈亏</dt><dd>{{number(fact.unrealized)}} {{fact.asset}}</dd></div></dl>
    <PerformanceTrend :points="points(fact.asset,'exFundingNet')" :unit="fact.asset" :label="fact.asset+'累计交易净收益趋势（不含资金费）'"/>
    <PerformanceTrend :points="points(fact.asset,'unrealized')" :unit="fact.asset" :label="fact.asset+'未实现盈亏趋势'"/>
   </article>
  </div>
 </Panel>
</template>
<style scoped>
.finance-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.finance-card{border:1px solid var(--line);border-top:4px solid #8795a8;border-radius:12px;padding:14px;min-width:0}.finance-card.bad{border-top-color:#dc2626}.finance-card.warn{border-top-color:#d97706}.finance-card.good{border-top-color:#16803c}.finance-value{font-size:24px;overflow-wrap:anywhere}.finance-card.bad .finance-value{color:#dc2626}.finance-card.warn .finance-value{color:#d97706}.finance-card.good .finance-value{color:#16803c}.finance-card h3{font-size:14px}.finance-card p,.finance-card small,.finance-note{font-size:11px;color:var(--muted)}dl>div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;font-size:11px}dd{margin:0;text-align:right;overflow-wrap:anywhere}@media(max-width:950px){.finance-grid{grid-template-columns:1fr}}
</style>
