<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSystemStore } from "../stores/system";
import { api } from "../api/client";
import Panel from "./Panel.vue";
import StatusBadge from "./StatusBadge.vue";
import { money, pct } from "../format";
import { cycleMoments, holdingDuration, positionCycleKey } from "../utils/holdingDuration";
import { createUiRequestId } from "../requestId";
import { useNow } from "../utils/useNow";
const props = defineProps<{ positionId: string }>(),
  emit = defineEmits<{ close: [] }>(),
  s = useSystemStore();
const detail = ref<any>(null),
  preview = ref<any>(null),
  action = ref<string | null>(null),
  quantity = ref(""),
  price = ref(""),
  reason = ref(""),
  busy = ref(false),
  feedback = ref("");
// The console ages against a ticking clock and states which moment the age came from, so an operator
// never reads a first-observed position as a cycle whose first fill is proven.
const now = useNow(30_000);
const holding = () => holdingDuration(detail.value?.position, now.value);
const moments = () => cycleMoments(detail.value?.position);
const environment = computed(() => s.settings?.connections?.exchange?.environment ?? null);
const accountSource = computed(() => s.snapshot?.account?.source ?? null);
const cycleKey = () => positionCycleKey(detail.value?.position, environment.value, accountSource.value);
const requestKeys = new Map<string,string>();
async function load() {
  try {
    detail.value = await api.position(props.positionId);
  } catch (e) {
    feedback.value = String(e);
  }
}
async function begin(next: string) {
  if(busy.value)return;
  requestKeys.clear();
  action.value = next;
  feedback.value = "";
  try {
    preview.value = await api.manualPreview(props.positionId);
    const p = preview.value;
    if (next === "REDUCE") {
      quantity.value = String(p.reduce.defaultQty);
      price.value = String(p.reduce.defaultPrice);
    } else if (next === "EMERGENCY_CLOSE") {
      quantity.value = String(p.emergency.defaultQty);
      price.value = String(p.emergency.defaultPrice);
    } else if (next === "ADD") {
      quantity.value = String(p.add.defaultQty);
      price.value = String(p.add.defaultPrice);
    } else if (next === "PLACE_LIMIT") {
      quantity.value = String(p.limit.defaultQty);
      price.value = String(p.limit.defaultPrice);
    } else price.value = String(detail.value?.tp?.price ?? "");
  } catch (e) {
    feedback.value = String(e);
  }
}
async function submit() {
  if (!action.value || busy.value) return;
  if (
    action.value === "EMERGENCY_CLOSE" &&
    !window.confirm(
      "确认紧急平仓？服务端会再次读取真实持仓和最新 Bid/Ask，并只提交 reduce-only LIMIT；无论预计盈亏都尊重人工退出，不会提交 Market。",
    )
  )
    return;
  busy.value = true;
  try {
    const requestSignature=JSON.stringify([props.positionId,action.value,quantity.value,price.value]);
    if (!requestKeys.has(requestSignature)) {
      requestKeys.set(requestSignature, `ui_${createUiRequestId()}`);
    }
    const payload: any = {
      action: action.value,
      confirm: action.value === "EMERGENCY_CLOSE",
      reason: reason.value,
      idempotencyKey: requestKeys.get(requestSignature),
    };
    if (action.value !== "EMERGENCY_CLOSE") {
      payload.quantity = quantity.value ? Number(quantity.value) : undefined;
      payload.price = price.value ? Number(price.value) : undefined;
    }
    const result = await api.manualPosition(props.positionId, payload);
    feedback.value = result.reason==="EXIT_QUEUED_BEHIND_ACTIVE_TASK"?"平仓目标已排队：先确认活动订单撤销，再按真实剩余量继续":result.goalSatisfied?"已核实：持仓已平，无需重复下单":`已提交：${result.order?.exchangeOrderId ?? result.intent?.id ?? "已记录"} · 状态 ${result.order?.status ?? result.intent?.status ?? "UNKNOWN"}；成交/全平以交易所对账为准`;
    await load();
    s.refresh();
  } catch (e) {
    feedback.value = String(e);
  } finally {
    busy.value = false;
  }
}
async function cancel(kind: "limits" | "conditionals") {
  if (
    !window.confirm(
      kind === "limits"
        ? "确认取消当前 Symbol 普通 LIMIT？"
        : "确认取消当前 Symbol 条件委托并与 TP Guardian 对账？",
    )
  )
    return;
  busy.value = true;
  try {
    const result =
      kind === "limits"
        ? await api.cancelLimits(props.positionId)
        : await api.cancelConditionals(props.positionId);
    feedback.value = `完成：${JSON.stringify(result)}`;
    await load();
  } catch (e) {
    feedback.value = String(e);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div v-if="detail" class="position-console-inline">
    <Panel
      :title="`持仓控制台 · ${detail.position.symbol}`"
      :subtitle="`${detail.position.side} · 浮动盈亏 ${money(detail.position.unrealizedPnl)} · ROE ${pct(detail.position.unrealizedPnlPercent)}`"
      ><template #actions
        ><button class="button tiny secondary" @click="emit('close')">
          关闭
        </button></template
      >
      <div class="facts wide console-facts">
        <div>
          <dt>当前数量</dt>
          <dd>{{ detail.position.quantity }}</dd>
        </div>
        <div>
          <dt>Entry / Mark</dt>
          <dd>
            {{ detail.position.entryPrice }} / {{ detail.position.markPrice }}
          </dd>
        </div>
        <div data-holding-duration-block>
          <dt>持仓时间</dt>
          <dd>
            <strong data-holding-duration="">{{ holding().text }}</strong>
            <small data-holding-provenance="">{{ holding().detail }}</small>
          </dd>
        </div>
        <div data-position-cycle-key>
          <dt>物理周期标识</dt>
          <dd class="mono">{{ cycleKey() }}</dd>
        </div>
        <div>
          <dt>TP</dt>
          <dd>
            <StatusBadge :value="detail.position.tpStatus" />
            {{ detail.tp?.quantity ?? "—" }} @ {{ detail.tp?.price ?? "—" }}
          </dd>
        </div>
      </div>
      <div v-if="detail.position.economicMandate" class="facts wide console-facts" data-entry-economic-mandate>
        <div><dt>Entry 最低初始保证金</dt><dd>{{ detail.position.economicMandate.sizing.minimumInitialMarginQuote }} {{ detail.position.economicMandate.quoteAsset }}</dd></div>
        <div><dt>Entry 实际保证金 / notional</dt><dd>{{ detail.position.economicMandate.sizing.selectedInitialMarginQuote }} / {{ detail.position.economicMandate.sizing.selectedNotionalQuote }} {{ detail.position.economicMandate.quoteAsset }}</dd></div>
        <div><dt>数量 / 杠杆 / 目标期限</dt><dd>{{ detail.position.economicMandate.sizing.quantity }} / {{ detail.position.economicMandate.sizing.leverage }}x / {{ detail.position.economicMandate.economics.targetHorizonMinutes }}m</dd></div>
        <div><dt>1h 可达 / FX / Funding</dt><dd>{{ detail.position.economicMandate.economics.oneHourReachabilityStatus }} / {{ detail.position.economicMandate.economics.fxStatus }} / {{ detail.position.economicMandate.economics.fundingStatus }}</dd></div>
        <div><dt>方向事实 1D / 4H / 15m</dt><dd>{{ detail.position.economicMandate.directionFacts.map(fact => fact.timeframe + ':' + fact.direction + '/' + fact.status).join(' · ') }}</dd></div>
      </div>
      <div v-if="detail.position.tpEconomics" class="policy-callout" data-tp-economics>
        <strong>TP 经济性 · {{ detail.position.tpEconomics.status }}</strong>
        <span>保护状态与经济结果分开读取。目标净收益 {{ money(detail.position.tpEconomics.expectedNetProfit) }}，最低要求 {{ money(detail.position.tpEconomics.requiredNetProfit) }}。</span>
      </div>
      <div class="cycle-moments" data-cycle-moments>
        <small v-for="m in moments()" :key="m.key" data-cycle-moment>{{ m.text }}</small>
      </div>
      <div class="management-card">
        <strong>人工交易控制台 · HUMAN ONLY · TESTNET</strong
        ><span
          >默认值来自服务端
          ManualActionPreview；确认提交前重新读取真实持仓、Bid/Ask
          与交易精度。</span
        >
        <div class="action-grid">
          <button class="button secondary" @click="begin('REDUCE')">减仓</button
          ><button class="button secondary" @click="begin('ADD')">
            同向补仓</button
          ><button class="button secondary" @click="begin('PLACE_LIMIT')">
            限价挂单</button
          ><button class="button secondary" @click="begin('REPLACE_TP')">
            替换 TP</button
          ><button class="button secondary" @click="begin('REBUILD_TP')">
            重建 TP</button
          ><button
            class="button secondary"
            :disabled="busy"
            @click="cancel('limits')"
          >
            取消普限</button
          ><button
            class="button secondary"
            :disabled="busy"
            @click="cancel('conditionals')"
          >
            取消委订</button
          ><button
            class="button danger-button"
            @click="begin('EMERGENCY_CLOSE')"
          >
            紧急平仓
          </button>
        </div>
        <div v-if="preview && action" class="preview-strip">
          服务端预览：{{ action }} · qty={{
            action === "REDUCE"
              ? preview.reduce.defaultQty
              : action === "EMERGENCY_CLOSE"
                ? preview.emergency.defaultQty
                : action === "ADD"
                  ? preview.add.defaultQty
                  : (preview.limit?.defaultQty ?? "—")
          }}
          · price={{
            action === "REDUCE"
              ? preview.reduce.defaultPrice
              : action === "EMERGENCY_CLOSE"
                ? preview.emergency.defaultPrice
                : action === "ADD"
                  ? preview.add.defaultPrice
                  : (preview.limit?.defaultPrice ?? price)
          }}
        </div>
        <div v-if="action" class="manual-form">
          <strong>{{
            action === "EMERGENCY_CLOSE"
              ? "紧急平仓 · Counterparty LIMIT reduce-only"
              : action
          }}</strong
          ><template v-if="action === 'EMERGENCY_CLOSE'"
            ><div>
              数量：{{
                preview?.emergency?.positionQty ?? "—"
              }}（交易所真实持仓）
            </div>
            <div>
              价格：{{ preview?.emergency?.limitPrice ?? "—" }}（最新
              {{ preview?.emergency?.side === "BUY" ? "bestAsk" : "bestBid" }}）
            </div></template
          ><template v-else
            ><label
              >数量<input
                v-model="quantity"
                type="number"
                min="0"
                step="any" /></label
            ><label
              >价格<input
                v-model="price"
                type="number"
                min="0"
                step="any" /></label></template
          ><label>备注<input v-model="reason" maxlength="240" /></label
          ><small
            >紧急平仓始终尊重人工确认；预计损益仅供参考，不构成阻断。仅提交
            reduce-only Counterparty LIMIT，不会自动创建 Market。</small
          ><button class="button primary full" :disabled="busy" @click="submit">
            {{ busy ? "提交中…" : "确认提交" }}
          </button>
        </div>
        <div v-if="feedback" class="feedback">{{ feedback }}</div>
      </div>
      <div class="console-tabs">
        <button class="active">Facts / Audit</button>
      </div>
      <pre class="mono json-view">{{
        JSON.stringify(
          {
            tradeRecord: detail.tradeRecord,
            manualIntents: detail.manualIntents,
            audit: detail.audit,
          },
          null,
          2,
        )
      }}</pre>
    </Panel>
  </div>
  <div v-else class="console-loading">正在加载 {{ positionId }} 控制台…</div>
</template>
