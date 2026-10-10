<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref} from 'vue';
import {RouterLink} from 'vue-router';
import {api,brainRuns} from '../api/client';
import {useSystemStore} from '../stores/system';
import Panel from '../components/Panel.vue';
import PerformanceTrend from '../components/PerformanceTrend.vue';
import FinancePerformance from '../components/FinancePerformance.vue';
import {aiLamp,privateLamp,uniqueAiRunStats,numberOrNull,stale,withSampleGaps,type LampFact} from '../utils/performanceFacts';
import {cockpitSignals,effectiveProxySignal} from '../utils/cockpitStatus';
import type {HostPerformanceRead,GpuPerformanceRead} from '@zdj/contracts';

const store=useSystemStore();
const hostRead=ref<HostPerformanceRead|null>(null),gpuRead=ref<GpuPerformanceRead|null>(null),resources=ref<any[]>([]),governance=ref<any>(null);
const privateSync=ref<any>(null),stream=ref<any>(null),runs=ref<any[]>([]),accountRead=ref<any>(null);
const checkedAt=ref<number|null>(null),error=ref<string|null>(null),windowKey=ref('1h');
const options=[{value:'15m',label:'15 分钟',ms:900_000},{value:'1h',label:'1 小时',ms:3_600_000},{value:'6h',label:'6 小时',ms:21_600_000},{value:'24h',label:'24 小时',ms:86_400_000},{value:'7d',label:'7 天',ms:604_800_000}];
const rangeMs=computed(()=>options.find(x=>x.value===windowKey.value)?.ms??3_600_000);
const now=ref(Date.now());
const host=computed(()=>hostRead.value&&!stale(hostRead.value.asOf,now.value,hostRead.value.ttlMs??30000)?hostRead.value:null);
const gpu=computed(()=>gpuRead.value?.measureStatus==='MEASURED'&&!stale(gpuRead.value.asOf,now.value,45000)?gpuRead.value:null);
const stamp=(n:unknown)=>numberOrNull(n)===null?'UNKNOWN':new Date(Number(n)).toLocaleString('zh-CN',{hour12:false});
const val=(n:unknown,digits=1)=>numberOrNull(n)===null?'UNKNOWN':Number(n).toFixed(digits);
const mib=(n:unknown)=>numberOrNull(n)===null?'UNKNOWN':val(Number(n)/1048576,0)+' MiB';
const lampClass=(fact:LampFact)=>'perf-light '+fact.tone;
const lampLabel=(fact:LampFact)=>fact.text;
const privateFact=computed(()=>privateLamp(store.snapshot,now.value));
const proxyFact=computed(()=>effectiveProxySignal(governance.value?.routes,store.snapshot,now.value));
const statusRows=computed(()=>cockpitSignals({snapshot:store.snapshot,routes:governance.value?.routes,resources:resources.value,incidents:store.incidents.active,now:now.value}).map(row=>({name:row.label,...row})));
const runFacts=computed(()=>uniqueAiRunStats(runs.value));
const cutOff=computed(()=>now.value-rangeMs.value);
const history=computed(()=>{
  const items=hostRead.value?.history??[];
  return items.filter(p=>p.instanceId===hostRead.value?.instanceId&&p.asOf>=cutOff.value).sort((a,b)=>a.asOf-b.asOf);
});
const cpuPoints=computed(()=>withSampleGaps(history.value.map(p=>({ts:p.asOf,value:p.cpu.usagePct})),30000));
const ramPoints=computed(()=>withSampleGaps(history.value.map(p=>({ts:p.asOf,value:p.memory.usedBytes===null?null:p.memory.usedBytes/1048576})),30000));
const memoryPct=computed(()=>{
  const m=host.value?.memory;
  return m&&m.usedBytes!==null&&m.totalBytes!==null&&m.totalBytes>0?Math.round(m.usedBytes/m.totalBytes*1000)/10:null;
});
const protectedPositions=computed(()=>store.snapshot?.positions?.filter(p=>p.tpStatus==='PROTECTED').length??null);
const activePositions=computed(()=>store.snapshot?.positions?.length??null);
const finance=computed(()=>store.snapshot?.localAccounting??null);
const names:Record<string,string>={SCOUT:'Scout',PRIMARY_BRAIN:'Primary / 建仓',REVIEW_BRAIN:'Review / 复核'};
const gpuExpected=[{title:'Scout · 8081',port:8081},{title:'Review · 8083',port:8083},{title:'Primary · 8084',port:8084}];
const gpuServices=computed(()=>gpuExpected.map(service=>({...service,sample:gpu.value?.services.find(s=>s.port===service.port)})));
function gpuPoints(port:number){const current=gpu.value?.services.find(s=>s.port===port);return withSampleGaps((gpuRead.value?.history??[]).filter(s=>s.instanceId===gpuRead.value?.instanceId&&s.asOf>=cutOff.value).map(s=>{const p=s.services.find(p=>p.port===port);return{ts:s.asOf,value:p?.pid===current?.pid&&p?.processStartedAt===current?.processStartedAt&&p?.measureStatus==='MEASURED'?p.utilizationPct:null};}),45000);}
let timer:ReturnType<typeof setInterval>|null=null,inFlight=false,alive=true,sequence=0;
let controller:AbortController|null=null,deadline:ReturnType<typeof setTimeout>|null=null;
async function load(){
  if(inFlight||typeof document!=='undefined'&&document.visibilityState!=='visible')return;
  inFlight=true;const id=++sequence;now.value=Date.now();
  controller=new AbortController();const signal=controller.signal;deadline=setTimeout(()=>controller?.abort(),8000);
  const from=now.value-rangeMs.value;
  const q=new URLSearchParams({page:'1',limit:'100',from:String(from)});
  const results=await Promise.allSettled([
    api.performanceHost(signal),api.brainResources(signal),api.binanceGovernance(signal),
    api.privateSync(signal),api.marketStreamTraffic(signal),brainRuns(q.toString(),signal),api.performanceGpu(signal),
    typeof api.accountAssets==='function'?api.accountAssets(signal):Promise.resolve(null),
  ]);
  if(deadline)clearTimeout(deadline);deadline=null;
  if(!alive||id!==sequence){inFlight=false;return;}
  now.value=Date.now();
  let failures=0;
  function take<T>(index:number,update:(v:T)=>void,clear:()=>void){
    const r=results[index];
    if(r?.status==='fulfilled')update(r.value as T);
    else {failures++;clear();}
  }
  take<HostPerformanceRead>(0,v=>hostRead.value=v,()=>hostRead.value=null);
  take<any[]>(1,v=>resources.value=Array.isArray(v)?v:[],()=>resources.value=[]);
  take<any>(2,v=>governance.value=v,()=>governance.value=null);
  take<any>(3,v=>privateSync.value=v,()=>privateSync.value=null);
  take<any>(4,v=>stream.value=v,()=>stream.value=null);
  take<any>(5,v=>runs.value=Array.isArray(v?.items)?v.items:[],()=>runs.value=[]);
  take<GpuPerformanceRead>(6,v=>gpuRead.value=v,()=>gpuRead.value=null);
  take<any>(7,v=>accountRead.value=v,()=>accountRead.value=null);
  error.value=failures?failures+' 个只读数据源请求失败，当前指标 UNKNOWN':null;
  checkedAt.value=now.value;
  inFlight=false;
}
function changeWindow(value:string){windowKey.value=value;void load();}
function visibility(){if(document.visibilityState==='visible')void load();else controller?.abort();}
onMounted(()=>{alive=true;void load();timer=setInterval(()=>{now.value=Date.now();void load();},15_000);document.addEventListener('visibilitychange',visibility);});
onUnmounted(()=>{alive=false;sequence++;controller?.abort();if(deadline)clearTimeout(deadline);if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',visibility);});
</script>

<template>
  <div class="page-stack perf-page">
    <div class="perf-hero">
      <div><p class="perf-kicker">OBSERVABILITY · READ ONLY</p><h2>性能监控</h2><p>真实采样 · 断连告警 · AI任务与交易保护。未接入的 GPU/PCI/SSH 计数器显示 UNKNOWN，不使用模拟值。</p></div>
      <div class="perf-meta"><span>Engine {{host?.engine.pid??'UNKNOWN'}}</span><span>采样 {{stamp(host?.asOf)}}</span><span>原生主机采样 · 每 10s 最多一次</span></div>
    </div>
    <div class="perf-toolbar">
      <div class="segmented" aria-label="查看时间范围">
        <button v-for="item in options" :key="item.value" type="button" :class="{active:windowKey===item.value}" :aria-pressed="windowKey===item.value" @click="changeWindow(item.value)">{{item.label}}</button>
      </div>
      <span class="perf-small">本机采样只有当前 Engine 的短窗内存历史；不将 6h/24h/7d 当作已有完整覆盖</span>
    </div>
    <p v-if="error" class="perf-warning" role="status">{{error}}</p>
    <Panel title="关键链路状态灯" subtitle="圆点反映最近可验证的链路事实；文字只显示状态，不重复颜色名称。">
      <div class="perf-lamp-grid">
        <article v-for="row in statusRows" :key="row.name" class="perf-lamp-card">
          <div class="perf-light-row"><span class="perf-light-dot" :class="lampClass(row)"></span><strong>{{row.name}}</strong></div>
          <span :class="lampClass(row)">{{lampLabel(row)}}</span>
          <small>{{row.detail}}</small>
        </article>
        <article v-if="!resources.length" class="perf-lamp-card"><strong>AI 模型</strong><span class="perf-light unknown">资源待确认</span><small>不推断模型健康状态</small></article>
      </div>
    </Panel>
    <div class="perf-kpis">
      <div class="perf-kpi"><span>整机 CPU（原生采样）</span><strong>{{val(host?.cpu.usagePct)}}<small v-if="host?.cpu.usagePct!==null&&host?.cpu.usagePct!==undefined">%</small></strong><small>CPU tick 增量 · 首次采样 UNKNOWN</small></div>
      <div class="perf-kpi"><span>系统内存占用</span><strong>{{val(memoryPct)}}<small v-if="memoryPct!==null">%</small></strong><small>{{mib(host?.memory.usedBytes)}} / {{mib(host?.memory.totalBytes)}}</small></div>
      <div class="perf-kpi"><span>Engine RSS / Heap</span><strong class="perf-kpi-compact">{{mib(host?.engine.rssBytes)}}</strong><small>Heap Used {{mib(host?.engine.heapUsedBytes)}}</small></div>
      <div class="perf-kpi"><span>受保护的当前持仓</span><strong>{{protectedPositions===null?'UNKNOWN':protectedPositions}} / {{activePositions===null?'UNKNOWN':activePositions}}</strong><small>来源 DashboardSnapshot；不替代最新交易所签名TP核验</small></div>
    </div>
    <FinancePerformance :snapshot="store.snapshot" :account-read="accountRead" :now="now" :range-ms="rangeMs" :instance-id="hostRead?.instanceId??null"/>
    <div class="perf-columns">
      <Panel title="主机 CPU 趋势" subtitle="Windows 原生 CPU time 差分；只有实际采样点"><PerformanceTrend :points="cpuPoints" unit="%" label="CPU使用率"/><p class="perf-small">数据点 {{cpuPoints.length}} · 当前实例 {{host?.instanceId??'UNKNOWN'}}</p></Panel>
      <Panel title="主机内存趋势" subtitle="已用物理内存 · MiB"><PerformanceTrend :points="ramPoints" unit="MiB" label="物理内存"/><p class="perf-small">可用 {{mib(host?.memory.freeBytes)}} · 来源 {{host?.source??'UNKNOWN'}}</p></Panel>
    </div>
    <Panel title="模型进程 GPU · Windows 实测" subtitle="WDDM进程最忙引擎占用（不相加）；显存是该PID各适配器之和。物理PCI归属须独立核验，不能以卡序号推断。">
      <div class="perf-gpu-grid">
        <div v-for="service in gpuServices" :key="service.port" class="perf-gpu"><strong>{{service.title}}</strong><small>来源 {{gpu?.sampleSource??'UNKNOWN'}} · {{stamp(gpu?.asOf)}}</small>
          <dl><div><dt>进程最忙GPU引擎</dt><dd>{{val(service.sample?.utilizationPct)}} %</dd></div><div><dt>专用 / 共享显存</dt><dd>{{mib(service.sample?.dedicatedBytes)}} / {{mib(service.sample?.sharedBytes)}}</dd></div><div><dt>服务 PID · PCI绑定</dt><dd>{{service.sample?.pid??'UNKNOWN'}} · UNVERIFIED</dd></div></dl>
          <PerformanceTrend :points="gpuPoints(service.port)" unit="%" :label="service.title+'进程GPU'"/>
        </div>
      </div>
    </Panel>
    <div class="perf-columns">
      <Panel title="AI 模型与推理任务" subtitle="真实资源状态取 /brain/resources；P95 是最近最多100条已返回 run 的有限样本，不代表全历史。">
        <div class="perf-models">
          <article v-for="r in resources" :key="r.id" class="perf-model">
            <div><strong>{{r.id}}</strong><span :class="lampClass(aiLamp(r,now))">{{lampLabel(aiLamp(r,now))}}</span></div>
            <small>{{r.model}} · {{r.baseUrl}} · {{r.role}}</small>
            <dl><div><dt>当前任务</dt><dd>{{r.currentSymbol??'空闲'}}</dd></div><div><dt>Active / Queue</dt><dd>{{r.active??'UNKNOWN'}} / {{r.queueDepth??'UNKNOWN'}}</dd></div><div><dt>累计运行 / 失败</dt><dd>{{r.totalRuns??'UNKNOWN'}} / {{r.failures??'UNKNOWN'}}</dd></div><div><dt>最近推理延迟</dt><dd>{{r.lastLatencyMs==null?'UNKNOWN':r.lastLatencyMs+' ms'}}</dd></div></dl>
          </article>
          <p v-if="!resources.length" class="perf-small">尚无已核实的模型资源记录</p>
        </div>
        <p class="perf-small">物理GPU分配、真实tokens/s、首token延迟：UNKNOWN，需本机模型计数器和PID/LUID证据，不能以输出tokens/总wall time冒充tokens/s。</p>
      </Panel>
      <Panel title="最近自然任务 · 排队 P95" subtitle="按稳定 run ID 去重；有上限100条，非完整事件库。">
        <div class="perf-models">
          <article v-for="r in runFacts.byRole" :key="r.role" class="perf-model">
            <strong>{{names[r.role]??r.role}}</strong>
            <dl><div><dt>本页样本任务</dt><dd>{{r.count}}</dd></div><div><dt>失败</dt><dd>{{r.failed}}</dd></div><div><dt>排队P95</dt><dd>{{r.queuedP95Ms===null?'UNKNOWN':r.queuedP95Ms+' ms'}}</dd></div><div><dt>队列时间覆盖</dt><dd>{{r.timingSamples}} / {{r.count}}</dd></div></dl>
          </article>
        </div>
        <RouterLink class="perf-link" to="/brain">查看 AI 大脑详细运行记录 →</RouterLink>
      </Panel>
    </div>
    <div class="perf-columns">
      <Panel title="SOCKS / Binance REST / WS" subtitle="不会因浏览器访问而重新请求交易所；仅展示 Engine 已收集的诊断。">
        <dl class="perf-facts">
          <div><dt>代理路由</dt><dd>{{proxyFact.text}}</dd></div>
          <div><dt>REST预算来源</dt><dd>{{governance?.budgets?'Engine request budgets':'UNKNOWN'}}</dd></div>
          <div><dt>私有同步</dt><dd>{{privateSync?.sync?.status??store.snapshot?.account.status??'UNKNOWN'}}</dd></div>
          <div><dt>WS 市场状态</dt><dd>{{stream?.state??'UNKNOWN'}}</dd></div>
          <div><dt>WS 解码计量</dt><dd>{{stream?.unit??'UNKNOWN'}}</dd></div>
          <div><dt>HTTP 451 / 502 · SSH wire bytes</dt><dd>UNKNOWN · UNKNOWN</dd></div>
        </dl>
        <p class="perf-small">451 不直接归咎代理；HTTP 状态、SOCKS握手、SSH链路与交易所限制必须分层验证。WS 解码 payload 不是 SSH 传输字节数。</p>
      </Panel>
      <Panel title="交易流水线与盈亏事实" subtitle="只展示经过各自数据合同的数值；跨窗口转化率、部分成交与物理cycle 去重待专项事实层。">
        <dl class="perf-facts">
          <div><dt>当前动态候选池</dt><dd>{{store.snapshot?.pool?.length??'UNKNOWN'}}</dd></div>
          <div><dt>挂单（本地投影）</dt><dd>{{store.snapshot?.entryOrders?.length??'UNKNOWN'}}</dd></div>
          <div><dt>当前仓位 / TP Protected</dt><dd>{{activePositions??'UNKNOWN'}} / {{protectedPositions??'UNKNOWN'}}</dd></div>
          <div><dt>账户未实现盈亏 (USD)</dt><dd>{{store.snapshot?.account.unrealizedPnlUsd==null?'UNKNOWN':val(store.snapshot.account.unrealizedPnlUsd,2)}}</dd></div>
          <div><dt>本地确认净收益，不含资金费</dt><dd>UNKNOWN（币种归因待核验）</dd></div>
          <div><dt>资金费归因 UNKNOWN cycles</dt><dd>{{finance?.fundingUnknownCycles??'UNKNOWN'}}</dd></div>
          <div><dt>全口径确认净收益</dt><dd>UNKNOWN（币种归因待核验）</dd></div>
          <div><dt>同一 origin 漏斗转化率 / 回撤</dt><dd>UNKNOWN / UNKNOWN</dd></div>
        </dl>
        <p class="perf-small">上述本地交易收益为累计范围，并非筛选时间窗；不可与钱包变化相加。USDT/USDC未独立确认换汇或资金费不完整时，不构造假净收益。</p>
      </Panel>
    </div>
    <div class="perf-foot">刷新只读诊断 15 秒（隐藏页面暂停）；最后请求 {{stamp(checkedAt)}}。状态灯反映已有证据，不是自动交易或代理切换指令。GPU调度与TP改价均未在本页启用。</div>
  </div>
</template>

<style scoped>
.perf-page{--perf-soft:rgba(51,92,151,.05);color:var(--text);min-width:0}.perf-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;background:linear-gradient(118deg,#122c50,#1c4d79);color:white;border-radius:18px;padding:24px}.perf-hero h2{font-size:25px;margin:4px 0 8px}.perf-hero p{margin:0;color:#d7e6f4;font-size:12px;line-height:1.7;max-width:720px}.perf-kicker{font-size:10px!important;color:#a7c7e6!important;letter-spacing:.16em;font-weight:700}.perf-meta{display:grid;gap:7px;text-align:right;font-size:11px;color:#dceafa;white-space:nowrap}.perf-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.perf-small{color:var(--muted);font-size:11px;line-height:1.65}.perf-warning{padding:12px;border:1px solid #e8b86c;color:#935a04;background:var(--amber-soft);border-radius:10px}.perf-lamp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.perf-lamp-card{padding:13px;background:var(--perf-soft);border:1px solid var(--line);border-radius:12px;min-width:0;display:grid;gap:7px}.perf-lamp-card strong{font-size:12px}.perf-lamp-card small{color:var(--muted);font-size:10px;line-height:1.5}.perf-light-row{display:flex;align-items:center;gap:8px}.perf-light-dot{height:9px;width:9px;border-radius:50%;display:inline-block;flex:none;background:#8795a8}.perf-light-dot.good{background:var(--green)}.perf-light-dot.warn{background:var(--amber)}.perf-light-dot.bad{background:var(--red)}.perf-light{font-size:11px;font-weight:700}.perf-light.good{color:var(--green)}.perf-light.warn{color:var(--amber)}.perf-light.bad{color:var(--red)}.perf-light.unknown{color:var(--muted)}.perf-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.perf-kpi{padding:17px;border:1px solid var(--line);border-radius:14px;background:var(--surface);display:grid;gap:8px;min-width:0}.perf-kpi>span{font-size:11px;color:var(--muted)}.perf-kpi strong{font-size:25px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.perf-kpi strong small{font-size:12px}.perf-kpi-compact{font-size:20px!important}.perf-kpi>small{font-size:10px;color:var(--muted)}.perf-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.perf-gpu-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.perf-gpu{padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--perf-soft)}.perf-gpu strong,.perf-gpu small{display:block}.perf-gpu strong{font-size:13px}.perf-gpu small{font-size:10px;color:var(--muted);margin:6px 0 14px}.perf-gpu dl{margin:0}.perf-gpu dl>div,.perf-model dl>div,.perf-facts>div{display:flex;justify-content:space-between;gap:9px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--line)}.perf-gpu dl>div:last-child,.perf-model dl>div:last-child,.perf-facts>div:last-child{border:0}.perf-gpu dt,.perf-model dt,.perf-facts dt{font-size:10px;color:var(--muted)}.perf-gpu dd,.perf-model dd,.perf-facts dd{margin:0;font-size:11px;font-weight:700;text-align:right;overflow-wrap:anywhere}.perf-models{display:grid;gap:11px}.perf-model{border:1px solid var(--line);border-radius:10px;padding:13px;min-width:0}.perf-model>div:first-child{display:flex;justify-content:space-between;gap:8px;align-items:center}.perf-model strong{font-size:12px}.perf-model>small{font-size:10px;color:var(--muted);display:block;margin:5px 0 9px;overflow-wrap:anywhere}.perf-model dl,.perf-facts{margin:8px 0}.perf-link{font-size:11px;color:var(--blue);font-weight:700}.perf-foot{font-size:11px;color:var(--muted);text-align:center;padding:10px}
@media(max-width:950px){.perf-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.perf-lamp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.perf-gpu-grid{grid-template-columns:1fr}.perf-columns{grid-template-columns:1fr}.perf-meta{text-align:left}.perf-hero{flex-direction:column}}
@media(max-width:560px){.perf-hero{padding:18px}.perf-kpis,.perf-lamp-grid{grid-template-columns:1fr}.perf-toolbar .segmented{overflow:auto;max-width:100%;white-space:nowrap}.perf-page :deep(.panel-body){padding:8px 12px 16px}}
</style>
