<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSystemStore } from '../stores/system';
import { api } from '../api/client';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import { age } from '../format';

const s=useSystemStore(),tab=ref<'entry'|'tp'|'manual'|'history'>('entry'),tps=computed(()=>s.snapshot?.tpOrders??[]),manual=ref<any[]>([]),entries=ref<any[]>([]),history=ref<any[]>([]),historyWindow=ref<any>({visibleCount:0,olderHiddenCount:0}),readback=ref<any>({status:'UNAVAILABLE'}),busyId=ref(''),message=ref(''),messageKind=ref<'success'|'error'|''>('');
const ttl=(ts:number)=>Math.max(0,Math.ceil((ts-Date.now())/60000));
const historicalCount=computed(()=>history.value.length);
async function loadOrders(){try{const result=await api.orders();entries.value=result.entry??[];history.value=result.historicalUnknown??[];historyWindow.value=result.historicalUnknownWindow??{visibleCount:history.value.length,olderHiddenCount:0};readback.value=result.entryReadback??{status:'UNAVAILABLE'};manual.value=(result.manual??[]).filter((row:any)=>['NEW','WORKING','PARTIALLY_FILLED','SUBMITTING'].includes(row.status));}catch(error){message.value=error instanceof Error?error.message:String(error);messageKind.value='error';}}
async function cancelOrder(order:any){if(busyId.value)return;busyId.value=order.id;message.value='';messageKind.value='';try{const result:any=await api.cancelEntry(order.id);message.value=result.status==='FILLED'?'取消前订单已成交，已读回 FILLED。':`交易所已确认 ${result.status}。`;messageKind.value='success';await Promise.all([loadOrders(),s.refresh(['SNAPSHOT'])]);}catch(error){message.value=error instanceof Error?error.message:String(error);messageKind.value='error';await loadOrders();}finally{busyId.value='';}}
async function loadManual(){await loadOrders();}
onMounted(()=>{void loadOrders();});
</script>

<template>
  <div class="page-stack">
    <div class="segmented">
      <button :class="{active:tab==='entry'}" @click="tab='entry'">交易所活动建仓（{{entries.length}}）</button>
      <button :class="{active:tab==='tp'}" @click="tab='tp'">止盈委托（{{tps.length}}）</button>
      <button :class="{active:tab==='manual'}" @click="tab='manual';loadManual()">人工委托（{{manual.length}}）</button>
      <button :class="{active:tab==='history'}" @click="tab='history'">历史未确认（{{historicalCount}}）</button>
    </div>
    <p v-if="message" role="status" :class="messageKind==='error'?'error-text':'success-text'">{{message}}</p>
    <Panel v-if="tab==='entry'" title="交易所活动建仓委托" :subtitle="`来自最近一次完整交易所 open-orders 快照：${readback.status}${readback.verifiedAt?' · '+new Date(readback.verifiedAt).toLocaleString():''}。历史 UNKNOWN 独立保留，不计入活动数量。`">
      <table v-if="entries.length" class="data-table"><thead><tr><th>创建时间</th><th>Symbol</th><th>Direction</th><th>Qty / Notional</th><th>Initial Margin / Leverage</th><th>Expected net / Required</th><th>TP / Horizon</th><th>Filled</th><th>状态</th><th>操作</th></tr></thead><tbody>
        <tr v-for="o in entries" :key="o.id"><td>{{new Date(o.createdAt).toLocaleString()}}</td><td class="symbol">{{o.symbol}}</td><td>{{o.side}}</td><td>{{o.quantity}}<small>{{(Number(o.quantity)*Number(o.price)).toFixed(4)}} quote</small></td><td>{{(Number(o.quantity)*Number(o.price)/Math.max(1,Number(o.leverage??o.economicMandate?.sizing?.leverage??1))).toFixed(4)}} / {{o.leverage??o.economicMandate?.sizing?.leverage??'—'}}x</td><td>{{o.economicMandate?.economics?.expectedNetQuote??'—'}} / {{o.economicMandate?.economics?.minimumNetProfitQuote??'—'}}</td><td>{{o.economicMandate?.economics?.targetPrice??'—'}}<small>{{o.economicMandate?.economics?.targetHorizonMinutes??'—'}} min</small></td><td>{{o.filledQuantity}}</td><td><StatusBadge :value="o.status"/></td><td><button class="button tiny secondary" :disabled="busyId!==''" @click="cancelOrder(o)">{{busyId===o.id?'取消中…':'取消'}}</button></td></tr>
      </tbody></table>
      <EmptyState v-else :title="readback.status==='READY'?'交易所当前没有活动建仓委托':'暂无可确认的活动委托'" :detail="readback.status==='READY'?'最近一次完整 open-orders 快照中的 Entry 数量为 0。':'等待新鲜、完整的交易所 open-orders 快照；不会把本地 UNKNOWN 当成活动订单。'"/>
    </Panel>
    <Panel v-else-if="tab==='tp'" title="止盈委托" subtitle="止盈保护状态来自交易所事实；经济质量单独核验。">
      <table v-if="tps.length" class="data-table"><thead><tr><th>创建时间</th><th>Symbol</th><th>Position</th><th>Side</th><th>Qty</th><th>TP Price</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="o in tps" :key="o.id"><td>{{new Date(o.createdAt).toLocaleString()}}</td><td class="symbol">{{o.symbol}}</td><td class="mono">{{o.positionId}}</td><td>{{o.side}}</td><td>{{o.quantity}}</td><td>{{o.price}}</td><td><StatusBadge :value="o.status"/></td><td><span class="muted">由持仓页管理</span></td></tr></tbody></table><EmptyState v-else title="当前没有活动止盈委托"/>
    </Panel>
    <Panel v-else-if="tab==='manual'" title="交易所活动人工委托" subtitle="只显示当前 open-orders 快照中的人工订单。">
      <table v-if="manual.length" class="data-table"><thead><tr><th>创建时间</th><th>Symbol</th><th>Position</th><th>类型</th><th>方向</th><th>Qty</th><th>价格</th><th>状态</th></tr></thead><tbody><tr v-for="o in manual" :key="o.id"><td>{{new Date(o.createdAt).toLocaleString()}}</td><td class="symbol">{{o.symbol}}</td><td class="mono">{{o.positionId}}</td><td>{{o.type}}</td><td>{{o.side}}</td><td>{{o.quantity}}</td><td>{{o.price??'市价'}}</td><td><StatusBadge :value="o.status"/></td></tr></tbody></table><EmptyState v-else title="当前没有活动人工委托"/>
    </Panel>
    <Panel v-else title="历史未确认建仓记录" :subtitle="`普通界面只显示最近24小时（${historyWindow.visibleCount}）；更早隐藏 ${historyWindow.olderHiddenCount} 条。保留原始身份和风险证据用于对账；这些记录不是交易所当前 open orders，也不能盲目调用取消接口。`">
      <table v-if="history.length" class="data-table"><thead><tr><th>记录时间</th><th>Symbol</th><th>Direction</th><th>Qty</th><th>交易所单号</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="o in history" :key="o.id"><td>{{new Date(o.updatedAt??o.createdAt).toLocaleString()}}</td><td class="symbol">{{o.symbol}}</td><td>{{o.side}}</td><td>{{o.quantity}}</td><td class="mono">{{o.exchangeOrderId??'未知'}}</td><td><StatusBadge :value="o.status"/></td><td><span class="muted">非活动单 · 不可取消</span></td></tr></tbody></table><EmptyState v-else title="没有历史未确认记录"/>
    </Panel>
  </div>
</template>
