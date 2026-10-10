<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { LayoutDashboard, Orbit, BrainCircuit, BriefcaseBusiness, ReceiptText, Database, Activity, Settings, ChartNoAxesCombined, Wifi, WifiOff, RefreshCw, BookOpen, MoreHorizontal, X, ShieldAlert, Gauge } from 'lucide-vue-next';
import { useSystemStore } from '../stores/system';
import {api} from '../api/client';
import CockpitSignalStrip from '../components/CockpitSignalStrip.vue';
import {cockpitSignals} from '../utils/cockpitStatus';
import { isPrimaryMobileRoute, mobileMoreRouteNames, mobilePrimaryRouteNames, routePath } from '../navigation';
import { preloadDashboardRoute, preloadDashboardRoutes } from '../routePreload';
import { RELEASE_LABEL, RELEASE_NAME } from '@zdj/contracts';
const store=useSystemStore(),route=useRoute();
const nav=[['overview','驾驶舱',LayoutDashboard],['universe','智能选币',Orbit],['temporal','市场周期',ChartNoAxesCombined],['intelligence','市场智能',ChartNoAxesCombined],['brain','AI 大脑',BrainCircuit],['positions','持仓',BriefcaseBusiness],['human-managed','待人工处置',ShieldAlert],['orders','订单',ReceiptText],['trade-records','交易记录',BookOpen],['memory','交易记忆',Database],['operations','运行中心',Activity],['performance','性能监控',Gauge],['settings','系统设置',Settings]] as const;
const primaryNames=mobilePrimaryRouteNames,moreNames=mobileMoreRouteNames,moreOpen=ref(false),navigatingTo=ref<string|null>(null);
const primaryNav=computed(()=>nav.filter(([name])=>isPrimaryMobileRoute(name)));
const moreNav=computed(()=>nav.filter(([name])=>moreNames.includes(name as typeof moreNames[number])));
const title=computed(()=>nav.find(x=>x[0]===(navigatingTo.value??route.name))?.[1]??'智多金');
const navigatingLabel=computed(()=>nav.find(x=>x[0]===navigatingTo.value)?.[1]??'页面');
let timer:number|undefined,navigationTimer:number|undefined,signalTimer:number|undefined;
const routes=ref<any[]>([]),resources=ref<any[]>([]),signalNow=ref(Date.now());
const signals=computed(()=>cockpitSignals({snapshot:store.snapshot,routes:routes.value,resources:resources.value,incidents:store.incidents.active,now:signalNow.value}));
let signalLoading=false,signalsAlive=true,signalController:AbortController|null=null;
async function refreshSignals(){
  if(signalLoading||document.visibilityState==='hidden')return;
  signalLoading=true;signalController=new AbortController();const timeout=setTimeout(()=>signalController?.abort(),10000);
  try{
    const result=await Promise.allSettled([api.binanceGovernance(signalController.signal),api.brainResources(signalController.signal)]);
    if(!signalsAlive)return;
    routes.value=result[0]?.status==='fulfilled'?result[0].value?.routes??[]:[];
    resources.value=result[1]?.status==='fulfilled'&&Array.isArray(result[1].value)?result[1].value:[];
    signalNow.value=Date.now();
  }finally{clearTimeout(timeout);signalController=null;signalLoading=false;}
}
function warmRoute(name:string){void preloadDashboardRoute(name).catch(()=>{});}
function beginRoute(name:string){
  if(route.name===name){navigatingTo.value=null;return;}
  navigatingTo.value=name;warmRoute(name);
  if(navigationTimer)clearTimeout(navigationTimer);
  navigationTimer=window.setTimeout(()=>{if(navigatingTo.value===name)navigatingTo.value=null;},8000);
}
function warmDashboard(){
  const run=()=>void preloadDashboardRoutes(String(route.name??''));
  const idle=(window as any).requestIdleCallback as undefined|((cb:()=>void,options?:{timeout:number})=>number);
  if(idle)idle(run,{timeout:1200});else window.setTimeout(run,250);
}
onMounted(()=>{signalsAlive=true;void store.refresh();store.startRealtime();void refreshSignals();timer=window.setInterval(()=>{signalNow.value=Date.now();if(document.visibilityState==='visible')void store.refreshPassive(['SNAPSHOT']);},15000);signalTimer=window.setInterval(()=>void refreshSignals(),15000);warmDashboard();});
onUnmounted(()=>{signalsAlive=false;signalController?.abort();store.stopRealtime();if(timer)clearInterval(timer);if(signalTimer)clearInterval(signalTimer);if(navigationTimer)clearTimeout(navigationTimer);document.body.classList.remove('drawer-open')});
watch(moreOpen,value=>document.body.classList.toggle('drawer-open',value));watch(()=>route.name,()=>{moreOpen.value=false;navigatingTo.value=null;if(navigationTimer)clearTimeout(navigationTimer);});
const linkTo=routePath;
const releaseLabel=RELEASE_LABEL,releaseName=RELEASE_NAME;
</script>
<template>
  <div class="shell">
    <aside class="sidebar"><div class="brand"><div class="brand-mark">智</div><div><strong>智多金</strong><span>{{releaseName}}</span></div></div><nav aria-label="主导航"><RouterLink v-for="[name,label,Icon] in nav" :key="name" :to="linkTo(name)" :class="{active:route.name===name,pending:navigatingTo===name}" :aria-current="route.name===name?'page':undefined" @pointerenter="warmRoute(name)" @focus="warmRoute(name)" @pointerdown="beginRoute(name)" @click="beginRoute(name)"><component :is="Icon" :size="18"/><span>{{label}}</span></RouterLink></nav><div class="sidebar-foot"><div class="connection"><component :is="store.connected?Wifi:WifiOff" :size="15"/><span>{{store.connected?'实时通道在线':'实时通道重连中'}}</span></div><small>{{releaseLabel}} · MANUAL CONSOLE</small></div></aside>
    <main class="workspace"><header class="topbar desktop-topbar"><div><p class="eyebrow">{{releaseLabel}} · MANUAL CONSOLE</p><h1>{{title}}</h1></div><div class="top-actions"><CockpitSignalStrip :signals="signals"/><button class="icon-button" aria-label="刷新" @click="store.refresh()"><RefreshCw :size="17"/></button></div></header><header class="mobile-appbar" aria-label="移动端应用栏"><button class="mobile-brand" aria-label="返回驾驶舱" @click="$router.push('/')"><span class="brand-mark">智</span><span><strong>{{title}}</strong><small>{{releaseLabel}} · {{store.connected?'实时在线':'重连中'}}</small></span></button><div class="mobile-appbar-actions"><CockpitSignalStrip :signals="signals.slice(0,3)"/><button class="icon-button" aria-label="刷新" @click="store.refresh()"><RefreshCw :size="17"/></button></div></header><div v-if="store.error" class="error-banner">{{store.error}}</div><section v-if="store.incidents.active.length" class="incident-stack" aria-label="当前运行告警"><article v-for="incident in store.incidents.active" :key="incident.incidentId" class="incident-banner" role="alert"><strong>{{incident.titleZh}} · {{incident.publicCode}}</strong><p>{{incident.messageZh}} {{incident.remediationZh}}</p><small>最近发生 {{new Date(incident.lastSeenAt).toLocaleTimeString()}} · 影响 {{incident.blockingScopes.join(' / ')}}</small><details><summary>查看详情</summary><dl><dt>原始代码</dt><dd>{{incident.sourceCode}}</dd><dt>原始消息</dt><dd>{{incident.sourceMessage}}</dd><dt>请求</dt><dd>{{incident.method??'—'}} {{incident.endpoint??'—'}} · {{incident.requestId??'—'}}</dd><dt>路由</dt><dd>{{incident.routeIdentity??'—'}}</dd><dt>等待至</dt><dd>{{incident.blockedUntil?new Date(incident.blockedUntil).toLocaleString():'—'}}</dd><dt>首次 / 次数</dt><dd>{{new Date(incident.firstSeenAt).toLocaleString()}} / {{incident.count}}</dd></dl></details></article></section><Transition name="route-feedback"><div v-if="navigatingTo" class="route-loading-overlay" role="status" aria-live="polite"><div class="route-loading-card"><span class="route-loading-spinner" aria-hidden="true"></span><div><strong>正在打开 {{navigatingLabel}}</strong><small>页面组件正在预加载，完成后自动显示</small></div></div><div class="route-loading-skeleton"><i></i><i></i><i></i></div></div></Transition><section class="content" :aria-busy="Boolean(navigatingTo)"><RouterView/></section></main>
    <nav class="mobile-bottom-nav" aria-label="移动端主导航"><RouterLink v-for="[name,label,Icon] in primaryNav" :key="name" :to="linkTo(name)" :class="{active:route.name===name,pending:navigatingTo===name}" :aria-current="route.name===name?'page':undefined" @pointerenter="warmRoute(name)" @focus="warmRoute(name)" @pointerdown="beginRoute(name)" @click="beginRoute(name)"><component :is="Icon" :size="19"/><span>{{label}}</span></RouterLink><button :class="{active:moreOpen||moreNav.some(([name])=>route.name===name)}" aria-label="更多页面" :aria-expanded="moreOpen" @click="moreOpen=!moreOpen"><MoreHorizontal :size="19"/><span>更多</span></button></nav>
    <Transition name="drawer"><div v-if="moreOpen" class="mobile-drawer-backdrop" @click.self="moreOpen=false"><aside class="mobile-more-drawer" role="dialog" aria-modal="true" aria-label="更多页面"><div class="drawer-head"><div><span class="eyebrow">MORE</span><h2>更多页面</h2></div><button class="icon-button" aria-label="关闭更多菜单" @click="moreOpen=false"><X :size="18"/></button></div><nav class="drawer-links"><RouterLink v-for="[name,label,Icon] in moreNav" :key="name" :to="linkTo(name)" :class="{active:route.name===name,pending:navigatingTo===name}" :aria-current="route.name===name?'page':undefined" @pointerenter="warmRoute(name)" @focus="warmRoute(name)" @pointerdown="beginRoute(name)" @click="beginRoute(name)"><component :is="Icon" :size="19"/><span>{{label}}</span></RouterLink></nav><div class="drawer-status"><component :is="store.connected?Wifi:WifiOff" :size="16"/><span>{{store.connected?'实时通道在线':'实时通道重连中'}}</span></div></aside></div></Transition>
  </div>
</template>
