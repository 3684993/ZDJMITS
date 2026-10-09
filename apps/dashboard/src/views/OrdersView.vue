<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSystemStore } from '../stores/system';
import { api, brainRun } from '../api/client';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import { age } from '../format';

const s=useSystemStore(),tab=ref<'entry'|'tp'|'manual'|'history'|'entryHistory'>('entry'),tps=computed(()=>s.snapshot?.tpOrders??[]),manual=ref<any[]>([]),entries=ref<any[]>([]),history=ref<any[]>([]),historyWindow=ref<any>({visibleCount:0,olderHiddenCount:0}),readback=ref<any>({status:'UNAVAILABLE'}),busyId=ref(''),message=ref(''),messageKind=ref<'success'|'error'|''>('');
const ttl=(ts:number)=>Math.max(0,Math.ceil((ts-Date.now())/60000));
const historicalCount=computed(()=>history.value.length);
const entryHistory=ref<any>({items:[],total:0,olderHiddenCount:0}),historyStatus=ref('ALL'),historyOffset=ref(0),loading=ref(false),loadedAt=ref<number|null>(null),runDetail=ref<any>(null);
const stamp=(ts:any)=>ts?new Date(ts).toLocaleString():'—';
const mask=(id:any)=>id?String(id).slice(0,6)+'…'+String(id).slice(-4):'—';
let refreshTimer:ReturnType<typeof setInterval>|undefined,alive=true;
async function loadOrders(){if(loading.value)return;loading.value=true;try{const result=await api.orders(new URLSearchParams({status:historyStatus.value,offset:String(historyOffset.value),limit:'50',days:'7'}).toString());if(!alive)return;entryHistory.value=result.entryHistory??{items:[],total:0,olderHiddenCount:0};entries.value=result.entry??[];history.value=result.historicalUnknown??[];historyWindow.value=result.historicalUnknownWindow??{visibleCount:history.value.length,olderHiddenCount:0};readback.value=result.entryReadback??{status:'UNAVAILABLE'};manual.value=(result.manual??[]).filter((row:any)=>['NEW','WORKING','PARTIALLY_FILLED','SUBMITTING'].includes(row.status));loadedAt.value=Date.now();}catch(error){readback.value={...readback.value,status:'STALE'};message.value=error instanceof Error?error.message:String(error);messageKind.value='error';}finally{loading.value=false;}}
async function showRun(id:string){try{runDetail.value=await brainRun(id);}catch(error){message.value=String(error);messageKind.value='error';}}
const focusRefresh=()=>{if(!document.hidden)void loadOrders();};
watch(historyStatus,()=>{historyOffset.value=0;void loadOrders();});
async function cancelOrder(order:any){if(busyId.value)return;busyId.value=order.id;message.value='';messageKind.value='';try{const result:any=await api.cancelEntry(order.id);message.value=result.status==='FILLED'?'取消前订单已成交，已读回 FILLED。':`交易所已确认 ${result.status}。`;messageKind.value='success';await Promise.all([loadOrders(),s.refresh(['SNAPSHOT'])]);}catch(error){message.value=error instanceof Error?error.message:String(error);messageKind.value='error';await loadOrders();}finally{busyId.value='';}}
async function loadManual(){await loadOrders();}
onMounted(()=>{void loadOrders();refreshTimer=setInterval(focusRefresh,15000);window.addEventListener('focus',focusRefresh);document.addEventListener('visibilitychange',focusRefresh);});
onUnmounted(()=>{alive=false;clearInterval(refreshTimer);window.removeEventListener('focus',focusRefresh);document.removeEventListener('visibilitychange',focusRefresh);});
</script>

<template>
  <div class="page-stack">
    <div><button class="button secondary" :disabled="loading" @click="loadOrders()">{{loading?'刷新中…':'刷新'}}</button> <span class="muted">更新 {{stamp(loadedAt)}} · 活动快照 {{readback.status}} · 每15秒刷新（页面可见时）</span></div>
    <div class="segmented">
      <button :class="{active:tab==='entry'}" @click="tab='entry'">交易所活动建仓（{{entries.length}}）</button>
      <button :class="{active:tab==='tp'}" @click="tab='tp'">止盈委托（{{tps.length}}）</button>
      <button :class="{active:tab==='manual'}" @click="tab='manual';loadManual()">人工委托（{{manual.length}}）</button>
      <button :class="{active:tab==='entryHistory'}" @click="tab='entryHistory'">全部建仓历史（{{entryHistory.total}}）</button>
      <button :class="{active:tab==='history'}" @click="tab='history'">历史未确认（{{historicalCount}}）</button>
    </div>
    <p v-if="message" role="status" :class="messageKind==='error'?'error-text':'success-text'">{{message}}</p>
    <Panel v-if="tab==='entry'" title="交易所活动建仓委托" :subtitle="`来自最近一次完整交易所 open-orders 快照：${readback.status}${readback.verifiedAt?' · '+new Date(readback.verifiedAt).toLocaleString():''}。历史 UNKNOWN 独立保留，不计入活动数量。`">
      <table v-if="entries.length" class="data-table"><thead><tr><th>创建时间</th><th>Symbol</th><th>Direction</th><th>Qty / Notional</th><th>Initial Margin / Leverage</th><th>Expected net / Required</th><th>TP / Horizon</th><th>Filled</th><th>状态</th><th>操作</th></tr></thead><tbody>
        <tr v-for="o in entries" :key="o.id"><td>{{new Date(o.createdAt).toLocaleString()}}</td><td class="symbol">{{o.symbol}}</td><td>{{o.side}}</td><td>{{o.quantity}}<small>{{(Number(o.quantity)*Number(o.price)).toFixed(4)}} quote</small></td><td>{{(Number(o.quantity)*Number(o.price)/Math.max(1,Number(o.leverage??o.economicMandate?.sizing?.leverage??1))).toFixed(4)}} / {{o.leverage??o.economicMandate?.sizing?.leverage??'—'}}x</td><td>{{o.economicMandate?.economics?.expectedNetQuote??'—'}} / {{o.economicMandate?.economics?.minimumNetProfitQuote??'—'}}</td><td>{{o.economicMandate?.economics?.targetPrice??'—'}}<small>{{o.economicMandate?.economics?.targetHorizonMinutes??'—'}} min</small></td><td>{{o.filledQuantity}}</td><td><StatusBadge :value="o.status"/></td><td><button class="button tiny secondary" :disabled="busyId!==''||readback.status!=='READY'" @click="cancelOrder(o)">{{busyId===o.id?'取消中…':'取消'}}</button></td></tr>
      </tbody></table>
      <EmptyState v-else :title="readback.status==='READY'?'交易所当前没有活动建仓委托':'暂无可确认的活动委托'" :detail="readback.status==='READY'?'最近一次完整 open-orders 快照中的 Entry 数量为 0。':'等待新鲜、完整的交易所 open-orders 快照；不会把本地 UNKNOWN 当成活动订单。'"/>
    </Panel>
    <Panel v-else-if="tab==='tp'" title="止盈委托" subtitle="止盈保护状态来自交易所事实；经济质量单独核验。">
      <table v-if="tps.length" class="data-table"><thead><tr><th>创建时间</th><th>Symbol</th><th>Position</th><th>Side</th><th>Qty</th><th>TP Price</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="o in tps" :key="o.id"><td>{{new Date(o.createdAt).toLocaleString()}}</td><td class="symbol">{{o.symbol}}</td><td class="mono">{{o.positionId}}</td><td>{{o.side}}</td><td>{{o.quantity}}</td><td>{{o.price}}</td><td><StatusBadge :value="o.status"/></td><td><span class="muted">由持仓页管理</span></td></tr></tbody></table><EmptyState v-else title="当前没有活动止盈委托"/>
    </Panel>
    <Panel v-else-if="tab==='manual'" title="交易所活动人工委托" subtitle="只显示当前 open-orders 快照中的人工订单。">
      <table v-if="manual.length" class="data-table"><thead><tr><th>创建时间</th><th>Symbol</th><th>Position</th><th>类型</th><th>方向</th><th>Qty</th><th>价格</th><th>状态</th></tr></thead><tbody><tr v-for="o in manual" :key="o.id"><td>{{new Date(o.createdAt).toLocaleString()}}</td><td class="symbol">{{o.symbol}}</td><td class="mono">{{o.positionId}}</td><td>{{o.type}}</td><td>{{o.side}}</td><td>{{o.quantity}}</td><td>{{o.price??'市价'}}</td><td><StatusBadge :value="o.status"/></td></tr></tbody></table><EmptyState v-else title="当前没有活动人工委托"/>
    </Panel>
    <Panel v-else-if="tab==='entryHistory'" title="全部建仓历史" :subtitle="`最近7天 · ${entryHistory.total} 条 · 更早隐藏 ${entryHistory.olderHiddenCount} 条${entryHistory.eventsTruncated?' · 事件窗口截断，缺失证据保持未知':''}。历史只读，不提供提交或取消。`">
      <label>状态 <select v-model="historyStatus" :disabled="loading"><option value="ALL">全部</option><option value="WORKING">活动</option><option value="FILLED">已成交</option><option value="PARTIALLY_FILLED">部分成交</option><option value="CANCELED">已撤单</option><option value="CANCELED_PARTIAL_FILL">部分成交后撤单</option><option value="EXPIRED">交易所已过期</option><option value="LOCAL_TTL_EXPIRED_REMOTE_UNKNOWN">本地超时 · 远端未知</option><option value="REJECTED">已拒绝</option><option value="UNKNOWN">未确认</option></select></label>
      <table v-if="entryHistory.items.length" class="data-table"><thead><tr><th>创建 / 提交</th><th>Symbol / 方向</th><th>数量 / 价格</th><th>已成 / 剩余</th><th>当前状态 / 来源</th><th>成交 / 撤销 / 终止观察时间</th><th>期限 / 原因</th><th>Review / AI Run</th><th>订单身份 / 尝试</th></tr></thead><tbody>
        <tr v-for="o in entryHistory.items" :key="o.id"><td>{{stamp(o.createdAt)}}<small>{{stamp(o.submittedAt)}} · {{o.wasSubmitted?'曾成功提交':'提交未证实'}}</small><small>更新 {{stamp(o.updatedAt)}}</small></td><td>{{o.symbol}} / {{o.side}}</td><td>{{o.quantity}} / {{o.price}}</td><td>{{o.filledQuantity??'未知'}} / {{o.remainingQuantity??'未知'}}</td><td><StatusBadge :value="o.lifecycleStatus"/><small>{{o.statusAuthority}} · {{o.freshness}}</small><small>核验 {{stamp(o.lastExchangeVerifiedAt)}}</small></td><td>{{stamp(o.firstFillAt)}}<small>最后成交 {{stamp(o.lastFillAt)}} · {{o.timestampAuthority}}</small><small>撤销 {{stamp(o.canceledAt)}}</small><small>终止 {{stamp(o.terminalAt)}}</small></td><td>{{stamp(o.absoluteExpiresAt)}}<small>{{o.terminalReason??'—'}}</small></td><td><div v-for="(r,i) in o.review" :key="i">{{stamp(r.at)}} {{r.decision}}<small>{{r.reason??'未记录模型理由'}}</small></div><button v-if="o.decisionRunId" class="button tiny secondary" @click="showRun(o.decisionRunId)">查看 AI Run {{o.decisionRunId}}</button><span v-else>归属未知</span></td><td>{{mask(o.clientOrderId)}}<small>{{mask(o.exchangeOrderId)}}</small><details><summary>尝试 {{o.orderAttempts.length}} / 改价 {{o.repriceHistory.length}} · 尝试总成交 {{o.attemptFilledQuantity??'未知'}}</summary><div v-for="(a,i) in o.orderAttempts" :key="i">{{mask(a.exchangeOrderId)}} {{a.lifecycleStatus}} · 成交 {{a.filledQuantity??'未知'}} · {{stamp(a.terminalAt)}}</div><div v-for="(r,i) in o.repriceHistory" :key="i">{{stamp(r.at)}} {{r.from}} → {{r.to}} {{r.reason}}</div><small v-if="o.evidenceIncomplete">尝试身份或归属证据不完整</small></details></td></tr>
      </tbody></table><EmptyState v-else title="当前筛选没有建仓历史"/>
      <button :disabled="historyOffset===0||loading" @click="historyOffset=Math.max(0,historyOffset-50);loadOrders()">上一页</button><span> {{historyOffset+1}}–{{Math.min(historyOffset+50,entryHistory.total)}} / {{entryHistory.total}} </span><button :disabled="historyOffset+50>=entryHistory.total||loading" @click="historyOffset+=50;loadOrders()">下一页</button>
    </Panel>
    <Panel v-else title="历史未确认建仓记录" :subtitle="`普通界面只显示最近24小时（${historyWindow.visibleCount}）；更早隐藏 ${historyWindow.olderHiddenCount} 条。保留原始身份和风险证据用于对账；这些记录不是交易所当前 open orders，也不能盲目调用取消接口。`">
      <table v-if="history.length" class="data-table"><thead><tr><th>记录时间</th><th>Symbol</th><th>Direction</th><th>Qty</th><th>交易所单号</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="o in history" :key="o.id"><td>{{new Date(o.updatedAt??o.createdAt).toLocaleString()}}</td><td class="symbol">{{o.symbol}}</td><td>{{o.side}}</td><td>{{o.quantity}}</td><td class="mono">{{o.exchangeOrderId??'未知'}}</td><td><StatusBadge :value="o.status"/></td><td><span class="muted">非活动单 · 不可取消</span></td></tr></tbody></table><EmptyState v-else title="没有历史未确认记录"/>
    </Panel>
    <Panel v-if="runDetail" title="关联 AI Run 审计"><button @click="runDetail=null">关闭</button><pre>{{JSON.stringify({run:runDetail.run?.id,execution:runDetail.execution,timeline:runDetail.timeline,orderFact:runDetail.orderFact},null,2)}}</pre></Panel>
  </div>
</template>
