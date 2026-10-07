<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RELEASE_LABEL, type SystemSettings } from "@zdj/contracts";
import {
  api,
  saveExchangeCredentials,
  testPrivateCredentials,
} from "../api/client";
import { normalizeBlacklistInput } from "../blacklistInput";
import Panel from "../components/Panel.vue";
import EmptyState from "../components/EmptyState.vue";
import { applyTradingParameterProfile, tradingParameterProfiles, type TradingParameterProfile } from "../tradingParameterProfiles";
import { buildGovernancePatch, changedPaths, canSubmit, describeRefusals, exitCoordinationRows, formatGovernanceValue, initialValues, requiredAcks, type GovernancePanelState, type GovernanceRow } from "../governancePanel";

const tabs = [
  ["strategy", "策略与执行"],
  ["market-quality", "交易对黑名单"],
  ["direction", "方向策略"],
  ["governance", "AI 退出与复核"],
  ["exchange", "交易所"],
  ["proxy", "网络代理"],
  ["ai", "AI 模型资源"],
  ["theme", "外观主题"],
] as const;
const tab = ref("strategy"),
  draft = ref<SystemSettings | null>(null),
  resources = ref<any>({ exchange: [], proxy: [], ai: [] }),
  aiRouteDraft = ref<any[]>([]),
  aiProbeResults = ref<Record<string,any>>({}),
  resourceProbeResults = ref<Record<string,any>>({}),
  resourceSettingsVersion = ref<number | null>(null),
  resourceBaseline = ref<Record<string, Record<string, string>>>({ exchange: {}, proxy: {}, ai: {} }),
  selectedResourceId = ref<Record<string,string>>({exchange:"",proxy:"",ai:""}),
  saving = ref(false),
  notice = ref(""),
  error = ref(""),
  apiKey = ref(""),
  apiSecret = ref(""),
  credentialStatus = ref<any>(null),
  overrideSymbol = ref(""),
  overridePreference = ref("SHORT_ONLY"),
  blacklistSymbol = ref(""),
  blacklistUnderlying = ref("");
const governance = ref<GovernancePanelState | null>(null),
  governanceDraft = ref<Record<string, unknown>>({}),
  governanceAcks = ref<string[]>([]),
  governanceError = ref(""),
  governanceNotice = ref("");
const globalSettingsTabs=new Set(["strategy","market-quality","direction","theme"]);
const usesGlobalSettingsSave=computed(()=>globalSettingsTabs.has(tab.value));
const activeTabLabel=computed(()=>tabs.find(([id])=>id===tab.value)?.[1]??"系统设置");
const governanceRows = computed<GovernanceRow[]>(() => (governance.value ? exitCoordinationRows(governance.value) : []));
const governancePatch = computed(() => buildGovernancePatch(governanceRows.value, governanceDraft.value));
const governanceDirty = computed(() => changedPaths(governanceRows.value, governanceDraft.value).length);
const governanceRequiredAcks = computed(() => requiredAcks(governanceRows.value, governancePatch.value.fields));
const governanceSubmit = computed(() => canSubmit({ fields: governancePatch.value.fields, refused: governancePatch.value.refused,
  requiredAcks: governanceRequiredAcks.value, grantedAcks: governanceAcks.value }));
function governanceAckLabel(ack: string) {
  return ack === "AI_EXIT_ENFORCE_AUTHORITY"
    ? "我确认：把 AI 退出权限设为 ENFORCE 后，AI 可以在计划失效时提交 reduce-only 限价平仓（亏损上限与利润许可线仍按下方数值执行）。"
    : "我确认这次权限变更。";
}
async function loadGovernance() {
  try {
    const body = await api.governanceSettings();
    governance.value = body;
    governanceDraft.value = initialValues(body.fields);
    governanceAcks.value = [];
    governanceError.value = "";
  } catch (e) {
    governanceError.value = `治理设置读取失败：${String(e)}`;
  }
}
async function saveGovernance() {
  governanceNotice.value = "";
  governanceError.value = "";
  if (!governanceSubmit.value.ok || !governance.value) { governanceError.value = governanceSubmit.value.reason; return; }
  try {
    const saved = await api.saveGovernanceFields(governancePatch.value.fields, governance.value.settingsVersion, governanceAcks.value);
    governanceNotice.value = `已保存 ${saved.applied.length} 项，服务端设置版本 ${saved.settingsVersion}`;
    await loadGovernance();
    draft.value = structuredClone(await api.settings());
  } catch (e) {
    // The API client throws with the response body as its message, so the refusal list is parsed
    // rather than swallowed: "保存失败" alone would hide which field the server said no to.
    let parsed: any = null;
    try { parsed = JSON.parse(String((e as Error)?.message ?? e)); } catch { parsed = null; }
    const refusals = describeRefusals(parsed ?? {});
    governanceError.value = refusals.length ? `服务端拒绝写入：${refusals.join("；")}` : `保存失败：${String(e)}`;
    await loadGovernance();
  }
}
const themes = [
  ["BINANCE_NOIR", "Binance Noir：深色专业交易界面"],
  ["INSTITUTIONAL_BLUE", "Institutional Blue：机构蓝白"],
  ["DARK_TRUFFLE", "Dark Truffle：深棕暖色"],
  ["BULLION_GOLD", "Bullion Gold：金色深色"],
  ["DUNHUANG_FINANCE", "Dunhuang Finance：敦煌沙色"],
  ["AUTUMN_MAILLARD", "Autumn Maillard：秋日棕红"],
  ["MORANDI_QUANT", "Morandi Quant：莫兰迪量化"],
  ["LONDON_GRAPHITE", "London Graphite：石墨灰"],
  ["QUIET_MORNING", "Quiet Morning：静谧青灰"],
  ["BURGUNDY_EDITORIAL", "Burgundy Editorial：酒红编辑"],
] as const;
const themeDescription = computed(
  () => themes.find((x) => x[0] === draft.value?.appearance.theme)?.[1] ?? "",
);
const tradingProfileOptions=[
  ["CONSERVATIVE","保守"],["DEFAULT","默认"],["AGGRESSIVE","激进"],["CUSTOM","自定义"],
] as const;
const perTradeRiskPercent=computed({
  get:()=>Number(draft.value?.riskGovernance.perTradeRiskPctEquity??0)*100,
  set:(value:number)=>{if(draft.value){draft.value.riskGovernance.perTradeRiskPctEquity=Number(value)/100;markTradingProfileCustom();}},
});
const reachabilityPercent=computed({
  get:()=>Number(draft.value?.tradeEconomics.minHistoricalReachProbability??0)*100,
  set:(value:number)=>{if(draft.value){draft.value.tradeEconomics.minHistoricalReachProbability=Number(value)/100;markTradingProfileCustom();}},
});
const humanManagedNotionalPercent=computed({
  get:()=>Number(draft.value?.positionManagement.maxHumanManagedNotionalPctEquity??0)*100,
  set:(value:number)=>{if(draft.value){draft.value.positionManagement.maxHumanManagedNotionalPctEquity=Number(value)/100;markTradingProfileCustom();}},
});
// Both exposure caps are stored as ratios (1 = 100% equity); the page edits percent and divides by
// exactly 100 on the way back, so a saved 100 can never land as 10000.
const grossExposurePercent=computed({
  get:()=>Number(draft.value?.riskGovernance.maxGrossExposurePct??0)*100,
  set:(value:number)=>{if(draft.value)draft.value.riskGovernance.maxGrossExposurePct=Number(value)/100;},
});
const directionExposurePercent=computed({
  get:()=>Number(draft.value?.riskGovernance.maxDirectionExposurePct??0)*100,
  set:(value:number)=>{if(draft.value)draft.value.riskGovernance.maxDirectionExposurePct=Number(value)/100;},
});
// The ratio and its enforcement are two separate settings: this edits only whether a stored ratio may
// veto new Entry risk. It never writes the ratio itself, so switching to OBSERVE cannot raise a ceiling.
const capacityModeOf=(key:string)=>computed({
  get:()=>String((draft.value?.riskGovernance as any)?.exposureCapacityPolicy?.[key]??'ENFORCE'),
  set:(value:string)=>{const g=draft.value?.riskGovernance as any;if(!g)return;const current=g.exposureCapacityPolicy??{};g.exposureCapacityPolicy={gross:'ENFORCE',direction:'ENFORCE',cluster:'ENFORCE',...current,[key]:value};},
});
const grossCapacityMode=capacityModeOf('gross'),directionCapacityMode=capacityModeOf('direction'),clusterCapacityMode=capacityModeOf('cluster');
function applySelectedTradingProfile(){
  if(!draft.value)return;
  applyTradingParameterProfile(draft.value,draft.value.tradeEconomics.parameterProfile as TradingParameterProfile);
  const selected=draft.value.tradeEconomics.parameterProfile;
  notice.value=selected==="CUSTOM"?"已切换为自定义参数":`已载入${tradingParameterProfiles[selected as keyof typeof tradingParameterProfiles].label}交易参数；保存设置后生效`;
}
function markTradingProfileCustom(){if(draft.value&&draft.value.tradeEconomics.parameterProfile!=="CUSTOM")draft.value.tradeEconomics.parameterProfile="CUSTOM";}
const tierLabel=(tier:string)=>({CORE:'核心资产',LIQUID_ALT:'高流动山寨',SPECULATIVE:'投机资产',NEW_LISTING:'新上市资产'} as Record<string,string>)[tier]??tier;
const directionPreferenceLabel=(value:string)=>({BALANCED:'均衡',INTELLIGENT_SHORT_BIAS:'智能偏空（兼容字段）',STRICT_SHORT_BIAS:'严格偏空（兼容字段）',SHORT_ONLY:'仅空（兼容字段）',CUSTOM:'自定义'} as Record<string,string>)[value]??value;
function applyTheme() {
  if (draft.value) {
    document.documentElement.dataset.theme = draft.value.appearance.theme;
    localStorage.setItem("zdj-theme", draft.value.appearance.theme);
  }
}
async function load() {
  try {
    const [settings, connections, ...loaded] = await Promise.all([
      api.settings(),
      api.connections(),
      api.resources("exchange"),
      api.resources("proxy"),
      api.resources("ai"),
      loadGovernance(),
      api.aiDutyRoutes(),
    ]);
    draft.value = structuredClone(settings);
    draft.value.entry ??= {} as any;
    draft.value.entry.minimumInitialMarginByQuote ??= { USDT: 100, USDC: 100 };
    draft.value.entry.minimumOrderNotionalBySymbol ??= {BTCUSDT:150};
    draft.value.entry.minimumOrderNotionalBySymbol.BTCUSDT=Math.max(150,Number(draft.value.entry.minimumOrderNotionalBySymbol.BTCUSDT)||0);
    draft.value.entry.minimumOrderNotionalByQuote ??= { USDT: 200, USDC: 200 };
    credentialStatus.value = connections.credentials;
    resources.value = {
      exchange: loaded[0].items ?? [],
      proxy: loaded[1].items ?? [],
      ai: loaded[2].items ?? [],
    };
    aiRouteDraft.value=structuredClone(loaded[4]?.routes??settings.aiDutyRoutes??[]);
    resourceSettingsVersion.value = Number(loaded[0].settingsVersion ?? settings.settingsVersion);
    resourceBaseline.value={exchange:Object.fromEntries(resources.value.exchange.map((x:any)=>[x.id,JSON.stringify(x)])),proxy:Object.fromEntries(resources.value.proxy.map((x:any)=>[x.id,JSON.stringify(x)])),ai:Object.fromEntries(resources.value.ai.map((x:any)=>[x.id,JSON.stringify(x)]))};
    for(const kind of ['exchange','proxy','ai'])if(!resources.value[kind].some((x:any)=>x.id===selectedResourceId.value[kind]))selectedResourceId.value[kind]=resources.value[kind][0]?.id??'';
    applyTheme();
  } catch (e) {
    error.value = String(e);
  }
}
async function discardGlobalEdits(){notice.value="";error.value="";await load();notice.value="已取消未保存修改并重新读取服务端设置";}
async function save() {
  if (!draft.value) return;
  saving.value = true;
  try {
    draft.value = structuredClone(await api.saveSettings(draft.value));
    resourceSettingsVersion.value = draft.value.settingsVersion;
    notice.value = "设置已保存";
    applyTheme();
  } catch (e) {
    error.value = String(e);
  } finally {
    saving.value = false;
  }
}
async function saveResource(kind: string, item: any) {
  try {
    const expected=resourceSettingsVersion.value ?? draft.value?.settingsVersion;
    if(!expected)throw new Error("资源版本尚未加载，请刷新设置");
    const saved=await api.saveResource(kind,item,expected);
    const readback=await api.resources(kind),confirmed=(readback.items??[]).find((x:any)=>x.id===saved.id);
    if(!confirmed)throw new Error("RESOURCE_SERVER_READBACK_MISSING");
    resourceSettingsVersion.value=Number(readback.settingsVersion??saved.settingsVersion);
    resources.value[kind]=readback.items??[];
    if(draft.value){
      draft.value.settingsVersion=Number(resourceSettingsVersion.value);
      if(kind==="ai")draft.value.aiResources=resources.value.ai.map((x:any)=>({id:x.id,name:x.name,role:x.role,enabled:x.enabled!==false,baseUrl:x.baseUrl,model:x.model,maxConcurrency:Number(x.maxConcurrency??1),gpu:x.gpu??"未指定"}));
      if(kind==="proxy"){const active=(readback.items??[]).find((x:any)=>x.active)??confirmed;draft.value.connections.proxy={...draft.value.connections.proxy,url:active.url,enabled:active.enabled!==false,activeResourceId:active.id,resources:(readback.items??[]).map((x:any)=>({id:x.id,name:x.name,type:"SOCKS5H",url:x.url,enabled:x.enabled!==false})),protocol:"SOCKS5H",forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,binanceRestRoute:"CONFIGURED",bypassLocalhost:true,failClosed:true};delete (draft.value.connections.proxy as any).expectedStaticEgressIp;}
      if(kind==="exchange"){const x:any=draft.value.connections.exchange;if(confirmed.environment==="TESTNET"){x.environment="TESTNET";x.testnetBaseUrl=confirmed.restBaseUrl;x.testnetRestBaseUrl=confirmed.restBaseUrl;x.testnetWsBaseUrl=confirmed.wsBaseUrl;}else{x.environment="PRODUCTION";x.productionBaseUrl=confirmed.restBaseUrl;x.productionRestBaseUrl=confirmed.restBaseUrl;x.productionWsBaseUrl=confirmed.wsBaseUrl;}x.credentialRef=confirmed.credentialRef??x.credentialRef;draft.value.connections.executionMode=confirmed.executionMode??draft.value.connections.executionMode;}
    }
    resourceBaseline.value[kind]=Object.fromEntries(resources.value[kind].map((x:any)=>[x.id,JSON.stringify(x)]));selectedResourceId.value[kind]=confirmed.id;
    notice.value = "资源已保存并已回读";
  } catch (e) {
    error.value = String(e);
  }
}
async function addResource(kind: "exchange" | "proxy" | "ai") {
  if(kind==="exchange"){
    const x:any=draft.value?.connections?.exchange??{};
    resources.value.exchange=[{id:"binance-usdm",name:"Binance USD-M",type:"BINANCE_USDM",environment:x.environment??"TESTNET",executionMode:draft.value?.connections?.executionMode??"READ_ONLY",restBaseUrl:(x.environment??"TESTNET")==="TESTNET"?(x.testnetRestBaseUrl??x.testnetBaseUrl??"https://demo-fapi.binance.com"):(x.productionRestBaseUrl??x.productionBaseUrl??"https://fapi.binance.com"),wsBaseUrl:(x.environment??"TESTNET")==="TESTNET"?(x.testnetWsBaseUrl??"wss://stream.binancefuture.com/ws"):(x.productionWsBaseUrl??"wss://fstream.binance.com/ws"),credentialRef:x.credentialRef??"binance-primary",enabled:true,status:"READY"}];
    resourceBaseline.value.exchange={};selectedResourceId.value.exchange="binance-usdm";return;
  }
  if(kind==="proxy"){
    const id=`proxy_${Date.now()}`,current=(resources.value.proxy.find((x:any)=>x.active)??resources.value.proxy[0]);
    const item={id,name:"新代理",type:"SOCKS5H",url:current?.url??"socks5h://127.0.0.1:20091",enabled:true,active:false,status:"UNSAVED"};
    resources.value.proxy=[...resources.value.proxy,item];selectedResourceId.value.proxy=id;return;
  }
  const item={id:`ai_${Date.now()}`,name:"",role:"REVIEW_BRAIN",baseUrl:"",model:"",maxConcurrency:1,gpu:"未指定",enabled:true,status:"UNKNOWN",duties:[],activeRequests:0,queueDepth:0};
  resources.value.ai=[...resources.value.ai,item];selectedResourceId.value.ai=item.id;
}
async function activateResource(kind:"proxy",id:string){
  try{
    const expected=resourceSettingsVersion.value ?? draft.value?.settingsVersion;if(!expected)throw new Error("资源版本尚未加载，请刷新设置");
    await api.activateResource(kind,id,expected);
    const loaded=await api.resources(kind);resources.value[kind]=loaded.items??[];resourceSettingsVersion.value=Number(loaded.settingsVersion??expected+1);resourceBaseline.value[kind]=Object.fromEntries(resources.value[kind].map((x:any)=>[x.id,JSON.stringify(x)]));selectedResourceId.value[kind]=id;
    if(draft.value){const active=resources.value.proxy.find((x:any)=>x.active);if(active){draft.value.settingsVersion=resourceSettingsVersion.value;draft.value.connections.proxy={...draft.value.connections.proxy,url:active.url,enabled:active.enabled!==false,activeResourceId:active.id,resources:resources.value.proxy.map((x:any)=>({id:x.id,name:x.name,type:"SOCKS5H",url:x.url,enabled:x.enabled!==false}))};}}
    notice.value="代理已激活并 hot-apply";
  }catch(e){error.value=String(e);}
}
async function removeResource(kind: string, id: string) {
  try{
    if(!resourceBaseline.value[kind]?.[id]){resources.value[kind]=resources.value[kind].filter((x:any)=>x.id!==id);selectedResourceId.value[kind]=resources.value[kind][0]?.id??"";notice.value="未保存的新资源已移除";return;}
    if(typeof window!=="undefined"&&!window.confirm("确认删除此资源？该操作会立即保存到服务端。"))return;
    const expected=resourceSettingsVersion.value ?? draft.value?.settingsVersion;if(!expected)throw new Error("资源版本尚未加载，请刷新设置");
    await api.deleteResource(kind,id,expected);
    const loaded=await api.resources(kind);resources.value[kind]=loaded.items??[];resourceSettingsVersion.value=Number(loaded.settingsVersion??expected+1);resourceBaseline.value[kind]=Object.fromEntries(resources.value[kind].map((x:any)=>[x.id,JSON.stringify(x)]));selectedResourceId.value[kind]=resources.value[kind][0]?.id??"";
    if(draft.value){draft.value.settingsVersion=resourceSettingsVersion.value;if(kind==="ai")draft.value.aiResources=resources.value.ai.map((x:any)=>({id:x.id,name:x.name,role:x.role,enabled:x.enabled!==false,baseUrl:x.baseUrl,model:x.model,maxConcurrency:Number(x.maxConcurrency??1),gpu:x.gpu??"未指定"}));if(kind==="proxy"){const active=resources.value.proxy.find((x:any)=>x.active)??resources.value.proxy[0];if(active)draft.value.connections.proxy={...draft.value.connections.proxy,url:active.url,enabled:active.enabled!==false,activeResourceId:active.id,resources:resources.value.proxy.map((x:any)=>({id:x.id,name:x.name,type:"SOCKS5H",url:x.url,enabled:x.enabled!==false}))};}}
    notice.value="资源已删除并已回读";
  }catch(e){error.value=String(e);}
}
function isResourceDirty(kind:string,item:any){return resourceBaseline.value[kind]?.[item.id]!==JSON.stringify(item);}
function selectedResources(kind:string){const id=selectedResourceId.value[kind];return id?resources.value[kind].filter((x:any)=>x.id===id):resources.value[kind].slice(0,1);}
async function cancelResourceEdits(kind:string){try{const selected=selectedResourceId.value[kind],loaded=await api.resources(kind);resources.value[kind]=loaded.items??[];resourceSettingsVersion.value=Number(loaded.settingsVersion);resourceBaseline.value[kind]=Object.fromEntries(resources.value[kind].map((x:any)=>[x.id,JSON.stringify(x)]));selectedResourceId.value[kind]=resources.value[kind].some((x:any)=>x.id===selected)?selected:(resources.value[kind][0]?.id??"");notice.value="未保存修改已取消";}catch(e){error.value=String(e);}}
async function testResource(kind:"exchange"|"proxy"|"ai",item:any){try{if(isResourceDirty(kind,item))throw new Error("请先保存当前资源修改，再执行真实连接测试");const result=await api.testResource(kind,item.id);resourceProbeResults.value={...resourceProbeResults.value,[item.id]:result};if(kind==="ai"){aiProbeResults.value={...aiProbeResults.value,[item.id]:result};notice.value=`连接 ${result.status} · ${result.latencyMs}ms · 实际 model id: ${(result.models??[]).join(", ")||"未返回"}`;}else notice.value=`连接测试：${result.status??result.state??"PASS"}${result.latencyMs!=null?` · ${result.latencyMs}ms`:""}`;}catch(e){error.value=String(e);}}
const aiDutyLabels:Record<string,string>={SCOUT_RESEARCH:"Scout / Research",ENTRY_PRIMARY:"Entry Primary",PENDING_ENTRY_REVIEW:"Pending Entry Review",POSITION_REVIEW:"Position Review"};
function updateAiRoute(duty:string,resourceId:string){const routes=structuredClone(aiRouteDraft.value),found=routes.find((row:any)=>row.duty===duty);if(found){found.resourceId=resourceId;found.enabled=Boolean(resourceId);}else if(resourceId)routes.push({duty,resourceId,enabled:true,priority:duty==="ENTRY_PRIMARY"?100:duty==="POSITION_REVIEW"?90:duty==="PENDING_ENTRY_REVIEW"?20:10});aiRouteDraft.value=routes;}
function routeResourceId(duty:string){return aiRouteDraft.value.find((row:any)=>row.duty===duty&&row.enabled)?.resourceId??"";}
function onAiRouteChange(duty:string,event:Event){updateAiRoute(duty,(event.target as HTMLSelectElement).value);}
async function saveAiRoutes(){try{const expected=resourceSettingsVersion.value??draft.value?.settingsVersion;if(!expected)throw new Error("资源版本尚未加载，请刷新设置");const saved=await api.saveAiDutyRoutes(aiRouteDraft.value,expected),readback=await api.aiDutyRoutes();aiRouteDraft.value=readback.routes??saved.routes??[];resourceSettingsVersion.value=Number(readback.settingsVersion??saved.settingsVersion);if(draft.value){draft.value.settingsVersion=resourceSettingsVersion.value;draft.value.aiDutyRoutes=structuredClone(aiRouteDraft.value);}notice.value="职责路由已保存并完成服务端读回";}catch(e){error.value=String(e);}}
async function saveCredentials() {
  try {
    const result = await saveExchangeCredentials(apiKey.value, apiSecret.value);
    credentialStatus.value = result;
    apiKey.value = "";
    apiSecret.value = "";
    notice.value = "凭证已验证并保存";
  } catch (e) {
    error.value = String(e);
  }
}
async function testCredentials() {
  try {
    const result = await testPrivateCredentials(apiKey.value, apiSecret.value);
    notice.value = result.status;
  } catch (e) {
    error.value = String(e);
  }
}
function saveSymbolDirectionOverride() {
  if (!draft.value) return;
  const symbol = overrideSymbol.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}(USDT|USDC|BUSD)$/.test(symbol)) {
    error.value = "请输入有效的合约，例如 SOLUSDT";
    return;
  }
  draft.value.portfolioIntelligence.symbolDirectionPreferences[symbol] =
    overridePreference.value as any;
  overrideSymbol.value = "";
}
function removeSymbolDirectionOverride(symbol: string) {
  if (draft.value) delete draft.value.portfolioIntelligence.symbolDirectionPreferences[symbol];
}
function addBlacklist(kind:'symbolBlacklist'|'underlyingBlacklist',value:string){if(!draft.value)return;const normalized=normalizeBlacklistInput(kind,value);if(!normalized){error.value='请输入有效 Symbol 或 Underlying（支持币安人生/USDT 这类 Unicode 合约名）';return;}const list=draft.value.selection.marketQuality[kind];if(!list.includes(normalized))list.push(normalized);if(kind==='symbolBlacklist')blacklistSymbol.value='';else blacklistUnderlying.value='';}
function removeBlacklist(kind:'symbolBlacklist'|'underlyingBlacklist',value:string){if(draft.value)draft.value.selection.marketQuality[kind]=draft.value.selection.marketQuality[kind].filter(x=>x!==value);}
onMounted(load);
</script>

<template>
  <div class="page-stack settings-page">
    <div class="settings-hero">
      <div>
        <span class="eyebrow">SYSTEM SETTINGS</span>
        <h2 class="page-title">系统设置</h2>
        <p class="muted">当前：{{activeTabLabel}} · 普通参数与资源对象使用各自独立的保存边界。</p>
      </div>
      <div class="settings-hero-actions">
        <template v-if="usesGlobalSettingsSave">
          <button class="button secondary" :disabled="saving" @click="discardGlobalEdits">取消未保存修改</button>
          <button class="button primary" :disabled="saving" @click="save">{{ saving ? "保存中…" : "保存当前参数" }}</button>
        </template>
        <span v-else class="muted">当前页使用独立的保存 / 取消 / 测试操作</span>
      </div>
    </div>
    <p v-if="error" class="error-banner">{{ error }}</p>
    <p v-if="notice" class="muted">{{ notice }}</p>
    <div class="segmented">
      <button
        v-for="[id, label] in tabs"
        :key="id"
        :class="{ active: tab === id }"
        @click="tab = id"
      >
        {{ label }}
      </button>
    </div>
    <template v-if="draft">
      <Panel v-if="tab === 'strategy'" title="策略与执行">
        <div class="policy-callout">
          <strong>交易参数档位</strong>
          <select v-model="draft.tradeEconomics.parameterProfile" @change="applySelectedTradingProfile">
            <option v-for="[id,label] in tradingProfileOptions" :key="id" :value="id">{{ label }}</option>
          </select>
          <span>保守 / 默认 / 激进会一次性写入对应参数；单项修改后自动标记为“自定义”。档位选择不会暗中切换经济性准入模式。</span>
        </div>
        <div class="policy-callout">
          <strong>组合暴露上限</strong>
          <div class="form-grid four">
            <label><span>组合总名义敞口上限（占权益 %）</span><input v-model.number="grossExposurePercent" type="number" min="0.01" max="2000" step="1" /></label>
            <label><span>单方向名义敞口上限（占权益 %）</span><input v-model.number="directionExposurePercent" type="number" min="0.01" max="2000" step="1" /></label>
            <label><span>总名义比例的执行方式</span><select v-model="grossCapacityMode" data-exposure-capacity-mode="gross"><option value="ENFORCE">强制执行（比例耗尽即拒绝新增）</option><option value="OBSERVE">仅观测（新增容量由真实保证金与风险事实决定）</option></select></label>
            <label><span>单方向比例的执行方式</span><select v-model="directionCapacityMode" data-exposure-capacity-mode="direction"><option value="ENFORCE">强制执行</option><option value="OBSERVE">仅观测</option></select></label>
            <label><span>相关性集中度的执行方式</span><select v-model="clusterCapacityMode" data-exposure-capacity-mode="cluster"><option value="ENFORCE">强制执行</option><option value="OBSERVE">仅观测</option></select></label>
          </div>
          <span>页面按百分比显示，保存时精确除以 100 写回后端比例（100% 即比例 1）。此额度只限制新增 Entry 风险：不强平已有仓位，也不撤已有 TP/保护。最大持仓数量与组合总敞口是两条独立限制；即使持仓数小于上限，总敞口或单方向额度任一耗尽仍会 CAPACITY_BLOCKED。提高额度只能由操作员显式编辑并保存，系统不会按持仓数量推导或为恢复交易自动放宽。技术上限 2000% 只是取值边界，不代表建议值。切换为“仅观测”只取消该比例的否决权，不修改比例数值本身，也不再把它当作可动用资金展示：真实可执行新增名义仍受可用保证金、已验证杠杆、维持保证金与强平距离、单风险、集中度、槽位、JIT 与 PortfolioRisk 压力共同约束。</span>
        </div>
        <div class="form-grid four">
          <label><span>经济性准入模式</span><select v-model="draft.tradeEconomics.admissionMode"><option value="OFF">关闭</option><option value="SHADOW">影子观察（只记录不拦截）</option><option value="ENFORCE">强制执行（不满足则拒绝建仓）</option></select></label>
          <label><span>历史止盈可达性检查</span><select v-model="draft.tradeEconomics.historicalTpReachabilityEnabled"><option :value="true">启用</option><option :value="false">关闭</option></select></label>
          <label><span>历史最低可达概率 %</span><input v-model.number="reachabilityPercent" type="number" min="0" max="100" step="1" /></label>
          <label><span>历史回看 K 线数量</span><input v-model.number="draft.tradeEconomics.reachabilityLookbackBars" type="number" min="30" max="300" /></label>
          <label><span>历史最少有效样本</span><input v-model.number="draft.tradeEconomics.reachabilityMinSamples" type="number" min="10" max="250" /></label>
          <label><span>单笔风险占权益 %</span><input v-model.number="perTradeRiskPercent" type="number" min="0" max="100" step="0.05" /></label>
          <label><span>待人工处置最大持仓数</span><input v-model.number="draft.positionManagement.maxHumanManagedPositions" @input="markTradingProfileCustom" type="number" min="1" max="100" /></label>
          <label><span>待人工处置最大名义 / 权益 %</span><input v-model.number="humanManagedNotionalPercent" type="number" min="1" max="500" step="1" /></label>
          <label
            ><span>Universe Top N</span
            ><input v-model.number="draft.selection.universeTopN" type="number"
          /></label>
          <label
            ><span>交易池目标</span
            ><input v-model.number="draft.selection.poolTarget" type="number"
          /></label>
          <label><span>入场节奏</span><select v-model="draft.ai.highFrequency.mode"><option value="CONSERVATIVE">保守</option><option value="NORMAL">正常</option><option value="HIGH_FREQUENCY">高频</option><option value="CUSTOM">自定义</option></select></label>
          <label><span>侦察模型预取数量</span><input v-model.number="draft.ai.highFrequency.scoutPrefetch" type="number" min="1" max="8" /></label>
          <label><span>单币重试 / 冷却（秒）</span><input v-model.number="draft.ai.highFrequency.retryCooldownSeconds" type="number" min="5" max="300" /></label>
          <label><span>连续失败隔离阈值 / 隔离时长（秒）</span><input v-model.number="draft.ai.highFrequency.quarantineAfterFailures" type="number" min="2" max="10" /><input v-model.number="draft.ai.highFrequency.quarantineSeconds" type="number" min="30" max="3600" /></label>
          <label><span>TESTNET 单笔最低初始保证金 USDT</span><input v-model.number="draft.entry.minimumInitialMarginByQuote.USDT" type="number" min="100" step="0.01" /></label>
          <label><span>TESTNET 单笔最低初始保证金 USDC</span><input v-model.number="draft.entry.minimumInitialMarginByQuote.USDC" type="number" min="100" step="0.01" /></label>
          <label><span>BTCUSDT 业务最低名义金额</span><input v-model.number="draft.entry.minimumOrderNotionalBySymbol.BTCUSDT" type="number" min="150" step="0.01" /></label>
          <label><span>历史 USDT 订单金额（兼容读回；不作自动 Entry 地板）</span><input v-model.number="draft.entry.minimumOrderNotionalByQuote.USDT" type="number" disabled /></label>
          <label><span>历史 USDC 订单金额（兼容读回；不作自动 Entry 地板）</span><input v-model.number="draft.entry.minimumOrderNotionalByQuote.USDC" type="number" disabled /></label>
          <p class="muted">新单最低初始保证金必须逐资产显式填写；未配置时 TESTNET 不会回退到交易所最小单。业务订单 notional 与交易所 minQty/minNotional 独立校验。留空的可选订单 notional 不增加门槛。下方旧字段只用于资本配置，不会自动迁移为业务下限。</p>
          <label
            ><span>资本配置目标保证金 USD（非最低下限）</span
            ><input
              v-model.number="draft.portfolio.entryMarginUsd"
              @input="markTradingProfileCustom"
              type="number"
          /></label>
          <label
            ><span>最大持仓数量</span
            ><input
              v-model.number="draft.portfolio.maxPositions"
              @input="markTradingProfileCustom"
              type="number"
              min="1"
              max="100"
          /></label>
          <label
            ><span>最大待成交建仓</span
            ><input
              v-model.number="draft.portfolio.maxPendingEntries"
              type="number"
          /></label>
          <label
            ><span>止盈目标方式（新建TP生效，已有有效TP保留）</span><select v-model="draft.takeProfit.mode"><option value="PRICE_MOVE_PERCENT">固定价格涨跌幅</option><option value="STRUCTURE_15M">闭合15m支撑/阻力</option></select></label>
          <label v-if="draft.takeProfit.mode==='STRUCTURE_15M'"><span>结构位提前缓冲 %</span><input v-model.number="draft.takeProfit.structureBufferPercent" type="number" min="0" max="1" step="0.01" /></label>
          <label v-if="draft.takeProfit.mode==='STRUCTURE_15M'"><span>结构目标最小价格距离 %</span><input v-model.number="draft.takeProfit.structureMinMovePercent" type="number" min="0.01" max="20" step="0.01" /></label>
          <label v-if="draft.takeProfit.mode==='STRUCTURE_15M'"><span>结构目标最大价格距离 %</span><input v-model.number="draft.takeProfit.structureMaxMovePercent" type="number" min="0.01" max="20" step="0.1" /></label>
          <p v-if="draft.takeProfit.mode==='STRUCTURE_15M'">使用已观测闭合15m摆动高低点，不保证未来阻力/支撑有效；过期、已穿越或距离不合格时回退固定目标。费用与最低净收益约束继续生效。更远目标可能降低成交概率。</p>
          <label
            ><span>固定 / 无有效结构时回退目标 %</span
            ><input
              v-model.number="draft.takeProfit.targetPriceMovePercent"
              type="number"
              step="0.1"
          /></label>
          <label
            ><span>TP 覆盖比例 %</span
            ><input
              v-model.number="draft.takeProfit.quantityPercent"
              type="number"
          /></label>
          <label
            ><span>最低净收益 USD</span
            ><select v-model.number="draft.takeProfit.minNetProfitUsd" @change="markTradingProfileCustom">
              <option v-for="value in 20" :key="value" :value="value">{{ value }} USDT</option>
            </select></label>
          <label
            ><span>最低净收益 ROI %</span
            ><input
              v-model.number="draft.takeProfit.minNetProfitRoiPct"
              type="number"
              step="0.1"
          /></label>
          <label
            ><span>手续费安全缓冲 %</span
            ><input
              v-model.number="draft.takeProfit.feeSafetyBufferPct"
              type="number"
              step="0.1"
          /></label>
          <label
            ><span>Exit fee assumption</span
            ><select v-model="draft.takeProfit.exitFeeAssumption">
              <option value="MAKER">Maker（挂单）</option>
              <option value="TAKER">Taker（吃单）</option>
            </select></label
          >
          <label
            ><span>Slippage buffer %</span
            ><input
              v-model.number="draft.takeProfit.slippageBufferPct"
              type="number"
              step="0.01"
          /></label>
          <label class="switch-row"
            ><span>TP Economics enabled</span
            ><input
              v-model="draft.takeProfit.tpEconomicsEnabled"
              type="checkbox"
          /></label>
          <label class="switch-row"
            ><span>自动 TP（确定性）</span
            ><input v-model="draft.takeProfit.enabled" type="checkbox"
          /></label>
          <h3 class="form-section-title">组合与建仓策略</h3>
          <label
            ><span>Quote Asset</span
            ><select v-model="draft.portfolioIntelligence.quoteAssetPolicy">
              <option value="AUTO">自动选择</option>
              <option value="USDT_ONLY">仅 USDT</option>
              <option value="USDC_ONLY">仅 USDC</option>
            </select></label
          >
          <label
            ><span>Underlying Policy</span
            ><select
              v-model="draft.portfolioIntelligence.underlyingExposurePolicy"
            >
              <option value="BLOCK_ALL">同底层资产全部阻止</option>
              <option value="BLOCK_SAME_DIRECTION">阻止同向重复</option>
              <option value="ALLOW_HEDGE">允许对冲</option>
            </select></label
          >
          <label
            ><span>Global Direction</span
            ><select
              v-model="draft.portfolioIntelligence.globalDirectionPolicy"
            >
              <option value="BOTH">双向（兼容字段）</option>
              <option value="LONG_BIASED">偏多（兼容字段）</option>
              <option value="SHORT_BIASED">偏空（兼容字段）</option>
              <option value="LONG_ONLY">仅多（兼容字段）</option>
              <option value="SHORT_ONLY">仅空（兼容字段）</option>
              <option value="DISABLED">禁用</option>
            </select></label
          >
          <label
            ><span>Margin Mode</span
            ><select v-model="draft.portfolioIntelligence.marginMode">
              <option value="AUTO">自动</option>
              <option value="ISOLATED">逐仓</option>
              <option value="CROSS">全仓</option>
            </select></label
          >
          <label
            ><span>Dynamic Base Margin USD</span
            ><input
              v-model.number="draft.portfolioIntelligence.baseMarginUsd"
              @input="markTradingProfileCustom"
              type="number"
          /></label>
          <label
            ><span>Min / Max Margin USD</span
            ><input
              v-model.number="draft.portfolioIntelligence.minMarginUsd"
              type="number" /><input
              v-model.number="
                draft.portfolioIntelligence.maxMarginPerPositionUsd
              "
              @input="markTradingProfileCustom"
              type="number"
          /></label>
          <label
            ><span>Global Max Leverage</span
            ><input
              v-model.number="draft.portfolioIntelligence.globalMaxLeverage"
              @input="markTradingProfileCustom"
              type="number"
          /></label>
          <label
            ><span>Min Location Score</span
            ><input
              v-model.number="draft.portfolioIntelligence.minLocationScore"
              type="number"
          /></label>
          <label
            ><span>Max LONG Exposure %</span
            ><input
              v-model.number="draft.portfolioIntelligence.maxLongExposurePct"
              type="number"
              step="0.01"
          /></label>
          <label
            ><span>Max SHORT Exposure %</span
            ><input
              v-model.number="draft.portfolioIntelligence.maxShortExposurePct"
              type="number"
              step="0.01"
          /></label>
          <label
            ><span>Max Speculative Exposure %</span
            ><input
              v-model.number="
                draft.portfolioIntelligence.maxSpeculativeExposurePct
              "
              type="number"
              step="0.01"
          /></label>
          <label class="switch-row"
            ><span>Dynamic Margin / Leverage</span
            ><input
              v-model="draft.portfolioIntelligence.dynamicMarginEnabled"
              type="checkbox" /><input
              v-model="draft.portfolioIntelligence.dynamicLeverageEnabled"
              type="checkbox"
          /></label>
          <label class="switch-row"
            ><span>Entry Location Protection</span
            ><input
              v-model="draft.portfolioIntelligence.locationProtectionEnabled"
              type="checkbox"
          /></label>
          <h3 class="form-section-title">收益基线与统计窗口</h3>
          <label class="switch-row"><span>启用账户收益基线</span><input v-model="draft.performanceTracking.enabled" type="checkbox" /></label>
          <label><span>期初 USDT 钱包余额</span><input v-model.number="draft.performanceTracking.baselineWalletByQuote.USDT" type="number" min="0" step="0.01" /></label>
          <label><span>期初 USDC 钱包余额</span><input v-model.number="draft.performanceTracking.baselineWalletByQuote.USDC" type="number" min="0" step="0.01" /></label>
          <label><span>滚动交易表现窗口（天）</span><input v-model.number="draft.performanceTracking.rollingDays" type="number" min="1" max="30" step="1" /></label>
          <p class="muted">当前默认期初资金为 USDT 5000 + USDC 5000。基线后账户钱包净增 = 当前 USDT/USDC walletBalance − 期初余额；该数字包含已实现盈亏、手续费、资金费以及可能的划转，因此与“纯交易 PnL”分开显示。最近交易表现默认按 7 天统计，本地账本与 Binance 交易所收入事实并列，不相加。</p>
          <h3 class="form-section-title">运行控制与资金准入</h3>
          <label class="switch-row"
            ><span>无可执行资金时自动暂停</span
            ><input
              v-model="draft.runtimeControl.autoPauseOnNoCapital"
              type="checkbox"
          /></label>
          <label class="switch-row"
            ><span>资金恢复后自动恢复</span
            ><input
              v-model="draft.runtimeControl.autoResumeOnCapital"
              type="checkbox"
          /></label>
          <label
            ><span>最低可执行候选数</span
            ><input
              v-model.number="draft.runtimeControl.minExecutableCandidates"
              type="number"
              min="0"
              max="30"
          /></label>
          <label
            ><span>资金/合约检查间隔（秒）</span
            ><input
              v-model.number="draft.runtimeControl.capitalCheckIntervalSeconds"
              type="number"
              min="15"
              max="300"
          /></label>
          <h3 class="form-section-title">
            {{ RELEASE_LABEL }} 决策完整性与风险闸门
          </h3>
          <label
            ><span>建仓安全模式</span
            ><select v-model="draft.riskGovernance.entrySafetyMode">
              <option value="SHADOW">影子观察</option>
              <option value="AUTO">自动运行</option>
            </select></label
          >
          <label
            ><span>入场保护策略</span
            ><select v-model="draft.riskGovernance.protectionMode">
              <option value="OFF">关闭</option>
              <option value="SHADOW">影子验证</option>
              <option value="REQUIRED">强制验证</option>
            </select></label
          >
          <label
            ><span>证据最低完整度</span
            ><input
              v-model.number="draft.riskGovernance.requiredEvidenceCompleteness"
              type="number"
              min="0"
              max="1"
              step="0.01"
          /></label>
          <label
            ><span>最大并发资金预留</span
            ><input
              v-model.number="draft.riskGovernance.maxConcurrentReservations"
              type="number"
              min="1"
              max="100"
          /></label>
          <label class="switch-row"
            ><span>缺失证据 fail-closed</span
            ><input
              v-model="draft.riskGovernance.failClosedOnMissingEvidence"
              type="checkbox"
          /></label>
          <label class="switch-row"
            ><span>AI 后确定性复核</span
            ><input
              v-model="draft.riskGovernance.requirePostAiVerification"
              type="checkbox"
          /></label>
        </div>
        <div class="policy-callout">
          <strong>手续费感知止盈</strong
          ><span
            >止盈价必须覆盖建仓费 + 平仓费 +
            安全缓冲，并达到最低净收益门槛；最低要求=max(USD门槛,
            保证金×ROI%)。</span
          >
        </div>
        <div class="policy-callout">
          <strong>安全边界</strong
          ><span
            >15m 是战术重点而不是方向命令；27B 自主决定 side / quantityUnits / acceptablePriceRange；AI 不直接下单；AI_FAILED 与 REJECT
            fail-closed；无自动止损；正式链禁止 Mock fallback。{{
              RELEASE_LABEL
            }}
            AUTO_RUNNING 下资金充足即持续分析；失败与拒绝只隔离当前 Symbol。</span
          >
        </div>
      </Panel>
      <Panel v-else-if="tab === 'market-quality'" title="交易质量准入与黑名单" subtitle="统一在候选排序与 Primary 前执行。0 表示按当前交易范围分位数自动校准；不会影响已有持仓、TP 或对账。 ">
        <div class="form-grid four">
          <label class="switch-row"><span>启用质量准入</span><input v-model="draft.selection.marketQuality.enabled" type="checkbox" /></label>
          <label><span>允许质量等级</span><select v-model="draft.selection.marketQuality.allowedGrades" multiple><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
          <label class="switch-row"><span>允许投机资产（仅 A 级）</span><input v-model="draft.selection.marketQuality.allowSpeculative" type="checkbox" /></label>
          <label class="switch-row"><span>允许新上市资产</span><input v-model="draft.selection.marketQuality.allowNewListings" type="checkbox" /></label>
          <label><span>最低 24h 成交额 USD（0=自动）</span><input v-model.number="draft.selection.marketQuality.minQuoteVolumeUsd24h" type="number" min="0" /></label>
          <label><span>最低 24h 成交笔数（0=自动）</span><input v-model.number="draft.selection.marketQuality.minTradeCount24h" type="number" min="0" /></label>
          <label><span>最大价差 bps（0=自动）</span><input v-model.number="draft.selection.marketQuality.maxSpreadBps" type="number" min="0" step="0.1" /></label>
          <label><span>最低 0.5% 单侧深度 USD（0=自动）</span><input v-model.number="draft.selection.marketQuality.minDepthUsd" type="number" min="0" /></label>
          <label><span>最低未平仓量折算 USD（0=自动）</span><input v-model.number="draft.selection.marketQuality.minOpenInterestUsd" type="number" min="0" /></label>
          <label><span>最短上市天数（0=自动）</span><input v-model.number="draft.selection.marketQuality.minListingAgeDays" type="number" min="0" /></label>
          <label><span>流动性前 N（0=不额外截断）</span><input v-model.number="draft.selection.marketQuality.liquidityTopN" type="number" min="0" max="300" /></label>
        </div>
        <h3 class="form-section-title">交易对黑名单</h3><div class="form-grid three"><label><span>交易对</span><input v-model="blacklistSymbol" placeholder="例如 USELESSUSDT 或 币安人生/USDT" /></label><label><span>操作</span><button class="button secondary" @click="addBlacklist('symbolBlacklist',blacklistSymbol)">添加到黑名单</button></label></div>
        <div v-if="draft.selection.marketQuality.symbolBlacklist.length" class="list"><div v-for="symbol in draft.selection.marketQuality.symbolBlacklist" :key="symbol" class="list-row"><span>{{symbol}}</span><button class="button secondary" @click="removeBlacklist('symbolBlacklist',symbol)">人工移出</button></div></div><p v-else class="muted">黑名单交易对不会显示于智能选币，也不能进入分析或交易。</p>
        <h3 class="form-section-title">底层资产黑名单</h3><div class="form-grid three"><label><span>底层资产</span><input v-model="blacklistUnderlying" placeholder="例如 DOGE" /></label><label><span>操作</span><button class="button secondary" @click="addBlacklist('underlyingBlacklist',blacklistUnderlying)">添加底层资产</button></label></div>
        <div v-if="draft.selection.marketQuality.underlyingBlacklist.length" class="list"><div v-for="symbol in draft.selection.marketQuality.underlyingBlacklist" :key="symbol" class="list-row"><span>{{symbol}}</span><button class="button secondary" @click="removeBlacklist('underlyingBlacklist',symbol)">人工移出</button></div></div><p v-else class="muted">同一底层资产的所有 USDT/USDC 合约都会被排除。</p>
      </Panel>
      <Panel
        v-else-if="tab === 'direction'"
        title="方向策略"
        subtitle="以下为兼容配置显示；当前生产 Entry 的 AI side 不由这些旧方向字段决定。分层与交易对覆盖仍会持久化。 "
      >
        <div class="form-grid two">
          <label
            ><span>全局山寨策略</span
            ><select
              v-model="draft.portfolioIntelligence.globalDirectionPreference"
            >
              <option value="BALANCED">均衡</option>
              <option value="INTELLIGENT_SHORT_BIAS">智能偏空（兼容字段）</option>
              <option value="STRICT_SHORT_BIAS">严格偏空（兼容字段）</option>
              <option value="SHORT_ONLY">仅空（兼容字段）</option>
              <option value="CUSTOM">自定义</option>
            </select></label
          ><label
            ><span>恢复默认</span
            ><button
              class="button secondary"
              @click="
                draft.portfolioIntelligence.tierDirectionPreferences = {
                  CORE: 'BALANCED',
                  LIQUID_ALT: 'INTELLIGENT_SHORT_BIAS',
                  SPECULATIVE: 'STRICT_SHORT_BIAS',
                  NEW_LISTING: 'SHORT_ONLY',
                }
              "
            >
              恢复分层默认
            </button></label
          >
        </div>
        <div
          class="form-grid four"
          v-for="tier in ['CORE', 'LIQUID_ALT', 'SPECULATIVE', 'NEW_LISTING']"
          :key="tier"
        >
          <label
            ><span>{{ tier }} 偏好</span
            ><select
              v-model="
                draft.portfolioIntelligence.tierDirectionPreferences[tier]
              "
            >
              <option value="BALANCED">均衡</option>
              <option value="INTELLIGENT_SHORT_BIAS">智能偏空（兼容字段）</option>
              <option value="STRICT_SHORT_BIAS">严格偏空（兼容字段）</option>
              <option value="SHORT_ONLY">仅空（兼容字段）</option>
              <option value="CUSTOM">自定义</option>
            </select></label
          ><label
            ><span>LONG Margin factor</span
            ><input
              type="number"
              min="0.01"
              max="1"
              step="0.05"
              v-model.number="
                draft.portfolioIntelligence.altLongMarginFactors[tier]
              " /></label
          ><label
            ><span>LONG Leverage cap</span
            ><input
              type="number"
              min="1"
              max="125"
              v-model.number="
                draft.portfolioIntelligence.altLongLeverageCaps[tier]
              "
          /></label>
        </div>
        <div class="form-grid three">
          <label><span>交易对覆盖</span><input v-model="overrideSymbol" placeholder="例如 SOLUSDT" /></label>
          <label><span>方向偏好</span><select v-model="overridePreference"><option value="BALANCED">均衡</option><option value="INTELLIGENT_SHORT_BIAS">智能偏空（兼容字段）</option><option value="STRICT_SHORT_BIAS">严格偏空（兼容字段）</option><option value="SHORT_ONLY">仅空（兼容字段）</option><option value="CUSTOM">自定义</option></select></label>
          <label><span>写入覆盖</span><button class="button secondary" @click="saveSymbolDirectionOverride">添加 / 更新</button></label>
        </div>
        <div v-if="Object.keys(draft.portfolioIntelligence.symbolDirectionPreferences).length" class="list">
          <div v-for="(preference,symbol) in draft.portfolioIntelligence.symbolDirectionPreferences" :key="symbol" class="list-row"><span>{{ symbol }} → {{ directionPreferenceLabel(String(preference)) }}</span><button class="button secondary" @click="removeSymbolDirectionOverride(symbol)">移除</button></div>
        </div>
        <p v-else class="muted">没有交易对覆盖配置。</p>
      </Panel>
      <Panel v-else-if="tab === 'governance'" title="AI 退出与有限复核" subtitle="字段单位、生效时点与读取方都来自服务端治理矩阵；没有生产消费者的字段在此只读。">
        <p v-if="governanceError" class="error">{{ governanceError }}</p>
        <p v-if="governanceNotice" class="notice">{{ governanceNotice }}</p>
        <p v-if="!governanceRows.length && !governanceError" class="muted">治理矩阵尚未加载。</p>
        <template v-else>
          <div class="governance-rows">
            <div v-for="row in governanceRows" :key="row.path" class="governance-row">
              <div class="governance-head">
                <span class="governance-path">{{ row.path.split('.').pop() }}</span>
                <span class="muted">当前 {{ formatGovernanceValue(row) }} · 单位 {{ row.unit }} · {{ row.effectiveAt }}</span>
              </div>
              <p class="muted governance-meaning">{{ row.meaning }}</p>
              <label v-if="row.editable && row.kind === 'boolean'" class="governance-input"
                ><input v-model="governanceDraft[row.path]" type="checkbox" /><span>启用</span></label
              >
              <select v-else-if="row.editable && row.kind === 'enum'" v-model="governanceDraft[row.path]" class="governance-input">
                <option v-for="option in row.enum" :key="option" :value="option">{{ option }}</option>
              </select>
              <input
                v-else-if="row.editable"
                v-model.number="governanceDraft[row.path]"
                class="governance-input"
                :type="row.kind === 'integer' ? 'number' : 'number'"
                :step="row.kind === 'integer' ? 1 : 'any'"
                :min="row.min ?? undefined"
                :max="row.max ?? undefined"
              />
              <span v-else class="muted governance-locked">只读：{{ row.readOnlyReason ?? "服务端未开放该字段写入" }}</span>
            </div>
          </div>
          <label
            v-for="ack in governanceRequiredAcks"
            :key="ack"
            class="governance-ack"
            ><input v-model="governanceAcks" type="checkbox" :value="ack" /><span>{{ governanceAckLabel(ack) }}</span></label
          >
          <div class="toolbar">
            <button class="button secondary" :disabled="!governanceDirty || saving" @click="loadGovernance">取消未保存修改</button>
            <button class="button" :disabled="!governanceDirty || saving || !governanceSubmit.ok" @click="saveGovernance">
              保存治理设置{{ governanceDirty ? `（${governanceDirty} 项）` : "" }}
            </button>
            <span v-if="governanceSubmit.reason" class="muted">{{ governanceSubmit.reason }}</span>
            <span v-if="governance?.ownershipSchema" class="muted">账本 schema v{{ governance.ownershipSchema.schemaVersion }}</span>
          </div>
        </template>
      </Panel>
      <Panel v-else-if="tab === 'exchange'" title="交易所资源">
        <div class="resource-manager-heading"><div><strong>交易所连接</strong><p>活动 TESTNET REST 只允许 Binance Demo；REST / WS 地址独立保存。资源修改先保存，再执行连接测试。</p></div></div>
        <div class="resource-manager-layout single-resource">
          <aside class="resource-card-list">
            <button v-for="choice in resources.exchange" :key="choice.id" class="resource-card selected">
              <span class="resource-card-head"><strong>{{choice.name||choice.id}}</strong><span class="resource-state" data-state="ACTIVE">活动</span></span>
              <span>{{choice.environment}}</span><span class="mono">{{choice.restBaseUrl}}</span>
            </button>
          </aside>
          <div class="resource-detail">
            <div v-for="item in selectedResources('exchange')" :key="item.id" class="resource-detail-body">
              <div class="resource-detail-title"><div><h3>{{item.name||'Binance USD-M'}}</h3><span class="mono">{{item.id}}</span></div><span v-if="isResourceDirty('exchange',item)" class="dirty-label">有未保存修改</span></div>
              <div class="form-grid two">
                <label><span>环境</span><select v-model="item.environment"><option>TESTNET</option><option>PRODUCTION</option></select></label>
                <label><span>执行模式</span><select v-model="item.executionMode"><option>READ_ONLY</option><option>TESTNET_ENABLED</option></select></label>
                <label><span>Credential Ref</span><input v-model="item.credentialRef" /></label>
                <label class="wide-field"><span>REST Base URL</span><input v-model="item.restBaseUrl" /></label>
                <label class="wide-field"><span>WS Base URL</span><input v-model="item.wsBaseUrl" /></label>
              </div>
              <div class="resource-actions"><span class="muted">编辑 → 保存 → 测试。交易所资源不能直接删除。</span><div><button class="button primary" :disabled="!isResourceDirty('exchange',item)" @click="saveResource('exchange',item)">保存资源</button><button class="button secondary" :disabled="!isResourceDirty('exchange',item)" @click="cancelResourceEdits('exchange')">取消修改</button><button class="button secondary" :disabled="isResourceDirty('exchange',item)" @click="testResource('exchange',item)">测试连接</button></div></div>
            </div>
          </div>
        </div>
        <section class="settings-subsection"><h3>API 凭证</h3><div class="form-grid two"><label><span>凭证状态</span><input :value="credentialStatus?.configured ? 'READY' : 'NOT_CONFIGURED'" disabled /></label><span></span><label><span>API Key</span><input v-model="apiKey" type="password" autocomplete="off" /></label><label><span>API Secret</span><input v-model="apiSecret" type="password" autocomplete="off" /></label></div><div class="resource-actions"><span class="muted">凭证不会显示回页面；测试不保存，验证并保存才写入安全存储。</span><div><button class="button secondary" @click="testCredentials">仅验证凭证</button><button class="button primary" @click="saveCredentials">验证并保存凭证</button></div></div></section>
      </Panel>
      <Panel v-else-if="tab === 'proxy'" title="网络代理资源">
        <div class="resource-manager-heading">
          <div><strong>代理资源与活动路由分开管理</strong><p>可保存多个 SOCKS5H 代理；只有标记为“活动”的资源承载 Binance REST / WS。保存资源不会自动替换当前活动代理。</p></div>
          <button class="button primary" @click="addResource('proxy')">新增代理</button>
        </div>
        <div class="resource-manager-layout">
          <aside class="resource-card-list" aria-label="网络代理资源列表">
            <button v-for="choice in resources.proxy" :key="choice.id" class="resource-card" :class="{selected:selectedResourceId.proxy===choice.id,dirty:isResourceDirty('proxy',choice)}" @click="selectedResourceId.proxy=choice.id">
              <span class="resource-card-head"><strong>{{choice.name||choice.id}}</strong><span class="resource-state" :data-state="choice.active?'ACTIVE':choice.status">{{choice.active?'活动':(choice.status??'READY')}}</span></span>
              <span class="mono">{{choice.url}}</span>
              <span>{{choice.enabled?'已启用':'已停用'}}<em v-if="isResourceDirty('proxy',choice)"> · 未保存</em></span>
            </button>
            <p v-if="!resources.proxy.length" class="muted">尚无代理资源。</p>
          </aside>
          <div class="resource-detail">
            <div v-for="item in selectedResources('proxy')" :key="item.id" class="resource-detail-body">
              <div class="resource-detail-title">
                <div><h3>{{item.name||'新代理'}}</h3><span class="mono">{{item.id}}</span></div>
                <span v-if="item.active" class="active-label">当前活动路由</span>
                <span v-else-if="isResourceDirty('proxy',item)" class="dirty-label">有未保存修改</span>
              </div>
              <div class="form-grid two">
                <label><span>资源名称</span><input v-model="item.name" placeholder="例如：新加坡专用交易代理" /></label>
                <label><span>类型</span><input value="SOCKS5H" disabled /></label>
                <label class="wide-field"><span>Proxy URL</span><input v-model="item.url" placeholder="socks5h://127.0.0.1:20091" /><small>建议使用 socks5h://，DNS 也由代理出口解析。</small></label>
                <label class="switch-row"><span>启用资源</span><input v-model="item.enabled" type="checkbox" /></label>
              </div>
              <div class="resource-health-grid">
                <div><small>状态</small><strong>{{item.active?'ACTIVE':(item.status??'READY')}}</strong></div>
                <div><small>最近测试延迟</small><strong>{{resourceProbeResults[item.id]?.latencyMs==null?'—':resourceProbeResults[item.id].latencyMs+' ms'}}</strong></div>
                <div><small>测试结果</small><strong>{{resourceProbeResults[item.id]?.status??'尚未测试'}}</strong></div>
              </div>
              <div class="resource-actions">
                <span class="muted">标准流程：编辑 → 保存 → 测试 → 激活。活动代理变更会 hot-apply。</span>
                <div>
                  <button class="button primary" :disabled="!isResourceDirty('proxy',item)" @click="saveResource('proxy',item)">保存资源</button>
                  <button class="button secondary" :disabled="!isResourceDirty('proxy',item)" @click="cancelResourceEdits('proxy')">取消修改</button>
                  <button class="button secondary" :disabled="isResourceDirty('proxy',item)" @click="testResource('proxy',item)">测试连接</button>
                  <button class="button secondary" :disabled="isResourceDirty('proxy',item)||item.active||!item.enabled" @click="activateResource('proxy',item.id)">设为活动</button>
                  <button class="button danger" :disabled="item.active" @click="removeResource('proxy',item.id)">删除</button>
                </div>
              </div>
            </div>
            <EmptyState v-if="!selectedResources('proxy').length" title="选择一个代理资源" detail="右侧可编辑、测试并激活代理。" />
          </div>
        </div>
      </Panel>
      <Panel v-else-if="tab === 'ai'" title="AI 模型资源">
        <div class="ai-resource-heading"><div><strong>资源与逻辑职责分开管理</strong><p>资源只描述实际 OpenAI-compatible endpoint；GPU 标识是备注，真实设备由模型服务启动配置决定。</p></div><button class="button primary" @click="addResource('ai')">新增空白资源</button></div>
        <div class="ai-resource-layout">
          <aside class="ai-resource-list" aria-label="AI 资源列表">
            <button v-for="choice in resources.ai" :key="choice.id" class="ai-resource-card" :class="{selected:selectedResourceId.ai===choice.id,dirty:isResourceDirty('ai',choice)}" @click="selectedResourceId.ai=choice.id">
              <span class="ai-resource-card-head"><strong>{{choice.name||choice.model||choice.id}}</strong><span class="ai-state" :data-state="choice.status">{{choice.status??'UNKNOWN'}}</span></span>
              <span>{{choice.model||'Model 未填写'}}</span><span class="mono">{{choice.baseUrl||'Endpoint 未填写'}}</span>
              <span>{{choice.gpu||'未指定设备'}} · 活动 {{choice.activeRequests??0}} · 队列 {{choice.queueDepth??0}}</span>
              <span class="ai-duty-tags"><i v-for="duty in choice.duties??[]" :key="duty">{{aiDutyLabels[duty]??duty}}</i><em v-if="isResourceDirty('ai',choice)">未保存修改</em></span>
            </button>
            <p v-if="!resources.ai.length" class="muted">尚无 AI endpoint。新增后填写真实地址和模型 id。</p>
          </aside>
          <div class="ai-resource-detail">
            <div v-for="item in selectedResources('ai')" :key="item.id" class="ai-detail-body">
              <div class="ai-detail-title"><div><h3>{{item.name||'新 AI 资源'}}</h3><span class="mono">{{item.id}}</span></div><span v-if="isResourceDirty('ai',item)" class="dirty-label">本资源有未保存修改</span></div>
              <div class="form-grid two">
                <label><span>资源名称</span><input v-model="item.name" placeholder="例如：GPU2 27B Reviewer" /></label>
                <label><span>Model id</span><input v-model="item.model" placeholder="从 /v1/models 实际读回" /></label>
                <label class="wide-field"><span>OpenAI-compatible Base URL</span><input v-model="item.baseUrl" placeholder="http://127.0.0.1:<实测端口>/v1" /></label>
                <label><span>设备标识（仅备注）</span><input v-model="item.gpu" placeholder="AMD Radeon RX 7900 XTX" /><small>仅为资源标识；实际 GPU 由模型服务启动配置决定。</small></label>
                <label><span>最大并发</span><input v-model.number="item.maxConcurrency" type="number" min="1" max="16" /></label>
                <label class="switch-row"><span>启用资源</span><input v-model="item.enabled" type="checkbox" /></label>
              </div>
              <div class="ai-health-grid"><div><small>实际探测 Model id</small><strong>{{(aiProbeResults[item.id]?.models??[]).join(', ')||'尚未执行连接测试'}}</strong></div><div><small>最近健康检查</small><strong>{{item.healthCheckedAt?new Date(item.healthCheckedAt).toLocaleString():'尚无'}}</strong></div><div><small>最近延迟</small><strong>{{item.latencyMs==null?'—':`${item.latencyMs} ms`}}</strong></div><div><small>累计运行 / 失败</small><strong>{{item.totalRuns??0}} / {{item.failures??0}}</strong></div></div>
              <p v-if="item.lastError" class="error-text">{{item.lastError}}</p>
              <div class="ai-resource-actions"><span class="muted">保存使用 Settings 版本冲突保护，并在保存后执行服务端读回。</span><div><button class="button primary" :disabled="!isResourceDirty('ai',item)" @click="saveResource('ai',item)">保存资源</button><button class="button secondary" :disabled="!isResourceDirty('ai',item)" @click="cancelResourceEdits('ai')">取消修改</button><button class="button secondary" :disabled="isResourceDirty('ai',item)||!item.baseUrl" @click="testResource('ai',item)">测试连接</button><button class="button danger" @click="removeResource('ai',item.id)">删除</button></div></div>
            </div>
            <EmptyState v-if="!selectedResources('ai').length" title="选择一个 AI 资源" detail="资源详情会显示连接、健康和运行指标。" />
          </div>
        </div>
        <section class="ai-duty-routes"><div class="ai-duty-heading"><div><h3>职责路由</h3><p>同一物理资源可以承担多个职责；Review 模型只输出判断，交易所动作由确定性 coordinator 执行。</p></div><button class="button primary" :disabled="JSON.stringify(aiRouteDraft)===JSON.stringify(draft?.aiDutyRoutes??[])" @click="saveAiRoutes">保存职责路由</button></div>
          <div class="ai-duty-grid"><label v-for="duty in Object.keys(aiDutyLabels)" :key="duty"><span>{{aiDutyLabels[duty]}}</span><select :value="routeResourceId(duty)" @change="onAiRouteChange(duty,$event)"><option value="">未配置</option><option v-for="resource in resources.ai.filter(row=>row.enabled)" :key="resource.id" :value="resource.id">{{resource.name||resource.model||resource.id}} · {{resource.model}}</option></select></label></div>
          <div class="route-notes"><span>POSITION_REVIEW 优先于 PENDING_ENTRY_REVIEW；GPU2 Review 并发为 1。</span><span>GPU2 故障不会回退占用 GPU1 Entry Primary。</span></div>
        </section>
      </Panel>
      <Panel v-else title="外观主题"
        ><div class="form-grid two">
          <label
            ><span>主题</span
            ><select v-model="draft.appearance.theme" @change="applyTheme">
              <option v-for="[id, name] in themes" :key="id" :value="id">
                {{ name }}
              </option></select
            ><small>{{ themeDescription }}</small></label
          >
        </div></Panel
      >
    </template>
  </div>
</template>

<style scoped>
.ai-resource-heading,.ai-duty-heading,.ai-detail-title,.ai-resource-card-head{display:flex;align-items:center;justify-content:space-between;gap:1rem}
.ai-resource-heading p,.ai-duty-heading p{margin:.35rem 0 0;color:var(--text-muted)}
.ai-resource-layout{display:grid;grid-template-columns:minmax(250px,31%) minmax(0,1fr);gap:1rem;margin-top:1rem;align-items:start}
.ai-resource-list{display:grid;gap:.65rem;max-height:70vh;overflow:auto;padding-right:.2rem}
.ai-resource-card{display:grid;gap:.35rem;width:100%;padding:.9rem;text-align:left;border:1px solid var(--line);border-radius:.75rem;background:var(--surface);color:inherit;cursor:pointer;overflow-wrap:anywhere}
.ai-resource-card.selected{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.ai-resource-card.dirty{background:color-mix(in srgb,var(--surface),var(--warning) 8%)}
.ai-resource-card>span:not(:first-child){font-size:.82rem;color:var(--text-muted)}
.ai-state{padding:.15rem .45rem;border-radius:999px;font-size:.68rem;background:#333;color:#ddd}
.ai-state[data-state="ONLINE"]{background:#143b2e;color:#8be0b8}.ai-state[data-state="BUSY"]{background:#493817;color:#f7ce69}.ai-state[data-state="OFFLINE"]{background:#4b2024;color:#ff9b9b}
.ai-duty-tags{display:flex;flex-wrap:wrap;gap:.3rem}.ai-duty-tags i,.ai-duty-tags em{font-size:.68rem;font-style:normal;padding:.12rem .4rem;border-radius:999px;background:color-mix(in srgb,var(--surface),var(--accent) 12%)}.ai-duty-tags em,.dirty-label{color:var(--accent)}
.ai-resource-detail{min-width:0;border:1px solid var(--line);border-radius:.75rem;padding:1rem;background:var(--surface)}
.ai-detail-title{margin-bottom:1rem}.ai-detail-title h3,.ai-duty-heading h3{margin:0 0 .25rem}.ai-detail-title .mono{font-size:.75rem;color:var(--text-muted)}
.wide-field{grid-column:1/-1}.ai-detail-body small{display:block;margin-top:.25rem;color:var(--text-muted)}
.ai-health-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.65rem;margin-top:1rem}
.ai-health-grid>div{display:grid;gap:.3rem;min-width:0;padding:.7rem;border:1px solid var(--line);border-radius:.55rem;overflow-wrap:anywhere}
.ai-health-grid strong{font-size:.82rem}.ai-health-grid small{margin:0}
.ai-resource-actions{display:flex;justify-content:space-between;align-items:center;gap:.8rem;margin-top:1rem;padding-top:.9rem;border-top:1px solid var(--line)}
.ai-resource-actions>div{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.4rem}
.ai-duty-routes{margin-top:1.25rem;padding:1rem;border:1px solid var(--line);border-radius:.75rem;background:var(--surface)}
.ai-duty-heading{margin-bottom:.9rem}.ai-duty-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}
.ai-duty-grid label{display:grid;gap:.4rem}.ai-duty-grid select{min-width:0;width:100%}
.route-notes{display:flex;justify-content:space-between;gap:.8rem;flex-wrap:wrap;margin-top:.8rem;color:var(--text-muted);font-size:.78rem}
@media(max-width:900px){.ai-resource-layout{grid-template-columns:1fr}.ai-resource-list{max-height:320px}.ai-health-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.ai-duty-grid{grid-template-columns:1fr}.ai-resource-heading,.ai-duty-heading,.ai-resource-actions{align-items:flex-start;flex-direction:column}.ai-resource-actions>div{justify-content:flex-start}.ai-health-grid{grid-template-columns:1fr}}
</style>
