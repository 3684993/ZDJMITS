<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { brainRun, brainRuns } from "../api/client";
import { useSystemStore } from "../stores/system";
import Panel from "../components/Panel.vue";
import StatusBadge from "../components/StatusBadge.vue";
const system = useSystemStore();
const page = ref(1),
  total = ref(0),
  rows = ref<any[]>([]),
  detail = ref<any>(null),
  detailId = ref(""),
  detailError = ref(""),
  detailLoading = ref(false),
  loading = ref(false);
const symbol = ref(""),
  role = ref(""),
  status = ref(""),
  decision = ref(""),
  model = ref(""),
  from = ref(""),
  to = ref("");
let listController:AbortController|null=null,detailController:AbortController|null=null,listSequence=0,detailSequence=0,debounceTimer:number|undefined;
const drawerEl=ref<HTMLElement|null>(null);
let detailTrigger:HTMLElement|null=null;
const printable = (v: any) =>
  v == null ? "—" : typeof v === "string" ? v : JSON.stringify(v, null, 2);
// The wording comes from the Engine's own projection; the page only picks a colour for it.
const executionTone = (execution: any) =>
  ["FILLED","PARTIALLY_FILLED","SUBMITTED"].includes(execution?.executionState) ? "positive"
    : execution?.executionState === "NOT_SUBMITTED" ? "negative" : "muted";
const reasonLabel=(reason:unknown)=>{
  const code=String(reason??"");
  if(!code)return"未记录";
  if(code.includes("ECONOMIC_MIN_NET_PROFIT_UNMET"))return"预计净收益不足";
  if(code.includes("PLAN_EVIDENCE_UNRESOLVED"))return"计划证据引用无法解析";
  if(code.includes("TP_TARGET_WRONG_SIDE"))return"止盈价与允许成交价方向冲突";
  if(code.includes("QUOTE_USD_MISSING")||code.includes("QUOTE_USD_STALE"))return"USDC/USD 换算事实不可用";
  if(code.includes("AI_CANDIDATE_TARGET_RESTATEMENT_MISMATCH"))return"AI候选字段重复表述不一致";
  if(code.includes("INSUFFICIENT_AVAILABLE_MARGIN")||code.includes("RESERVED_QUOTE_MARGIN"))return"真实可用保证金不足";
  if(code.includes("EXCHANGE_")||code.includes("PRECISION")||code.includes("MINIMUM_NOTIONAL"))return"交易所价量规则不满足";
  if(code.includes("AUTHORIZATION_EXPIRED"))return"AI执行授权已过期";
  if(code.includes("MARKET_DATA")||code.includes("QUOTE_STALE"))return"行情事实不可执行";
  if(code.includes("DURABILITY")||code.includes("PERSISTENCE"))return"持久化失败";
  if(code.startsWith("PRE_AI_"))return"决策前已确认不可执行";
  return code;
};
const executionDisplay=(execution:any)=>{
  if(!execution)return"不适用";
  if(execution.executionState!=="NOT_SUBMITTED")return execution.executionLabel;
  return `未挂单：${reasonLabel(execution.blockReasons?.[0])}`;
};
const placeSummary=computed(()=>{
  const place=rows.value.filter(r=>r.role==="PRIMARY_BRAIN"&&["PLACE_LONG","PLACE_SHORT"].includes(r.decision));
  const submitted=place.filter(r=>["SUBMITTED","PARTIALLY_FILLED","FILLED"].includes(r.execution?.executionState)).length;
  const blocked=place.filter(r=>r.execution?.executionState==="NOT_SUBMITTED");
  const reasons=new Map<string,number>();
  for(const row of blocked){const label=reasonLabel(row.execution?.blockReasons?.[0]);reasons.set(label,(reasons.get(label)??0)+1);}
  return{place:place.length,submitted,blocked:blocked.length,reasons:[...reasons.entries()].sort((a,b)=>b[1]-a[1])};
});
const stamp = (value: unknown) => (typeof value === "number" && value > 0 ? new Date(value).toLocaleString() : null);
const executionChain = (e: any) => (e ? {
  brainRunId: e.brainRunId, tradePlanId: e.tradePlanId, reservationId: e.reservationId, intentId: e.intentId,
  orderId: e.orderId, clientOrderId: e.clientOrderId, exchangeOrderId: e.exchangeOrderId,
  portfolioRiskAllowed: e.portfolioRiskAllowed, submittedAt: stamp(e.submittedAt), firstFillAt: stamp(e.firstFillAt), updatedAt: stamp(e.updatedAt),
  inconsistentFacts: e.inconsistentFacts ?? [],
} : null);
const detailOpen = () => detailLoading.value || Boolean(detailError.value) || Boolean(detail.value);
/** One exit for every way the detail closes, so a response that is already in flight cannot reopen it. */
function closeDetail(){
  detailSequence++;
  detailController?.abort();
  detailController=null;
  detailLoading.value=false;
  detail.value=null;
  detailError.value="";
  detailId.value="";
  if(detailTrigger?.isConnected)detailTrigger.focus();
  detailTrigger=null;
}
function onDrawerFocusOut(event: FocusEvent){
  // Focus landing back on the drawer itself or a child is a move inside the detail, not a leave.
  const next=event.relatedTarget as Node|null;
  const container=drawerEl.value;
  if(next&&container&&!container.contains(next))closeDetail();
}
function onWindowKeydown(event: KeyboardEvent){
  if(event.key==='Escape'&&detailOpen())closeDetail();
}
const localMs = (v: string) => (v ? String(new Date(v).getTime()) : "");
async function load() {
  const sequence=++listSequence;listController?.abort();listController=new AbortController();
  loading.value = true;
  try {
    const q = new URLSearchParams({ page: String(page.value), limit: "20" });
    for (const [k, v] of Object.entries({
      symbol: symbol.value,
      role: role.value,
      status: status.value,
      decision: decision.value,
      model: model.value,
      from: localMs(from.value),
      to: localMs(to.value),
    }))
      if (v) q.set(k, v);
    const r = await brainRuns(q.toString(),listController.signal);
    if(sequence!==listSequence)return;
    rows.value = r.items;
    total.value = r.total;
  } catch(error){if((error as any)?.name!=='AbortError')throw error;
  } finally {
    if(sequence===listSequence)loading.value = false;
  }
}
async function show(id: string, event?: Event) {
  detailTrigger=(event?.currentTarget as HTMLElement|null)??(document.activeElement instanceof HTMLElement?document.activeElement:null);
  const sequence=++detailSequence;detailController?.abort();detailController=new AbortController();detailId.value=id;detailLoading.value=true;detailError.value="";
  try{const result=await brainRun(id,detailController.signal);if(sequence===detailSequence)detail.value=result;}catch(error){if((error as any)?.name!=='AbortError'&&sequence===detailSequence){detail.value=null;detailError.value=error instanceof Error?error.message:String(error);}}finally{if(sequence===detailSequence)detailLoading.value=false;}
  await nextTick();
  if(sequence===detailSequence)drawerEl.value?.focus();
}
function reset() {
  symbol.value =
    role.value =
    status.value =
    decision.value =
    model.value =
    from.value =
    to.value =
      "";
  page.value = 1;
  void load();
}
watch([symbol, role, status, decision, model, from, to], () => {
  page.value = 1;
  if(debounceTimer)clearTimeout(debounceTimer);debounceTimer=window.setTimeout(()=>void load(),300);
});
onMounted(()=>{void load();window.addEventListener('keydown',onWindowKeydown);});
onUnmounted(()=>{listController?.abort();detailController?.abort();window.removeEventListener('keydown',onWindowKeydown);if(debounceTimer)clearTimeout(debounceTimer);});
</script>
<template>
  <div class="page-stack">
    <Panel title="9B 共享事件研究" subtitle="独立于 Scout；只提取可审计事实，无下单、资金或暂停权限"><div class="facts wide"><div><dt>入口</dt><dd>{{(system.snapshot as any)?.externalResearch?.enabled?'已启用':'未启用'}}</dd></div><div><dt>队列 / 运行</dt><dd>{{(system.snapshot as any)?.externalResearch?.queued??0}} / {{(system.snapshot as any)?.externalResearch?.running??0}}</dd></div><div><dt>成功 / 失败</dt><dd>{{(system.snapshot as any)?.externalResearch?.completed??0}} / {{(system.snapshot as any)?.externalResearch?.failed??0}}</dd></div><div><dt>最近任务</dt><dd>{{(system.snapshot as any)?.externalResearch?.last?.sourceId??'—'}} · {{(system.snapshot as any)?.externalResearch?.last?.status??'—'}}</dd></div></div></Panel>
    <div class="resource-cards">
      <div
        v-for="r in system.snapshot?.aiResources ?? []"
        :key="r.id"
        class="resource-card"
      >
        <div class="resource-card-top">
          <div>
            <span class="eyebrow">{{ r.role === 'SCOUT' ? '9B RESEARCH' : r.role }}</span>
            <h3>{{ r.model }}</h3>
          </div>
          <StatusBadge :value="r.currentStatus ?? r.status" />
        </div>
        <strong
          >{{ r.currentSymbol ?? "无当前 Symbol" }} ·
          {{ r.currentRunSeconds ?? 0 }}s</strong
        ><span class="muted" v-if="r.role === 'SCOUT'"
          >职责状态：{{ r.idleReason ?? r.currentStatus ?? "—" }} · 运行 {{ r.totalRuns ?? 0 }} 次</span
        ><span class="muted" v-else
          >方向倾向：{{ r.lastDirection ?? "—" }} · 交易动作：{{ r.lastDecision === 'NO_DIRECTION_EDGE' ? '不交易' : (r.lastDecision ?? "—") }}</span>
        <div class="permission-note">
          下一步：{{ r.nextStep ?? r.idleReason ?? "等待调度" }} · 队列
          {{ r.queueDepth ?? 0 }}
        </div>
      </div>
    </div>
    <Panel
      title="AI Run 完整审计"
      subtitle="Input → Raw Output → Normalized Decision → Error；拒绝与失败永不自动转 PLACE"
      ><div class="facts wide" v-if="placeSummary.place">
        <div><dt>本页 Primary PLACE</dt><dd>{{placeSummary.place}}</dd></div>
        <div><dt>已进入订单链</dt><dd>{{placeSummary.submitted}}</dd></div>
        <div><dt>未挂单</dt><dd>{{placeSummary.blocked}}</dd></div>
        <div><dt>不挂单主因</dt><dd>{{placeSummary.reasons.map(([reason,count])=>`${reason} ${count}`).join(" · ")||"—"}}</dd></div>
      </div><div class="toolbar">
        <input v-model="symbol" class="input" placeholder="Symbol" /><select
          v-model="role"
          class="select"
        >
          <option value="">全部角色</option>
          <option>SCOUT</option>
          <option>PRIMARY_BRAIN</option>
          <option>REVIEW_BRAIN</option></select
        ><select v-model="status" class="select">
          <option value="">全部状态</option>
          <option>COMPLETED</option>
          <option>FAILED</option>
          <option>RUNNING</option></select
        ><select v-model="decision" class="select">
          <option value="">全部决策</option>
          <option>PLACE_LONG</option>
          <option>PLACE_SHORT</option>
          <option>REJECT_CANDIDATE</option></select
        ><input v-model="model" class="input" placeholder="Model" /><input
          v-model="from"
          type="datetime-local"
          class="input"
        /><input v-model="to" type="datetime-local" class="input" /><button
          class="button secondary"
          @click="reset"
        >
          重置
        </button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>Symbol</th>
            <th>Role / Model</th>
            <th>Status</th>
            <th>方向倾向</th>
            <th>交易动作</th>
            <th>执行结果</th>
            <th>Total</th>
            <th>Tokens</th>
            <th>审计</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.id"
            class="clickable"
            @click="show(r.id,$event)"
          >
            <td>{{ new Date(r.startedAt).toLocaleString() }}</td>
            <td>{{ r.symbol }}</td>
            <td>{{ r.role }} · {{ r.model }}</td>
            <td><StatusBadge :value="r.status" /></td>
            <td v-if="r.role === 'SCOUT'" colspan="3">该次 9B Run：{{ r.status }}（不代表在线职责已启用）</td>
            <template v-else><td><StatusBadge :value="r.direction ?? '—'" /></td>
            <td>{{ r.decision === 'NO_DIRECTION_EDGE' ? '不交易' : (r.decision ?? "—") }}</td>
            <td :class="executionTone(r.execution)">{{ executionDisplay(r.execution) }}</td></template>
            <td>{{ r.timing?.totalMs ?? r.latencyMs ?? "—" }}ms</td>
            <td>{{ r.inputTokens ?? "—" }} / {{ r.outputTokens ?? "—" }}</td>
            <td><button class="button secondary" @click.stop="show(r.id)">查看决策/未执行原因</button></td>
          </tr>
        </tbody>
      </table>
      <div class="toolbar">
        <span>{{ loading ? "加载中…" : `第 ${page} 页 · ${total} 条` }}</span
        ><button
          class="button secondary"
          :disabled="page <= 1"
          @click="
            page--;
            load();
          "
        >
          上一页</button
        ><button
          class="button secondary"
          :disabled="page * 20 >= total"
          @click="
            page++;
            load();
          "
        >
          下一页
        </button>
      </div></Panel
    ><div
      v-if="detailLoading || detailError || detail"
      ref="drawerEl"
      class="audit-drawer"
      tabindex="-1"
      role="dialog"
      aria-label="AI Run 完整审计详情"
      @focusout="onDrawerFocusOut"
      ><div
        class="audit-drawer-head"
        style="position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding-bottom:12px;background:rgba(8,12,18,.98)"
      >
        <div>
          <strong>{{ detail ? `Run Detail · ${detail.run.id}` : "Run Detail" }}</strong>
          <p class="muted">
            {{
              detail
                ? `${detail.run.symbol} · ${detail.run.role} · ${detail.run.model}`
                : "读取归档事实"
            }}
          </p>
        </div>
        <button class="button secondary" @click="closeDetail">关闭</button>
      </div>
      <Panel
      title="审计内容"
      subtitle="Input → Raw Output → Normalized Decision → Error；拒绝与失败永不自动转 PLACE"
      ><div class="facts wide">
        <div v-if="detailLoading">加载中…</div><div v-else-if="detailError"><strong>{{detailError}}</strong><button class="button secondary" @click="show(detailId)">重试</button></div>
        <template v-else>
        <div>
          <dt>{{ detail.run.role === 'SCOUT' ? '9B Run 状态' : '方向倾向 / 交易动作' }}</dt>
          <dd>
            <template v-if="detail.run.role === 'SCOUT'">{{ detail.summary?.status }}（仅表示该次 Run，不代表研究入口已启用）</template>
            <template v-else>方向倾向：{{ detail.summary?.direction ?? "—" }} / 交易动作：{{ detail.summary?.decision === 'NO_DIRECTION_EDGE' ? '不交易' : (detail.summary?.decision ?? "—") }}</template>
          </dd>
        </div>
        <div>
          <dt>Status / Error</dt>
          <dd>
            {{ detail.summary?.status }} / {{ detail.summary?.error ?? "—" }}
          </dd>
        </div>
        <div>
          <dt>Timing</dt>
          <dd>{{ printable(detail.run.timing) }}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>
            {{ detail.run.inputTokens ?? "—" }} /
            {{ detail.run.outputTokens ?? "—" }}
          </dd>
        </div>
        <div><dt>最终阶段 / 未执行原因</dt><dd>{{detail.summary?.finalStage??'—'}} / {{detail.summary?.reason??'—'}}</dd></div>
        <div><dt>Actual / Limit</dt><dd>{{printable({actual:detail.summary?.actual,limit:detail.summary?.limit})}}</dd></div>
        <div><dt>交易所订单事实</dt><dd>{{printable(detail.orderFact)}}</dd></div>
        <div><dt>执行结果 / 不执行主因</dt><dd>{{ detail.execution ? `${executionDisplay(detail.execution)}${detail.execution.blockStage ? ` · 原始审计：${detail.execution.blockStage} · ${(detail.execution.blockReasons ?? []).join(' | ')}` : ''}` : '不适用（该 Run 不负责建仓）' }}</dd></div>
        <div><dt>执行链 ID 与时间</dt><dd>{{printable(executionChain(detail.execution))}}</dd></div>
        </template>
      </div>
      <template v-if="detail">
      <h3>Run → Intent → Order → Fill 时间线</h3><pre class="mono">{{printable(detail.timeline)}}</pre>
      <h3>历史 Compact Facts <span v-if="detail.archivedFactsStatus==='UNAVAILABLE'">（归档缺失）</span></h3><pre class="mono">{{printable(detail.historicalCompactFacts)}}</pre>
      <h3>Evidence / EIP</h3>
      <pre class="mono">{{ printable(detail.eip) }}</pre>
      <h3>Scout Input / Raw / Normalized</h3>
      <pre class="mono">{{
        printable({
          input: detail.scoutInput,
          raw: detail.scoutRawOutput,
          normalized: detail.scoutNormalizedOutput,
        })
      }}</pre>
      <h3>Primary Input</h3>
      <pre class="mono">{{ printable(detail.primaryInput) }}</pre>
      <h3>Raw Model Output</h3>
      <pre class="mono">{{ printable(detail.rawModelOutput) }}</pre>
      <h3>Normalized Decision</h3>
      <pre class="mono">{{ printable(detail.normalizedDecision) }}</pre>
      <h3>Protocol Normalization</h3>
      <pre class="mono">{{ printable(detail.run.protocolNormalization) }}</pre>
      <h3>Temporal Decision Memory</h3>
      <pre class="mono">{{ printable(detail.temporalMemory) }}</pre>
      <h3>Error / Raw Audit</h3>
      <pre class="mono">{{ printable(detail.rawAudit) }}</pre>
      </template><button class="button secondary" @click="closeDetail">关闭</button>
    </Panel></div>
  </div>
</template>
<style scoped>
.audit-drawer{position:fixed;inset:0 0 0 min(24vw,320px);z-index:40;overflow:auto;padding:20px;background:rgba(8,12,18,.98);box-shadow:-12px 0 36px rgba(0,0,0,.45)}
.audit-drawer:focus{outline:none}
.audit-drawer-head strong{font-size:13px}
.audit-drawer-head p{margin:4px 0 0}
@media(max-width:760px){.audit-drawer{inset:0;padding:12px}}
</style>
