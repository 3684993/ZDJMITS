<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSystemStore } from '../stores/system';
import Panel from '../components/Panel.vue';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import PositionConsole from '../components/PositionConsole.vue';
import { money, pct } from '../format';
import { financialClass, pageItems, toggleExpanded } from '../positionModel';

const s=useSystemStore(),page=ref(1),pageSize=ref(10),expandedId=ref<string|null>(null),isSmall=ref(false);
const bad=(x:string)=>x!=='PROTECTED',pnlClass=financialClass;
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
<template><div class="page-stack"><div v-if="s.snapshot?.account?.status!=='READY'" class="error-banner">交易所私有同步异常：以下为最后已知持仓，不保证与交易所当前仓位一致。{{s.snapshot?.account?.reason}}。行情更新不代表仓位已复核；系统会继续尝试同步。</div><div v-if="s.positions.some(p=>bad(p.tpStatus))" class="critical-banner">存在缺失或异常 TP；系统会自动补齐，人工 TP 修改也会进入同一保护链。</div><Panel title="当前持仓" subtitle="浮动盈亏与 ROE 使用固定金融语义颜色；移动端使用卡片与全屏控制台"><template #actions><label class="page-size-control">每页 <select v-model.number="pageSize"><option :value="10">10</option><option :value="20">20</option><option :value="50">50</option></select> 条</label></template>
<div v-if="!isSmall" class="position-table-wrap"><table class="data-table position-table"><thead><tr><th>建仓 / 首次同步</th><th>Symbol</th><th>方向</th><th>TP 状态</th><th>浮动盈亏</th><th>ROE</th><th>管理</th><th>操作</th></tr></thead><tbody><template v-for="p in visibleItems" :key="p.id"><tr :data-position-id="p.id" :class="{'tp-danger':bad(p.tpStatus),'selected':expandedId===p.id}" class="clickable"><td @click="toggle(p.id)">{{p.openedAt?new Date(p.openedAt).toLocaleString():'首次同步'}}<small v-if="p.firstObservedAt">首次同步 {{new Date(p.firstObservedAt).toLocaleString()}}</small></td><td class="symbol" @click="toggle(p.id)">{{p.symbol}}</td><td @click="toggle(p.id)"><StatusBadge :value="p.side"/></td><td @click="toggle(p.id)"><StatusBadge :value="p.tpStatus"/><small>{{p.tpCoverageSource}}</small></td><td :class="pnlClass(p.unrealizedPnl)" @click="toggle(p.id)">{{money(p.unrealizedPnl)}}</td><td :class="pnlClass(p.unrealizedPnlPercent)" @click="toggle(p.id)">{{pct(p.unrealizedPnlPercent)}}</td><td>{{p.managementStatus}}</td><td><button class="button tiny secondary" @click.stop="toggle(p.id)">{{expandedId===p.id?'收起':'控制台'}}</button><button v-if="bad(p.tpStatus)" class="button tiny" @click.stop="s.repairTp(p.id)">补 TP</button></td></tr><tr v-if="expandedId===p.id" class="position-console-row"><td colspan="8"><PositionConsole :key="expandedId" :position-id="p.id" @close="expandedId=null"/></td></tr></template></tbody></table></div>
<div v-else class="position-card-list"><article v-for="p in visibleItems" :key="p.id" class="position-card" :class="{'tp-danger':bad(p.tpStatus)}"><div class="position-card-head"><div><span class="eyebrow">{{p.symbol}}</span><strong>{{p.side}} · {{p.managementStatus}}</strong></div><StatusBadge :value="p.tpStatus"/></div><div class="position-card-metrics"><div><span>浮动盈亏</span><strong :class="pnlClass(p.unrealizedPnl)">{{money(p.unrealizedPnl)}}</strong></div><div><span>ROE</span><strong :class="pnlClass(p.unrealizedPnlPercent)">{{pct(p.unrealizedPnlPercent)}}</strong></div><div><span>建仓时间</span><strong>{{p.openedAt?new Date(p.openedAt).toLocaleString():'首次同步'}}</strong></div><div><span>TP 来源</span><strong>{{p.tpCoverageSource||'—'}}</strong></div></div><div class="position-card-actions"><button class="button primary full" @click="toggle(p.id)">控制台</button><button v-if="bad(p.tpStatus)" class="button secondary full" @click="s.repairTp(p.id)">补 TP</button></div></article></div>
<EmptyState v-if="!s.positions.length" title="当前无持仓"/><div v-else class="pagination-bar"><span>第 {{page}} / {{totalPages}} 页 · 共 {{s.positions.length}} 条</span><div><button class="button tiny secondary" :disabled="page<=1" @click="page--">上一页</button><button class="button tiny secondary" :disabled="page>=totalPages" @click="page++">下一页</button></div></div></Panel>
<div v-if="isSmall&&expandedId" class="mobile-console-backdrop" @click.self="expandedId=null"><div class="mobile-console-sheet"><PositionConsole :key="`mobile-${expandedId}`" :position-id="expandedId" @close="expandedId=null"/></div></div>
</div></template>

