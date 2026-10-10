<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import FactBars from './FactBars.vue';
import FinanceRiskAtlas from './FinanceRiskAtlas.vue';
import {stale} from '../utils/performanceFacts';
import PerformanceTrend from './PerformanceTrend.vue';
import {financePerformance} from '../utils/financePerformance';
import {numberOrNull,withSampleGaps} from '../utils/performanceFacts';
type Observation={at:number;version:number|null;available:Record<string,number|null>;profit:Record<string,number|null>;positions:number|null;protected:number|null;entries:number|null;entryFills:number|null;exitFills:number|null};
const props=defineProps<{snapshot:any;accountRead:any;trade24h:any;now:number}>();
const assets=computed(()=>financePerformance(props.snapshot,props.now,props.accountRead));
const ledger=computed(()=>props.trade24h?.source==='ENGINE_RETAINED_CLOSED_COMPLETE_LINKED_CYCLES'&&!stale(props.trade24h.asOf,props.now)?props.trade24h.byAsset:null);
const account=computed(()=>props.snapshot?.account??null);
const valuation=computed(()=>!stale(account.value?.asOf,props.now)&&account.value?.status==='READY'&&assets.value.every(a=>a.available!==null)&&account.value?.valuation?.status==='RECONCILED'?account.value.valuation:null);
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
  if(lastAt&&at-lastAt<14000&&at>=lastAt)return;
  const version=numberOrNull(props.snapshot?.snapshotVersion);
  if((lastVersion!==null&&version!==null&&version<lastVersion)||at<lastAt)observations.value=[];
  lastAt=at;lastVersion=version;
  const profit:Record<string,number|null>={},available:Record<string,number|null>={};
  for(const a of assets.value)available[a.asset]=a.available;
  for(const name of ['USDT','USDC'])profit[name]=numberOrNull(ledger.value?.[name]?.netExFunding);
  const p:Observation={at,version,available,profit,positions:positions.value,protected:protectedCount.value,
    entries:numberOrNull(props.snapshot?.executionTruth?.activeCommissions?.remoteConfirmedEntry),
    entryFills:numberOrNull(props.snapshot?.exchangeFillFacts?.entryFillsLast1h),
    exitFills:numberOrNull(props.snapshot?.exchangeFillFacts?.exitFillsLast1h)};
  // A returned 24h ledger can refresh between snapshot ticks; preserve that corrected point at the same timestamp.
  const index=observations.value.findIndex(x=>x.at===at);
  if(index>=0)observations.value[index]=p;
  else observations.value.push(p);
  if(observations.value.length>360)observations.value.splice(0,observations.value.length-360);
},{immediate:true});
const chart=(key:'available'|'profit',asset:string)=>withSampleGaps(observations.value.map(row=>({ts:row.at,value:row[key][asset]??null})),30_000);
const countChart=(key:'positions'|'protected'|'entries'|'entryFills'|'exitFills')=>withSampleGaps(observations.value.map(row=>({ts:row.at,value:row[key]})),30_000);
const exchange=computed(()=>{const x=props.snapshot?.performanceTracking?.rolling?.exchange;return x?.status==='READY'&&x?.source==='BINANCE_INCOME'&&!stale(x.fetchedAt,props.now,3600000)?x:null;});
const incomeRows=computed(()=>[
 {label:'交易净额（已含手续费）',value:numberOrNull(exchange.value?.tradingNetExFunding)},
 {label:'资金费',value:numberOrNull(exchange.value?.funding),offset:numberOrNull(exchange.value?.tradingNetExFunding)??0},
 {label:'全口径净额',value:numberOrNull(exchange.value?.allInNet)}]);
const riskRows=computed(()=>[{label:'本地持仓',value:positions.value},{label:'本地 TP 已覆盖',value:protectedCount.value},
 {label:'本地 TP 缺口',value:positions.value===null?null:positions.value-(protectedCount.value??0),color:'#d94c52'}]);
const exposureRows=computed(()=>[{label:'LONG 名义敞口',value:!stale(props.snapshot?.ts,props.now)?numberOrNull(props.snapshot?.portfolioIntelligence?.longNotionalUsd):null},{label:'SHORT 名义敞口',value:!stale(props.snapshot?.ts,props.now)?numberOrNull(props.snapshot?.portfolioIntelligence?.shortNotionalUsd):null}]);
const balanceRows=(record:any)=>[{label:'钱包余额',value:record.balance?.wallet??null},{label:'可用资金',value:record.balance?.available??null,color:({bad:'#d94c52',warn:'#d49b30',good:'#14976b'} as any)[record.balance?.tone]??'#8795a8'},
 {label:'保证金权益',value:numberOrNull(record.asset==='USDT'?valuation.value?.usdtMarginEquityUsd:valuation.value?.usdcMarginEquityUsd)}];
const pnlRows=(record:any)=>['grossProfit','grossLoss','netExFunding'].map((k,i)=>({label:['盈利','亏损','净额（不含资金费）'][i]!,value:record.pnl?.cycles>0?numberOrNull(record.pnl[k]):null}));
const lastUpdated=computed(()=>assets.value.find(a=>a.asOf)?.asOf??null);
</script>
<template>
 <section class="cockpit-top" aria-label="驾驶舱关键资金交易趋势" data-cockpit-top>
  <div class="cockpit-head">
   <div><span class="cockpit-overline">PORTFOLIO / REALTIME</span><h2>Portfolio · 资金与收益</h2><p>交易所签名余额 · 已证明完整周期盈亏 · 持仓与委托独立计量</p></div>
   <div class="cockpit-fresh" :title="'交易所资产时间 '+(lastUpdated?new Date(lastUpdated).toLocaleString():'未提供')">
     <span class="fresh-point" :class="lastUpdated?'observed':'not-observed'"></span>{{lastUpdated?'签名资产 '+new Date(lastUpdated).toLocaleTimeString('zh-CN',{hour12:false}):'等待签名余额'}}
   </div>
  </div>
  <div class="cockpit-overview-metrics">
   <div><span>稳定币保证金权益</span><strong>{{usd(valuation?.combinedStablecoinMarginEquityUsd)}}</strong><small>USDT / USDC，同账户核算；不包含 BTC</small></div>
   <div><span>持仓浮动盈亏</span><strong :class="tones(valuation?.combinedStablecoinUnrealizedPnlUsd)">{{usd(valuation?.combinedStablecoinUnrealizedPnlUsd)}}</strong><small>未实现，不等于已结算收益</small></div>
   <div><span>持仓 / 本地 TP 保护</span><strong>{{positionsLabel}} <em>/ {{protectedCount??'—'}}</em></strong><small>需独立签名全仓 TP 核验</small></div>
   <div><span>账户钱包基线变化</span><strong :class="tones(snapshot?.performanceTracking?.baseline?.combinedWalletGain)">{{usd(valuation?snapshot?.performanceTracking?.baseline?.combinedWalletGain:null)}}</strong><small>包含划转及资金费，不能当交易净利润</small></div>
  </div>
  <div class="finance-first-screen" data-finance-first-screen>
   <article><h3>可用资金 · 原生币种</h3><FactBars :rows="records.map(r=>({label:r.asset,value:r.balance?.available??null,color:({bad:'#d94c52',warn:'#d49b30',good:'#14976b'} as any)[r.balance?.tone]??'#8795a8'}))" unit="USDT / USDC 分别计量" label="双币种可用资金"/></article>
   <article><h3>七日交易所收益 · 资金费</h3><FactBars :rows="incomeRows" unit="USD · 已含手续费，资金费单列" label="交易所收益结构"/></article>
  </div>
  <FinanceRiskAtlas :snapshot="snapshot" :valuation="valuation" :now="now"/>
  <div class="cockpit-grid">
   <article v-for="record in records" :key="record.asset" class="cockpit-card" :data-asset-chart="record.asset">
    <div class="card-head"><span class="card-kicker">AVAILABLE MARGIN</span><span class="availability" :class="record.balance?.tone??'unknown'"><i></i>{{record.balance?.tone==='bad'?'低于 500':record.balance?.tone==='warn'?'500–999':record.balance?.tone==='good'?'充足':'待同步'}}</span></div>
    <h3>{{record.asset}} 可用资金</h3>
    <strong class="money-big">{{native(record.balance?.available,record.asset,3)}}</strong>
    <small>钱包余额 {{native(record.balance?.wallet,record.asset,3)}} · {{record.balance?.source??'签名来源待同步'}}</small>
    <FactBars :rows="balanceRows(record)" :unit="record.asset" :label="record.asset+'余额结构'"/>
    <PerformanceTrend v-if="chart('available',record.asset).filter(p=>p.value!==null).length>1" :points="chart('available',record.asset)" :unit="record.asset" :label="record.asset+'可用资金'" funding-thresholds/>
    <small v-else>历史趋势等待第二个真实采样点</small>
    <div class="card-bottom"><span>过去24h已核实平仓</span><strong>{{record.pnl?.cycles??'—'}} 笔</strong></div>
   </article>
   <article class="cockpit-card" data-exchange-income>
    <div class="card-head"><span class="card-kicker">EXCHANGE INCOME / 7D</span><span class="soft-tag">交易所账户口径</span></div>
    <h3>七日收益与资金费</h3><FactBars :rows="incomeRows" unit="USD · Engine 已估值口径" label="七日交易所收益瀑布"/>
    <small>REALIZED_PNL + COMMISSION；手续费已计入，不重复扣除。资金费独立列示。划转 {{usd(exchange?.cashFlow)}}。</small>
    <small>缓存收入采样 {{exchange?new Date(exchange.fetchedAt).toLocaleString():'—'}} · {{exchange?'BINANCE_INCOME':'来源不可用或过期'}}，不代表周期资金费归因完整。</small>
   </article>
   <article class="cockpit-card pnl-card" data-cockpit-pnl>
    <div class="card-head"><span class="card-kicker">REALIZED PNL / 24H</span><span class="soft-tag">不含资金费 · 双币种</span></div>
    <h3>平仓盈利 / 亏损</h3>
    <div v-for="record in records" :key="record.asset" class="pnl-asset">
     <div class="pnl-line"><b>{{record.asset}}</b><strong :class="tones(record.pnl?.netExFunding)">{{native(record.pnl?.cycles>0?record.pnl.netExFunding:null,record.asset)}}</strong></div>
     <div class="pnl-stats"><span>盈利 {{native(record.pnl?.grossProfit,record.asset)}}</span><span>亏损 {{native(record.pnl?.grossLoss,record.asset)}}</span></div>
     <small>盈利 {{record.pnl?.winningCycles??'—'}} / 亏损 {{record.pnl?.losingCycles??'—'}} · 手续费 {{native(record.pnl?.totalFees,record.asset)}}</small>
     <FactBars :rows="pnlRows(record)" :unit="record.asset" label="24小时本地账本盈亏"/>
     <PerformanceTrend v-if="chart('profit',record.asset).filter(p=>p.value!==null).length>1" :points="chart('profit',record.asset)" :unit="record.asset" :label="record.asset+'滚动24小时净收益'"/>
    </div>
    <small class="notice">仅核实已结算周期 · 资金费未证明的不计入正式全口径净收益 · {{trade24h?.status??'账本待同步'}}</small>
   </article>
   <article class="cockpit-card" data-cockpit-position-chart>
    <div class="card-head"><span class="card-kicker">POSITION / PROTECTION</span><span class="soft-tag">当前实例</span></div>
    <h3>持仓与成交监测</h3>
    <div class="position-strip"><div><small>当前持仓</small><strong>{{positions??'—'}}</strong></div><div><small>本地 TP 保护</small><strong>{{protectedCount??'—'}}</strong></div><div><small>本地建仓订单</small><strong>{{snapshot?.entryOrders?.length??'—'}}</strong></div></div>
    <PerformanceTrend v-if="countChart('positions').filter(p=>p.value!==null).length>1" :points="countChart('positions')" unit="笔" label="当前持仓数量"/>
    <FactBars v-else :rows="riskRows" unit="笔 · 本地投影，非签名门禁" label="持仓与TP风险"/>
    <FactBars :rows="exposureRows" unit="USD 名义敞口 · 独立风险口径，非钱包资产" label="多空风险敞口"/>
    <div class="card-bottom"><span>最近1小时交易所 Entry / Exit 成交事实</span><strong>{{snapshot?.exchangeFillFacts?.entryFillsLast1h??'—'}} / {{snapshot?.exchangeFillFacts?.exitFillsLast1h??'—'}}</strong></div>
   </article>
   <article class="cockpit-card transaction-card" data-cockpit-fill-chart>
    <div class="card-head"><span class="card-kicker">EXCHANGE FILLS / 1H</span><span class="soft-tag">交易所成交事实</span></div>
    <h3>成交记录 · 滚动窗口</h3>
    <div class="position-strip"><div><small>Entry fills</small><strong>{{snapshot?.exchangeFillFacts?.entryFillsLast1h??'—'}}</strong></div><div><small>Exit fills</small><strong>{{snapshot?.exchangeFillFacts?.exitFillsLast1h??'—'}}</strong></div><div><small>已平仓周期</small><strong>{{snapshot?.exchangeFillFacts?.closedTradesLast1h??'—'}}</strong></div></div>
    <PerformanceTrend v-if="countChart('entryFills').filter(p=>p.value!==null).length>1" :points="countChart('entryFills')" unit="笔" label="最近1小时Entry方向成交数量"/>
    <PerformanceTrend v-if="countChart('exitFills').filter(p=>p.value!==null).length>1" :points="countChart('exitFills')" unit="笔" label="最近1小时Exit方向成交数量"/>
    <div v-if="countChart('entryFills').filter(p=>p.value!==null).length<2" class="chart-awaiting">成交趋势积累中 · 1小时计数随页面实际采样</div>
    <p class="notice">Entry / Exit 为滚动1小时独立计数，不等于新增订单数；外部、未归因及部分成交不能推算为完整交易盈利。</p>
   </article>
  </div>
  <p class="cockpit-disclaimer">当前页面实采 {{observations.length}} 点；超过30秒间隔断线。折线仅为当前页面打开后的实际采样（最多360点），不代表完整历史曲线；24h盈亏按结算时间窗口，不等于走势图采样窗口。不同币种不相加。数据不可用时显示“—”并保留来源提示，不填充虚假余额。</p>
 </section>
</template>
<style scoped>
.cockpit-top{display:grid;gap:15px;min-width:0}
.finance-first-screen{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.finance-first-screen article{min-width:0;border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:10px 14px}.finance-first-screen h3{font-size:12px;margin:0 0 4px}
.cockpit-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:21px 24px;border-radius:16px;color:#e8f2fe;background:linear-gradient(117deg,#102945,#245681)}
.cockpit-overline,.card-kicker{font-size:10px;font-weight:750;letter-spacing:.12em}.cockpit-overline{color:#94c1ec}.cockpit-head h2{margin:6px 0;font-size:22px}.cockpit-head p{margin:0;color:#c5ddef;font-size:12px}
.cockpit-fresh{font-size:11px;border-radius:99px;border:1px solid #7fa3be;padding:7px 11px;display:flex;align-items:center;gap:8px;white-space:nowrap}.fresh-point{height:8px;width:8px;border-radius:50%;background:#8496a4}.fresh-point.observed{background:#3bcc99}
.cockpit-overview-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.cockpit-overview-metrics>div{display:grid;gap:5px;min-width:0;background:var(--surface);border:1px solid var(--line);padding:15px;border-radius:13px}
.cockpit-overview-metrics span,.cockpit-overview-metrics small{color:var(--muted);font-size:11px}.cockpit-overview-metrics strong{font-size:22px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.cockpit-overview-metrics em{font-size:14px;font-style:normal;color:var(--muted)}.cockpit-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px}
.cockpit-card{grid-column:span 6;min-width:0;overflow:hidden;padding:17px 18px;border:1px solid var(--line);border-radius:14px;background:var(--surface);display:grid;gap:9px;align-content:start}
.card-head,.pnl-line,.card-bottom{display:flex;justify-content:space-between;align-items:center;gap:8px}.card-kicker{color:var(--muted)}.soft-tag{font-size:10px;color:var(--muted);white-space:nowrap}
.cockpit-card h3{margin:0;font-size:14px;font-weight:650}.money-big{font-size:26px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;letter-spacing:-.02em}.cockpit-card small{font-size:10px;line-height:1.6;color:var(--muted)}
.availability{font-size:10px;display:flex;align-items:center;gap:5px}.availability i{width:7px;height:7px;border-radius:50%;background:#8795a8}.availability.bad i{background:#d94c52}.availability.warn i{background:#d49b30}.availability.good i{background:#14976b}
.chart-awaiting{min-height:104px;display:grid;place-items:center;font-size:11px;border-radius:9px;background:var(--background);color:var(--muted)}
.card-bottom{margin-top:auto;padding-top:10px;border-top:1px solid var(--line);font-size:11px}.card-bottom>span{color:var(--muted)}
.pnl-card{gap:12px}.pnl-asset{display:grid;gap:5px;padding-top:8px;border-top:1px solid var(--line)}.pnl-asset:first-of-type{border-top:0}.pnl-line strong{font-size:17px;font-variant-numeric:tabular-nums}.pnl-stats{display:flex;gap:12px;flex-wrap:wrap;font-size:11px}.pnl-stats span:first-child{color:var(--green)}.pnl-stats span:last-child{color:var(--red)}
.transaction-card{grid-column:1/-1}.position-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.position-strip>div{display:grid;gap:4px;padding:10px;background:var(--background);border-radius:9px}.position-strip strong{font-size:23px;font-variant-numeric:tabular-nums}
.positive{color:var(--green)!important}.negative{color:var(--red)!important}.notice,.cockpit-disclaimer{color:var(--muted);font-size:10px;line-height:1.7}.cockpit-disclaimer{margin:0}
@media(max-width:1150px){.cockpit-overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:780px){.cockpit-grid{grid-template-columns:1fr}.cockpit-card{grid-column:1/-1}.cockpit-head{padding:17px}.cockpit-overview-metrics strong{font-size:19px}}
@media(max-width:480px){.cockpit-top{gap:8px}.cockpit-head{padding:10px}.cockpit-head h2{font-size:17px}.cockpit-head p{display:none}.cockpit-overview-metrics>div{padding:8px}.cockpit-overview-metrics small{font-size:9px}.cockpit-overview-metrics strong{font-size:17px}.finance-first-screen{grid-template-columns:1fr;gap:6px}.finance-first-screen article{padding:5px 10px}.finance-first-screen .fact-bars{max-height:120px}}
</style>
