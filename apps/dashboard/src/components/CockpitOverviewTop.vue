<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import PerformanceTrend from './PerformanceTrend.vue';
import {financePerformance} from '../utils/financePerformance';
import {numberOrNull,withSampleGaps} from '../utils/performanceFacts';
type Observation={at:number;version:number|null;available:Record<string,number|null>;profit:Record<string,number|null>;positions:number|null;protected:number|null;entries:number|null};
const props=defineProps<{snapshot:any;accountRead:any;trade24h:any;now:number}>();
const assets=computed(()=>financePerformance(props.snapshot,props.now,props.accountRead));
const ledger=computed(()=>props.trade24h?.byAsset??null);
const account=computed(()=>props.snapshot?.account??null);
const valuation=computed(()=>account.value?.valuation??null);
const positions=computed(()=>Array.isArray(props.snapshot?.positions)?props.snapshot.positions.length:null);
const protectedCount=computed(()=>Array.isArray(props.snapshot?.positions)?props.snapshot.positions.filter((p:any)=>p.tpStatus==='PROTECTED').length:null);
const positionsLabel=computed(()=>positions.value===null?'—':String(positions.value));
const records=computed(()=>['USDT','USDC'].map(asset=>({asset,balance:assets.value.find(x=>x.asset===asset),pnl:ledger.value?.[asset]??null})));
const usd=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)
  ?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value):'—';
const native=(value:unknown,asset:string,digits=2)=>typeof value==='number'&&Number.isFinite(value)
  ?new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value)+' '+asset:'—';
const tones=(amount:unknown)=>typeof amount!=='number'||!Number.isFinite(amount)?'neutral':amount>0?'positive':amount<0?'negative':'neutral';
const observations=ref<Observation[]>([]);
let lastVersion:number|null=null,lastAt=0;
/** Page-only bounded sampling. A decreasing snapshot version or clock resets the trend.
 * No synthetic baseline, cached 24h history or interpolation across gaps.
 */
watch(()=>[props.snapshot,props.accountRead,props.trade24h,props.now],()=>{
  const at=numberOrNull(props.snapshot?.ts);
  if(at===null||at>props.now+10_000||props.now-at>60_000)return;
  const version=numberOrNull(props.snapshot?.snapshotVersion);
  if((lastVersion!==null&&version!==null&&version<lastVersion)||at<lastAt)observations.value=[];
  lastAt=at;lastVersion=version;
  const profit:Record<string,number|null>={},available:Record<string,number|null>={};
  for(const a of assets.value)available[a.asset]=a.available;
  for(const name of ['USDT','USDC'])profit[name]=numberOrNull(ledger.value?.[name]?.netExFunding);
  const p:Observation={at,version,available,profit,positions:positions.value,protected:protectedCount.value,
    entries:numberOrNull(props.snapshot?.executionTruth?.activeCommissions?.remoteConfirmedEntry)};
  // A returned 24h ledger can refresh between snapshot ticks; preserve that corrected point at the same timestamp.
  const index=observations.value.findIndex(x=>x.at===at);
  if(index>=0)observations.value[index]=p;
  else observations.value.push(p);
  if(observations.value.length>360)observations.value.splice(0,observations.value.length-360);
},{immediate:true});
const chart=(key:'available'|'profit',asset:string)=>withSampleGaps(observations.value.map(row=>({ts:row.at,value:row[key][asset]??null})),30_000);
const countChart=(key:'positions'|'protected'|'entries')=>withSampleGaps(observations.value.map(row=>({ts:row.at,value:row[key]})),30_000);
const lastUpdated=computed(()=>assets.value.find(a=>a.asOf)?.asOf??null);
</script>
<template>
 <section class="cockpit-top" aria-label="驾驶舱关键资金交易趋势" data-cockpit-top>
  <div class="cockpit-head">
   <div><span class="cockpit-overline">PORTFOLIO / REALTIME</span><h2>资金与交易总览</h2><p>交易所签名余额 · 已证明完整周期盈亏 · 持仓与委托独立计量</p></div>
   <div class="cockpit-fresh" :title="'交易所资产时间 '+(lastUpdated?new Date(lastUpdated).toLocaleString():'未提供')">
     <span class="fresh-point" :class="lastUpdated?'observed':'not-observed'"></span>{{lastUpdated?'签名资产 '+new Date(lastUpdated).toLocaleTimeString('zh-CN',{hour12:false}):'等待签名余额'}}
   </div>
  </div>
  <div class="cockpit-overview-metrics">
   <div><span>稳定币保证金权益</span><strong>{{usd(valuation?.combinedStablecoinMarginEquityUsd)}}</strong><small>USDT / USDC，同账户核算；不包含 BTC</small></div>
   <div><span>持仓浮动盈亏</span><strong :class="tones(valuation?.combinedStablecoinUnrealizedPnlUsd)">{{usd(valuation?.combinedStablecoinUnrealizedPnlUsd)}}</strong><small>未实现，不等于已结算收益</small></div>
   <div><span>持仓 / 本地 TP 保护</span><strong>{{positionsLabel}} <em>/ {{protectedCount??'—'}}</em></strong><small>需独立签名全仓 TP 核验</small></div>
   <div><span>账户钱包基线变化</span><strong :class="tones(snapshot?.performanceTracking?.baseline?.combinedWalletGain)">{{usd(snapshot?.performanceTracking?.baseline?.combinedWalletGain)}}</strong><small>包含划转及资金费，不能当交易净利润</small></div>
  </div>
  <div class="cockpit-grid">
   <article v-for="record in records" :key="record.asset" class="cockpit-card" :data-asset-chart="record.asset">
    <div class="card-head"><span class="card-kicker">AVAILABLE MARGIN</span><span class="availability" :class="record.balance?.tone??'unknown'"><i></i>{{record.balance?.available===null?'待同步':record.balance?.available!<500?'低于 500':record.balance?.available!<1000?'500–999':'充足'}}</span></div>
    <h3>{{record.asset}} 可用资金</h3>
    <strong class="money-big">{{native(record.balance?.available,record.asset,3)}}</strong>
    <small>钱包余额 {{native(record.balance?.wallet,record.asset,3)}} · {{record.balance?.source??'签名来源待同步'}}</small>
    <PerformanceTrend v-if="chart('available',record.asset).filter(p=>p.value!==null).length>1" :points="chart('available',record.asset)" :unit="record.asset" :label="record.asset+'可用资金'" funding-thresholds/>
    <div v-else class="chart-awaiting">资金趋势积累中 · 只记录真实采样点</div>
    <div class="card-bottom"><span>过去24h已核实平仓</span><strong>{{record.pnl?.cycles??'—'}} 笔</strong></div>
   </article>
   <article class="cockpit-card pnl-card" data-cockpit-pnl>
    <div class="card-head"><span class="card-kicker">REALIZED PNL / 24H</span><span class="soft-tag">不含资金费 · 双币种</span></div>
    <h3>平仓盈利 / 亏损</h3>
    <div v-for="record in records" :key="record.asset" class="pnl-asset">
     <div class="pnl-line"><b>{{record.asset}}</b><strong :class="tones(record.pnl?.netExFunding)">{{native(record.pnl?.netExFunding,record.asset)}}</strong></div>
     <div class="pnl-stats"><span>盈利 {{native(record.pnl?.grossProfit,record.asset)}}</span><span>亏损 {{native(record.pnl?.grossLoss,record.asset)}}</span></div>
     <small>盈利 {{record.pnl?.winningCycles??'—'}} / 亏损 {{record.pnl?.losingCycles??'—'}} · 手续费 {{native(record.pnl?.totalFees,record.asset)}}</small>
     <PerformanceTrend v-if="chart('profit',record.asset).filter(p=>p.value!==null).length>1" :points="chart('profit',record.asset)" :unit="record.asset" :label="record.asset+'滚动24小时净收益'"/>
    </div>
    <small class="notice">仅核实已结算周期 · 资金费未证明的不计入正式全口径净收益 · {{trade24h?.status??'账本待同步'}}</small>
   </article>
   <article class="cockpit-card" data-cockpit-position-chart>
    <div class="card-head"><span class="card-kicker">POSITION / PROTECTION</span><span class="soft-tag">当前实例</span></div>
    <h3>持仓与成交监测</h3>
    <div class="position-strip"><div><small>当前持仓</small><strong>{{positions??'—'}}</strong></div><div><small>本地 TP 保护</small><strong>{{protectedCount??'—'}}</strong></div><div><small>本地建仓订单</small><strong>{{snapshot?.entryOrders?.length??'—'}}</strong></div></div>
    <PerformanceTrend v-if="countChart('positions').filter(p=>p.value!==null).length>1" :points="countChart('positions')" unit="笔" label="当前持仓数量"/>
    <div v-else class="chart-awaiting">持仓趋势积累中 · 首次页面采样无历史补点</div>
    <div class="card-bottom"><span>最近1小时交易所 Entry / Exit 成交事实</span><strong>{{snapshot?.exchangeFillFacts?.entryFillsLast1h??'—'}} / {{snapshot?.exchangeFillFacts?.exitFillsLast1h??'—'}}</strong></div>
   </article>
  </div>
  <p class="cockpit-disclaimer">折线仅为当前页面打开后的实际采样（最多360点），不代表完整历史曲线；24h盈亏按结算时间窗口，不等于走势图采样窗口。不同币种不相加。数据不可用时显示“—”并保留来源提示，不填充虚假余额。</p>
 </section>
</template>
<style scoped>
.cockpit-top{display:grid;gap:15px;min-width:0}
.cockpit-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:21px 24px;border-radius:16px;color:#e8f2fe;background:linear-gradient(117deg,#102945,#245681)}
.cockpit-overline,.card-kicker{font-size:10px;font-weight:750;letter-spacing:.12em}.cockpit-overline{color:#94c1ec}.cockpit-head h2{margin:6px 0;font-size:22px}.cockpit-head p{margin:0;color:#c5ddef;font-size:12px}
.cockpit-fresh{font-size:11px;border-radius:99px;border:1px solid #7fa3be;padding:7px 11px;display:flex;align-items:center;gap:8px;white-space:nowrap}.fresh-point{height:8px;width:8px;border-radius:50%;background:#8496a4}.fresh-point.observed{background:#3bcc99}
.cockpit-overview-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.cockpit-overview-metrics>div{display:grid;gap:5px;min-width:0;background:var(--surface);border:1px solid var(--line);padding:15px;border-radius:13px}
.cockpit-overview-metrics span,.cockpit-overview-metrics small{color:var(--muted);font-size:11px}.cockpit-overview-metrics strong{font-size:22px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.cockpit-overview-metrics em{font-size:14px;font-style:normal;color:var(--muted)}.cockpit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cockpit-card{min-width:0;overflow:hidden;padding:17px 18px;border:1px solid var(--line);border-radius:14px;background:var(--surface);display:grid;gap:9px;align-content:start}
.card-head,.pnl-line,.card-bottom{display:flex;justify-content:space-between;align-items:center;gap:8px}.card-kicker{color:var(--muted)}.soft-tag{font-size:10px;color:var(--muted);white-space:nowrap}
.cockpit-card h3{margin:0;font-size:14px;font-weight:650}.money-big{font-size:26px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;letter-spacing:-.02em}.cockpit-card small{font-size:10px;line-height:1.6;color:var(--muted)}
.availability{font-size:10px;display:flex;align-items:center;gap:5px}.availability i{width:7px;height:7px;border-radius:50%;background:#8795a8}.availability.bad i{background:#d94c52}.availability.warn i{background:#d49b30}.availability.good i{background:#14976b}
.chart-awaiting{min-height:104px;display:grid;place-items:center;font-size:11px;border-radius:9px;background:var(--background);color:var(--muted)}
.card-bottom{margin-top:auto;padding-top:10px;border-top:1px solid var(--line);font-size:11px}.card-bottom>span{color:var(--muted)}
.pnl-card{gap:12px}.pnl-asset{display:grid;gap:5px;padding-top:8px;border-top:1px solid var(--line)}.pnl-asset:first-of-type{border-top:0}.pnl-line strong{font-size:17px;font-variant-numeric:tabular-nums}.pnl-stats{display:flex;gap:12px;flex-wrap:wrap;font-size:11px}.pnl-stats span:first-child{color:var(--green)}.pnl-stats span:last-child{color:var(--red)}
.position-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.position-strip>div{display:grid;gap:4px;padding:10px;background:var(--background);border-radius:9px}.position-strip strong{font-size:23px;font-variant-numeric:tabular-nums}
.positive{color:var(--green)!important}.negative{color:var(--red)!important}.notice,.cockpit-disclaimer{color:var(--muted);font-size:10px;line-height:1.7}.cockpit-disclaimer{margin:0}
@media(max-width:1150px){.cockpit-overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:780px){.cockpit-grid{grid-template-columns:1fr}.cockpit-head{padding:17px}.cockpit-overview-metrics strong{font-size:19px}}
</style>