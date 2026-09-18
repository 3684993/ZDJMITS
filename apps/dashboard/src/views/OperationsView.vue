<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useSystemStore } from '../stores/system';
import { api } from '../api/client';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { age } from '../format';

const s=useSystemStore(), details=ref<any>(null), shadow=ref<any>(null), cleanup=ref<any>(null), runtime=ref<any>(null), governance=ref<any>(null), cleanupBusy=ref(false);
const statusMap:Record<string,string>={HEALTHY:'正常',READY:'就绪',RUNNING:'运行中',DEGRADED:'降级',RECOVERING:'恢复中',FAILED:'故障',BLOCKED:'已阻断',OFFLINE:'离线'};
function open(h:any){details.value=h;}
async function loadShadow(){try{const [nextShadow,nextCleanup,nextRuntime,nextGovernance]=await Promise.all([api.shadowReadiness(),api.cleanupPreview(),api.runtimeStatus(),api.binanceGovernance()]);shadow.value=nextShadow;cleanup.value=nextCleanup;runtime.value=nextRuntime;governance.value=nextGovernance;}catch{}}
async function runCleanup(){if(cleanupBusy.value)return;cleanupBusy.value=true;try{cleanup.value=await api.cleanupRun();}finally{cleanupBusy.value=false;}}
onMounted(loadShadow);
</script>

<template>
  <div class="page-stack">
    <Panel title="运行中心" subtitle="高级运维信息以中文摘要呈现；原始 stream、stale symbols、gaps、queue 和 lastError 只在详情查看">
      <div class="health-grid"><div v-for="h in s.snapshot?.health??[]" :key="h.id" class="health-card"><div><strong>{{({'trading-network':'交易网络',market:'行情中心',pool:'动态交易池',ai:'AI 引擎',reconciliation:'交易所对账',tp:'止盈保护',persistence:'数据与审计'} as any)[h.id]??h.label}}</strong><span>{{statusMap[h.status]??h.status}}</span></div><div><StatusBadge :value="h.status"/><button class="button tiny secondary" @click="open(h)">查看详情</button><small>{{age(h.updatedAt)}}</small></div></div></div>
    </Panel>
    <Panel title="Runtime & LAN" subtitle="同源 Web/API/WS 与 Supervisor 状态">
      <dl class="facts wide"><div><dt>PID / Uptime</dt><dd>{{runtime?.pid??'—'}} / {{runtime?.uptimeMs?Math.floor(runtime.uptimeMs/1000)+'s':'—'}}</dd></div><div><dt>Listener / LAN URL</dt><dd>{{runtime?.listener?.host??'—'}}:{{runtime?.listener?.port??'—'}} · {{runtime?.lanUrls?.join(' / ')??'—'}}</dd></div><div><dt>Local / LAN health</dt><dd>{{runtime?.loopbackProbe?.status??'—'}} / {{runtime?.lanProbe?.status??'—'}}</dd></div><div><dt>Network / Firewall</dt><dd>{{runtime?.networkProfile??'—'}} / {{runtime?.firewallRuleState??'—'}}</dd></div><div><dt>Last restart</dt><dd>{{runtime?.lastRestartAt??'—'}} · {{runtime?.lastRestartReason??'—'}}</dd></div><div><dt>Supervisor</dt><dd>{{runtime?.supervisor?.status??'NOT_RUNNING'}} · restarts={{runtime?.restartCount??0}}</dd></div></dl>
    </Panel>
    <Panel title="Binance API Governance" subtitle="固定出口、真实 X-MBX counters、队列 lane 与限流事件；累计值不冒充最近12H">
      <template v-if="governance?.routes?.length">
        <div v-for="route in governance.routes" :key="route.rest?.routeIdentity" class="page-stack">
          <dl class="facts wide">
            <div><dt>Environment / REST</dt><dd>{{route.environment}} / {{route.rest?.host??'—'}}</dd></div>
            <div><dt>WS Host</dt><dd>{{route.ws?.url?new URL(route.ws.url).hostname:'—'}}</dd></div>
            <div><dt>Route Identity</dt><dd>{{route.rest?.routeIdentity??'—'}}</dd></div>
            <div><dt>Proxy</dt><dd>{{route.rest?.throughProxy?'ACTIVE':'BLOCKED'}} · {{route.rest?.proxyUrl??'—'}}</dd></div>
            <div><dt>Expected Egress</dt><dd>{{route.egress?.expectedEgressIp??'未配置'}}</dd></div>
            <div><dt>Verified Egress</dt><dd>{{route.egress?.lastVerifiedEgressIp??'未验证'}} · {{route.egress?.status??'UNVERIFIED'}}</dd></div>
            <div><dt>429 / 418</dt><dd>{{route.requestBudget?.http429??0}} / {{route.requestBudget?.http418??0}}</dd></div>
            <div><dt>Governor</dt><dd>{{route.requestBudget?.status??'—'}} · trust={{route.requestBudget?.observationTrust??'—'}}</dd></div>
          </dl>
          <div class="resource-row" v-for="limit in route.requestBudget?.rateLimits??[]" :key="limit.rateLimitType+':'+limit.intervalNum+limit.interval">
            <strong>{{limit.rateLimitType}} {{limit.intervalNum}}{{limit.interval}}</strong>
            <span>observed={{limit.observedCount}} / limit={{limit.limit??'—'}} · headroom={{limit.headroom??'—'}} · {{limit.usageRatio==null?'—':(limit.usageRatio*100).toFixed(1)+'%'}} · reset={{new Date(limit.resetAt).toLocaleTimeString()}}</span>
          </div>
          <div class="resource-row" v-for="(lane,name) in route.requestBudget?.laneStats??{}" :key="name">
            <strong>{{name}}</strong><span>queued={{lane.queued}} · admitted={{lane.admitted}} · deferred={{lane.deferred}} · blocked={{lane.blocked}} · timeout={{lane.timeout}}</span>
          </div>
        </div>
      </template><span v-else class="muted">尚无活动 Binance route；Engine OFF 时属于预期状态。</span>
    </Panel>
    <Panel title="Shadow Readiness" subtitle="只读统计；到期只进入人工复核，不会恢复 AUTO">
      <dl class="facts wide"><div><dt>状态</dt><dd>{{shadow?.status??'加载中'}}</dd></div><div><dt>样本 / VALID / INVALID</dt><dd>{{shadow?.sampleCount??0}} / {{shadow?.validCount??0}} / {{shadow?.invalidCount??0}}</dd></div><div><dt>Decision Chain 覆盖</dt><dd>{{shadow?((shadow.decisionChainCoverage*100).toFixed(1)+'%'):'—'}}</dd></div><div><dt>连续性缺口</dt><dd>{{shadow?.restartContinuity?.gapCount??0}}</dd></div><div><dt>AUTO</dt><dd>冻结 · autoResume=false</dd></div><div><dt>有效观测开始</dt><dd>{{shadow?.validObservationStartedAt??'—'}}</dd></div><div><dt>有效观测截止</dt><dd>{{shadow?.validObservationRequiredUntil??'—'}}</dd></div><div><dt>硬拒绝 / Shadow-only</dt><dd>{{shadow?.hardRejects??0}} / {{shadow?.shadowOnlyAi?.runs??0}}</dd></div><div><dt>Mark覆盖</dt><dd>{{shadow?.markSeriesCoverage?.samples??0}}</dd></div><div><dt>小浮亏候选</dt><dd>{{cleanup?.eligible?.length??0}}</dd></div></dl><div class="button-row"><button class="button secondary" @click="loadShadow">刷新 Readiness / Preview</button><button v-if="cleanup?.eligible?.length" class="button danger" :disabled="cleanupBusy" @click="runCleanup">{{cleanupBusy?'执行中…':'人工授权 Testnet LIMIT 清理'}}</button></div>
    </Panel>
    <Panel title="运行事实"><dl class="facts wide"><div><dt>候选全集</dt><dd>{{s.snapshot?.universe.total??0}}</dd></div><div><dt>可选候选</dt><dd>{{s.snapshot?.universe.eligible??0}}</dd></div><div><dt>交易池</dt><dd>{{s.pool.length}}</dd></div><div><dt>活动建仓委托</dt><dd>{{s.snapshot?.account.activeEntryOrders??s.snapshot?.account.pendingEntries??0}}</dd></div><div><dt>活动止盈委托</dt><dd>{{s.snapshot?.account.activeTpOrders??0}}</dd></div><div><dt>持仓</dt><dd>{{s.snapshot?.account.activePositions??0}}</dd></div><div><dt>实时通道</dt><dd>{{s.connected?'已连接':'重连中'}}</dd></div><div><dt>数据时间</dt><dd>{{s.snapshot?new Date(s.snapshot.ts).toLocaleString():'未知'}}</dd></div></dl></Panel>
    <Panel v-if="details" title="详情 Drawer"><pre class="mono">{{JSON.stringify(details,null,2)}}</pre></Panel>
    <div class="policy-card"><strong>生产接入原则</strong><span>浏览器只访问 Engine 同源 API/WS；交易所私有凭证不暴露给前端；真实写操作始终由服务端 Adapter 执行并进入审计链。</span></div>
  </div>
</template>
