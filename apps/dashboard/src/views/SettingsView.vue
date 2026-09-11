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

const tabs = [
  ["strategy", "策略与执行"],
  ["market-quality", "交易对黑名单"],
  ["direction", "方向策略"],
  ["exchange", "交易所"],
  ["proxy", "网络代理"],
  ["ai", "AI 模型资源"],
  ["theme", "外观主题"],
] as const;
const tab = ref("strategy"),
  draft = ref<SystemSettings | null>(null),
  resources = ref<any>({ exchange: [], proxy: [], ai: [] }),
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
    ]);
    draft.value = structuredClone(settings);
    credentialStatus.value = connections.credentials;
    resources.value = {
      exchange: loaded[0].items ?? [],
      proxy: loaded[1].items ?? [],
      ai: loaded[2].items ?? [],
    };
    applyTheme();
  } catch (e) {
    error.value = String(e);
  }
}
async function save() {
  if (!draft.value) return;
  saving.value = true;
  try {
    draft.value = structuredClone(await api.saveSettings(draft.value));
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
    resources.value[kind] = [
      ...resources.value[kind].filter((x: any) => x.id !== item.id),
      await api.saveResource(kind, item),
    ];
    notice.value = "资源已保存";
  } catch (e) {
    error.value = String(e);
  }
}
async function addResource(kind: "exchange" | "proxy" | "ai") {
  const item =
    kind === "exchange"
      ? {
          id: `exchange_${Date.now()}`,
          name: "Binance USD-M",
          type: "BINANCE_USDM",
          environment: "TESTNET",
          enabled: false,
          status: "READY",
        }
      : kind === "proxy"
        ? {
            id: `proxy_${Date.now()}`,
            name: "SOCKS5H",
            type: "SOCKS5H",
            url: "socks5h://127.0.0.1:20081",
            enabled: true,
            status: "READY",
          }
        : {
            id: `ai_${Date.now()}`,
            role: "SCOUT",
            baseUrl: "http://127.0.0.1:8081/v1",
            model: "qwen3.5:9b",
            maxConcurrency: 1,
            timeout: 45000,
            healthPath: "/models",
            gpu: "未指定",
            priority: 10,
            enabled: true,
            status: "READY",
          };
  await saveResource(kind, item);
}
async function removeResource(kind: string, id: string) {
  await api.deleteResource(kind, id);
  resources.value[kind] = resources.value[kind].filter((x: any) => x.id !== id);
}
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
        <span class="eyebrow">RESOURCE MANAGER</span>
        <h2 class="page-title">系统设置</h2>
      </div>
      <button class="button primary" @click="save">
        {{ saving ? "保存中…" : "保存设置" }}
      </button>
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
        <div class="form-grid four">
          <label
            ><span>Universe Top N</span
            ><input v-model.number="draft.selection.universeTopN" type="number"
          /></label>
          <label
            ><span>交易池目标</span
            ><input v-model.number="draft.selection.poolTarget" type="number"
          /></label>
          <label><span>Entry cadence</span><select v-model="draft.ai.highFrequency.mode"><option>CONSERVATIVE</option><option>NORMAL</option><option>HIGH_FREQUENCY</option><option>CUSTOM</option></select></label>
          <label><span>Scout Prefetch</span><input v-model.number="draft.ai.highFrequency.scoutPrefetch" type="number" min="1" max="8" /></label>
          <label><span>单币 Retry / Cooldown 秒</span><input v-model.number="draft.ai.highFrequency.retryCooldownSeconds" type="number" min="5" max="300" /></label>
          <label><span>Quarantine failures / 秒</span><input v-model.number="draft.ai.highFrequency.quarantineAfterFailures" type="number" min="2" max="10" /><input v-model.number="draft.ai.highFrequency.quarantineSeconds" type="number" min="30" max="3600" /></label>
          <label
            ><span>建仓保证金 USD</span
            ><input
              v-model.number="draft.portfolio.entryMarginUsd"
              type="number"
          /></label>
          <label
            ><span>最大持仓数量</span
            ><input
              v-model.number="draft.portfolio.maxPositions"
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
            ><input
              v-model.number="draft.takeProfit.minNetProfitUsd"
              type="number"
              step="0.1"
          /></label>
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
              <option>MAKER</option>
              <option>TAKER</option>
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
              <option>AUTO</option>
              <option>USDT_ONLY</option>
              <option>USDC_ONLY</option>
            </select></label
          >
          <label
            ><span>Underlying Policy</span
            ><select
              v-model="draft.portfolioIntelligence.underlyingExposurePolicy"
            >
              <option>BLOCK_ALL</option>
              <option>BLOCK_SAME_DIRECTION</option>
              <option>ALLOW_HEDGE</option>
            </select></label
          >
          <label
            ><span>Global Direction</span
            ><select
              v-model="draft.portfolioIntelligence.globalDirectionPolicy"
            >
              <option>BOTH</option>
              <option>LONG_BIASED</option>
              <option>SHORT_BIASED</option>
              <option>LONG_ONLY</option>
              <option>SHORT_ONLY</option>
              <option>DISABLED</option>
            </select></label
          >
          <label
            ><span>Margin Mode</span
            ><select v-model="draft.portfolioIntelligence.marginMode">
              <option>AUTO</option>
              <option>ISOLATED</option>
              <option>CROSS</option>
            </select></label
          >
          <label
            ><span>Dynamic Base Margin USD</span
            ><input
              v-model.number="draft.portfolioIntelligence.baseMarginUsd"
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
              type="number"
          /></label>
          <label
            ><span>Global Max Leverage</span
            ><input
              v-model.number="draft.portfolioIntelligence.globalMaxLeverage"
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
              <option>SHADOW</option>
              <option>AUTO</option>
            </select></label
          >
          <label
            ><span>入场保护策略</span
            ><select v-model="draft.riskGovernance.protectionMode">
              <option>OFF</option>
              <option>SHADOW</option>
              <option>REQUIRED</option>
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
            >15m 决定方向；AI 不直接下单；AI_FAILED 与 REJECT
            fail-closed；无自动止损；正式链禁止 Mock fallback。{{
              RELEASE_LABEL
            }}
            AUTO_RUNNING 下资金充足即持续分析；失败与拒绝只隔离当前 Symbol。</span
          >
        </div>
      </Panel>
      <Panel v-else-if="tab === 'market-quality'" title="Market Quality Admission & 黑名单" subtitle="统一在 Candidate Ranking 与 Primary 前执行。0 表示按当前 Universe 分位数自动校准；不会影响已有 Position、TP 或 Reconciliation。">
        <div class="form-grid four">
          <label class="switch-row"><span>启用质量准入</span><input v-model="draft.selection.marketQuality.enabled" type="checkbox" /></label>
          <label><span>允许 Quality 等级</span><select v-model="draft.selection.marketQuality.allowedGrades" multiple><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
          <label class="switch-row"><span>允许 SPECULATIVE（仅 A）</span><input v-model="draft.selection.marketQuality.allowSpeculative" type="checkbox" /></label>
          <label class="switch-row"><span>允许 NEW_LISTING</span><input v-model="draft.selection.marketQuality.allowNewListings" type="checkbox" /></label>
          <label><span>最低 24h 成交额 USD（0=自动）</span><input v-model.number="draft.selection.marketQuality.minQuoteVolumeUsd24h" type="number" min="0" /></label>
          <label><span>最低 Trade Count（0=自动）</span><input v-model.number="draft.selection.marketQuality.minTradeCount24h" type="number" min="0" /></label>
          <label><span>最大 Spread bps（0=自动）</span><input v-model.number="draft.selection.marketQuality.maxSpreadBps" type="number" min="0" step="0.1" /></label>
          <label><span>最低 0.5% 单侧 Depth USD（0=自动）</span><input v-model.number="draft.selection.marketQuality.minDepthUsd" type="number" min="0" /></label>
          <label><span>最低 OI USD（0=自动）</span><input v-model.number="draft.selection.marketQuality.minOpenInterestUsd" type="number" min="0" /></label>
          <label><span>最短 Listing Age 天（0=自动）</span><input v-model.number="draft.selection.marketQuality.minListingAgeDays" type="number" min="0" /></label>
          <label><span>Liquidity Top N（0=不额外截断）</span><input v-model.number="draft.selection.marketQuality.liquidityTopN" type="number" min="0" max="300" /></label>
        </div>
        <h3 class="form-section-title">Symbol 黑名单</h3><div class="form-grid three"><label><span>Symbol</span><input v-model="blacklistSymbol" placeholder="例如 USELESSUSDT 或 币安人生/USDT" /></label><label><span>操作</span><button class="button secondary" @click="addBlacklist('symbolBlacklist',blacklistSymbol)">添加到黑名单</button></label></div>
        <div v-if="draft.selection.marketQuality.symbolBlacklist.length" class="list"><div v-for="symbol in draft.selection.marketQuality.symbolBlacklist" :key="symbol" class="list-row"><span>{{symbol}}</span><button class="button secondary" @click="removeBlacklist('symbolBlacklist',symbol)">人工移出</button></div></div><p v-else class="muted">黑名单 Symbol 不会显示于智能选币，也不能进入分析或交易。</p>
        <h3 class="form-section-title">Underlying 黑名单</h3><div class="form-grid three"><label><span>Underlying</span><input v-model="blacklistUnderlying" placeholder="例如 DOGE" /></label><label><span>操作</span><button class="button secondary" @click="addBlacklist('underlyingBlacklist',blacklistUnderlying)">添加 Underlying</button></label></div>
        <div v-if="draft.selection.marketQuality.underlyingBlacklist.length" class="list"><div v-for="symbol in draft.selection.marketQuality.underlyingBlacklist" :key="symbol" class="list-row"><span>{{symbol}}</span><button class="button secondary" @click="removeBlacklist('underlyingBlacklist',symbol)">人工移出</button></div></div><p v-else class="muted">同一 Underlying 的所有 USDT/USDC 合约都会被排除。</p>
      </Panel>
      <Panel
        v-else-if="tab === 'direction'"
        title="方向策略"
        subtitle="全局、Tier 与 Symbol Override 均会持久化；山寨 LONG 风险参数单独可见。"
      >
        <div class="form-grid two">
          <label
            ><span>全局山寨策略</span
            ><select
              v-model="draft.portfolioIntelligence.globalDirectionPreference"
            >
              <option>BALANCED</option>
              <option>INTELLIGENT_SHORT_BIAS</option>
              <option>STRICT_SHORT_BIAS</option>
              <option>SHORT_ONLY</option>
              <option>CUSTOM</option>
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
              恢复 Tier 默认
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
              <option>BALANCED</option>
              <option>INTELLIGENT_SHORT_BIAS</option>
              <option>STRICT_SHORT_BIAS</option>
              <option>SHORT_ONLY</option>
              <option>CUSTOM</option>
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
          <label><span>Symbol Override</span><input v-model="overrideSymbol" placeholder="例如 SOLUSDT" /></label>
          <label><span>方向偏好</span><select v-model="overridePreference"><option>BALANCED</option><option>INTELLIGENT_SHORT_BIAS</option><option>STRICT_SHORT_BIAS</option><option>SHORT_ONLY</option><option>CUSTOM</option></select></label>
          <label><span>写入覆盖</span><button class="button secondary" @click="saveSymbolDirectionOverride">添加 / 更新</button></label>
        </div>
        <div v-if="Object.keys(draft.portfolioIntelligence.symbolDirectionPreferences).length" class="list">
          <div v-for="(preference,symbol) in draft.portfolioIntelligence.symbolDirectionPreferences" :key="symbol" class="list-row"><span>{{ symbol }} → {{ preference }}</span><button class="button secondary" @click="removeSymbolDirectionOverride(symbol)">移除</button></div>
        </div>
        <p v-else class="muted">没有 Symbol Override；添加后优先级高于 Tier 与全局设置。</p>
      </Panel>
      <Panel v-else-if="tab === 'exchange'" title="交易所资源">
        <div class="toolbar">
          <span>没有 Adapter 的模板必须保持禁用</span
          ><button class="button primary" @click="addResource('exchange')">
            新增
          </button>
        </div>
        <div
          v-for="item in resources.exchange"
          :key="item.id"
          class="resource-row"
        >
          <div>
            <strong>{{ item.name ?? item.id }}</strong
            ><span
              >{{ item.type }} · {{ item.environment }} ·
              {{ item.enabled ? "已启用" : "已禁用" }}</span
            >
          </div>
          <div>
            <button
              class="button tiny secondary"
              @click="
                item.enabled = !item.enabled;
                saveResource('exchange', item);
              "
            >
              {{ item.enabled ? "禁用" : "启用" }}</button
            ><button
              class="button tiny secondary"
              @click="removeResource('exchange', item.id)"
            >
              删除
            </button>
          </div>
        </div>
        <div class="form-grid two">
          <label
            ><span>运行环境</span
            ><select v-model="draft.connections.exchange.environment">
              <option>TESTNET</option>
              <option>PRODUCTION</option>
            </select></label
          ><label
            ><span>执行模式</span
            ><select v-model="draft.connections.executionMode">
              <option>READ_ONLY</option>
              <option>TESTNET_ENABLED</option>
            </select></label
          ><label
            ><span>Testnet Base URL</span
            ><input
              v-model="draft.connections.exchange.testnetBaseUrl" /></label
          ><label
            ><span>凭证状态</span
            ><input
              :value="credentialStatus?.configured ? 'READY' : 'NOT_CONFIGURED'"
              disabled /></label
          ><label
            ><span>API Key</span
            ><input v-model="apiKey" type="password" /></label
          ><label
            ><span>API Secret</span><input v-model="apiSecret" type="password"
          /></label>
        </div>
        <div>
          <button class="button secondary" @click="testCredentials">
            仅验证
          </button>
          <button class="button primary" @click="saveCredentials">
            验证并保存凭证
          </button>
        </div>
      </Panel>
      <Panel v-else-if="tab === 'proxy'" title="网络代理资源"
        ><div class="toolbar">
          <span>Binance REST / WS 统一通过 SOCKS5H，失败时 fail-closed</span
          ><button class="button primary" @click="addResource('proxy')">
            新增
          </button>
        </div>
        <div
          v-for="item in resources.proxy"
          :key="item.id"
          class="resource-row"
        >
          <div>
            <strong>{{ item.name ?? item.id }}</strong
            ><span>{{ item.type }} · {{ item.url }}</span>
          </div>
          <div>
            <button
              class="button tiny secondary"
              @click="removeResource('proxy', item.id)"
            >
              删除
            </button>
          </div>
        </div>
        <div class="form-grid two">
          <label
            ><span>当前 Proxy URL</span
            ><input v-model="draft.connections.proxy.url" /></label
          ><label class="switch-row"
            ><span>强制 Binance REST 代理</span
            ><input
              v-model="draft.connections.proxy.forceBinanceRest"
              type="checkbox"
          /></label><label><span>Binance REST 路由</span><select :value="draft.connections.proxy.binanceRestRoute ?? 'CONFIGURED'" @change="draft.connections.proxy.binanceRestRoute=($event.target as HTMLSelectElement).value as 'DIRECT'|'CONFIGURED'; if(draft.connections.proxy.binanceRestRoute==='DIRECT') draft.connections.proxy.forceBinanceRest=false"><option value="CONFIGURED">使用当前代理配置</option><option value="DIRECT">直连（保留 TLS 校验）</option></select></label></div
      ></Panel>
      <Panel v-else-if="tab === 'ai'" title="AI 模型资源"
        ><div class="toolbar">
          <span
            >角色模板：SCOUT / PRIMARY_BRAIN / REVIEW_BRAIN；不假定 GPU
            数量</span
          ><button class="button primary" @click="addResource('ai')">
            新增
          </button>
        </div>
        <div v-for="item in resources.ai" :key="item.id" class="resource-row">
          <div>
            <strong>{{ item.role }} · {{ item.model }}</strong
            ><span
              >{{ item.id }} · {{ item.baseUrl }} ·
              {{ item.gpu ?? "未指定" }}</span
            >
          </div>
          <div>
            <button
              class="button tiny secondary"
              @click="
                item.enabled = !item.enabled;
                saveResource('ai', item);
              "
            >
              {{ item.enabled ? "禁用" : "启用" }}</button
            ><button
              class="button tiny secondary"
              @click="removeResource('ai', item.id)"
            >
              删除
            </button>
          </div>
        </div></Panel
      >
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
