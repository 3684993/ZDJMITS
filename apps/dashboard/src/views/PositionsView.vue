<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSystemStore } from '../stores/system';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import PositionConsole from '../components/PositionConsole.vue';
import { money, pct } from '../format';
import { financialClass, pageItems, toggleExpanded } from '../positionModel';
import { cycleMoments, holdingDuration, positionCycleKey } from '../utils/holdingDuration';
import { useNow } from '../utils/useNow';

const s=useSystemStore(),page=ref(1),pageSize=ref(10),expandedId=ref<string|null>(null),isSmall=ref(false);
// A holding duration has to read as the physical cycle it belongs to, so it is recomputed against a
// ticking clock instead of only changing when somebody refreshes the page.
const now=useNow(30_000);
const holding=(p:any)=>holdingDuration(p,now.value);
const moments=(p:any)=>cycleMoments(p);
const environment=computed(()=>s.settings?.connections?.exchange?.environment??null);
const accountSource=computed(()=>s.snapshot?.account?.source??null);
// Rows are keyed on environment + account + symbol + side + cycle: a LONG and a SHORT on one symbol are
// never the same row, and a re-opened cycle never inherits the previous cycle's rendered state.
const cycleKey=(p:any)=>positionCycleKey(p,environment.value,accountSource.value);
// "Not protected" and "the exchange has not settled that this position exists" are different operator
// actions: the first is repaired by a TP, the second must never submit one. They never share a label.
const unresolved=(x:string)=>x==='POSITION_FACT_UNRESOLVED',bad=(x:string)=>x!=='PROTECTED'&&!unresolved(x);
const pnlClass=financialClass;
const totalPages=computed(()=>Math.max(1,Math.ceil(s.positions.length/pageSize.value))),visibleItems=computed(()=>pageItems(s.positions,page.value,pageSize.value));
let media:MediaQueryList|undefined;
function updateLayout(){isSmall.value=media?.matches??false}
onMounted(()=>{media=window.matchMedia('(max-width: 1199px)');updateLayout();media.addEventListener?.('change',updateLayout)});
onUnmounted(()=>media?.removeEventListener?.('change',updateLayout));
watch([()=>s.positions.length,pageSize],()=>{if(page.value>totalPages.value)page.value=totalPages.value;if(expandedId.value&&!visibleItems.value.some(p=>p.id===expandedId.value))expandedId.value=null;});
watch(page,()=>{expandedId.value=null;});
function focusRow(id:string){void nextTick(()=>document.querySelector(`tr[data-position-id="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'}));}
function toggle(id:string){expandedId.value=toggleExpanded(expandedId.value,id);if(expandedId.value&&!isSmall.value)focusRow(id);}
</script>
<template><div class="page-stack"><div v-if="s.snapshot?.account?.status!=='READY'" class="error-banner">交易所私有同步异常：以下为最后已知持仓，不保证与交易所当前仓位一致。{{s.snapshot?.account?.reason}}。行情更新不代表仓位已复核；系统会继续尝试同步。</div><div v-if="s.positions.some(p=>bad(p.tpStatus))" class="critical-banner">存在缺失或异常 TP；系统会自动补齐，人工 TP 修改也会进入同一保护链。</div><div v-if="s.positions.some(p=>unresolved(p.tpStatus))" data-tp-unresolved-banner="1" class="critical-banner">部分持仓的交易所仓位事实未决：系统不会为其提交 reduce-only 保护，也不把它计为未保护的持仓；等待交易所对账裁定后再收敛。</div><Panel title="当前持仓" subtitle="持有时间按物理周期的首次成交连续计算，补仓与部分平仓不重置；浮动盈亏与 ROE 使用固定金融语义颜色；移动端使用卡片与全屏控制台"><template #actions><label class="page-size-control">每页 <select v-model.number="pageSize"><option :value="10">10</option><option :value="20">20</option><option :value="50">50</option></select> 条</label></template>
<div v-if="!isSmall" class="position-table-wrap"><table class="data-table position-table"><thead><tr><th>持有时长 / 周期事实</th><th>Symbol</th><th>方向</th><th>TP 状态</th><th>浮动盈亏</th><th>ROE</th><th>管理</th><th>操作</th></tr></thead><tbody><template v-for="p in visibleItems" :key="cycleKey(p)"><tr :data-position-id="p.id" :class="{'tp-danger':bad(p.tpStatus),'selected':expandedId===p.id}" class="clickable"><td @click="toggle(p.id)"><strong data-holding-duration="">{{holding(p).text}}</strong><small data-holding-provenance="">{{holding(p).detail}}</small><small v-for="m in moments(p)" :key="m.key" data-cycle-moment="">{{m.text}}</small></td><td class="symbol" @click="toggle(p.id)">{{p.symbol}}</td><td @click="toggle(p.id)"><StatusBadge :value="p.side"/></td><td @click="toggle(p.id)"><StatusBadge :value="p.tpStatus"/><small>{{p.tpCoverageSource}}</small></td><td :class="pnlClass(p.unrealizedPnl)" @click="toggle(p.id)">{{money(p.unrealizedPnl)}}</td><td :class="pnlClass(p.unrealizedPnlPercent)" @click="toggle(p.id)">{{pct(p.unrealizedPnlPercent)}}</td><td>{{p.managementStatus}}</td><td><button class="button tiny secondary" @click.stop="toggle(p.id)">{{expandedId===p.id?'收起':'控制台'}}</button><button v-if="bad(p.tpStatus)" class="button tiny" @click.stop="s.repairTp(p.id)">补 TP</button></td></tr><tr v-if="expandedId===p.id" class="position-console-row"><td colspan="8"><PositionConsole :key="expandedId" :position-id="p.id" @close="expandedId=null"/></td></tr></template></tbody></table></div>
<div v-else class="position-card-list"><article v-for="p in visibleItems" :key="cycleKey(p)" class="position-card" :class="{'tp-danger':bad(p.tpStatus)}"><div class="position-card-head"><div><span class="eyebrow">{{p.symbol}}</span><strong>{{p.side}} · {{p.managementStatus}}</strong></div><StatusBadge :value="p.tpStatus"/></div><div class="position-card-metrics"><div><span>持有时间</span><strong data-holding-duration="">{{holding(p).text}}</strong></div><div><span>浮动盈亏</span><strong :class="pnlClass(p.unrealizedPnl)">{{money(p.unrealizedPnl)}}</strong></div><div><span>ROE</span><strong :class="pnlClass(p.unrealizedPnlPercent)">{{pct(p.unrealizedPnlPercent)}}</strong></div><div><span>TP 来源</span><strong>{{p.tpCoverageSource||'—'}}</strong></div></div><div class="cycle-moments" data-cycle-moments=""><small data-holding-provenance="">{{holding(p).detail}}</small><small v-for="m in moments(p)" :key="m.key" data-cycle-moment="">{{m.text}}</small></div><div class="position-card-actions"><button class="button primary full" @click="toggle(p.id)">控制台</button><button v-if="bad(p.tpStatus)" class="button secondary full" @click="s.repairTp(p.id)">补 TP</button></div></article></div>
<EmptyState v-if="!s.positions.length" title="当前无持仓"/><div v-else class="pagination-bar"><span>第 {{page}} / {{totalPages}} 页 · 共 {{s.positions.length}} 条</span><div><button class="button tiny secondary" :disabled="page<=1" @click="page--">上一页</button><button class="button tiny secondary" :disabled="page>=totalPages" @click="page++">下一页</button></div></div></Panel>
<div v-if="isSmall&&expandedId" class="mobile-console-backdrop" @click.self="expandedId=null"><div class="mobile-console-sheet"><PositionConsole :key="`mobile-${expandedId}`" :position-id="expandedId" @close="expandedId=null"/></div></div>
</div></template>

