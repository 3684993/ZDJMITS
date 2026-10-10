// Read-only, bounded TESTNET pre-start protection gate. Evidence stays in the caller's private directory.
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BinanceTransport } from '../../../apps/engine/dist/adapters/binance/BinanceTransport.js';
import { WindowsCredentialManagerSecretStore } from '../../../apps/engine/dist/config/windowsCredentialManagerSecretStore.js';
import { WindowsDpapiSecretStore } from '../../../apps/engine/dist/config/windowsDpapiSecretStore.js';

const outArg = process.argv.indexOf('--out-dir');
if (outArg < 0 || !process.argv[outArg + 1]) throw new Error('PRIVATE_EVIDENCE_OUT_DIR_REQUIRED');
const out = resolve(process.argv[outArg + 1]);
mkdirSync(out, { recursive: true });
const settingsPath = process.env.ZDJ_SETTINGS_DB ?? 'D:/MITS/data/zdj-settings.sqlite';
const db = new DatabaseSync(settingsPath, { readOnly: true });
db.exec('PRAGMA query_only=ON');
const settings = JSON.parse(db.prepare('SELECT payload FROM settings WHERE id=1').get()?.payload ?? 'null');
if (!settings) throw new Error('SETTINGS_ROW_MISSING');
if (settings.connections?.exchange?.environment !== 'TESTNET' || settings.connections?.executionMode !== 'TESTNET_ENABLED') throw new Error('TESTNET_REQUIRED');
if (settings.connections?.proxy?.enabled !== true || !String(settings.connections.proxy.url ?? '').includes('127.0.0.1:20091')) throw new Error('EXPECTED_PROXY_REQUIRED');
const credentialRef = settings.connections.exchange.credentialRef;
async function readSecret(suffix) {
  const row = db.prepare('SELECT ciphertext FROM secrets WHERE ref=?').get(`TESTNET:${credentialRef}:${suffix}`);
  if (!row) throw new Error('CREDENTIAL_MISSING');
  if (row.ciphertext.startsWith('credential-manager:')) return new WindowsCredentialManagerSecretStore().get(`ZDJ-MITS/V3.1/TESTNET/${credentialRef}:${suffix}`);
  if (row.ciphertext.startsWith('machine-dpapi:')) return new WindowsDpapiSecretStore('LocalMachine').unprotect(row.ciphertext.slice(14));
  throw new Error('CREDENTIAL_BACKEND_UNSUPPORTED');
}
const [apiKey, apiSecret] = await Promise.all([readSecret('apiKey'), readSecret('apiSecret')]);
db.close();
const transport = new BinanceTransport(settings.connections);
if (transport.restRoute().host !== 'demo-fapi.binance.com') throw new Error('TESTNET_HOST_REQUIRED');
const evidence = { observedAt: new Date().toISOString(), environment: 'TESTNET', host: 'demo-fapi.binance.com', accountScopeHash: createHash('sha256').update(apiKey).digest('hex'), methods: ['GET'], exchangeWrites: 0, requests: [], gate: null };
const permissionOnly = process.argv.includes('--permission-only');
const evidenceName = permissionOnly ? 'account-permission.json' : 'testnet-start-gate.json';
const save = () => writeFileSync(`${out}/${evidenceName}`, JSON.stringify(evidence, null, 2) + '\n');
let offset = 0;
async function get(endpoint, params = {}, signed = true) {
  if (evidence.requests.length >= 6) throw new Error('REQUEST_LIMIT');
  const row = { endpoint, startedAt: new Date().toISOString() };
  evidence.requests.push(row);
  try {
    const query = new URLSearchParams(params);
    if (signed) {
      query.set('timestamp', String(Date.now() + offset)); query.set('recvWindow', '5000');
      query.set('signature', createHmac('sha256', apiSecret).update(query.toString()).digest('hex'));
    }
    const data = await transport.json(`${endpoint}?${query}`, { method: 'GET', headers: signed ? { 'X-MBX-APIKEY': apiKey } : {}, timeoutMs: 8000, signal: AbortSignal.timeout(12000), source: 'BACKGROUND_AUDIT', purpose: 'V398_TESTNET_START_GATE' });
    row.completedAt = new Date().toISOString(); row.rows = Array.isArray(data) ? data.length : null;
    return data;
  } catch (error) { row.completedAt = new Date().toISOString(); row.errorType = error.name; throw error; }
  finally {
    const dispatch = transport.requestBudgetHealth().recentDispatches.findLast(d => d.endpoint === endpoint && d.purpose === 'V398_TESTNET_START_GATE');
    if (dispatch) row.dispatch = {decision:dispatch.decision,status:dispatch.status ?? null,networkTiming:dispatch.networkTiming ?? null};
    save();
  }
}
if (permissionOnly) {
  try { const account = await get('/fapi/v2/account'); evidence.account = { canTrade: account.canTrade ?? null }; evidence.gate = evidence.account.canTrade === true ? 'SIGNED_CAN_TRADE_TRUE' : 'PERMISSION_UNVERIFIED'; }
  catch (error) { evidence.errorType = error.name; evidence.gate = 'PERMISSION_UNVERIFIED'; }
  finally { transport.dispose(); save(); }
  console.log(JSON.stringify({gate:evidence.gate,account:evidence.account,requests:evidence.requests.length,exchangeWrites:0}));
  process.exit(0);
}
try {
  const clock = await get('/fapi/v1/time', {}, false);
  if (!Number.isFinite(clock.serverTime)) throw new Error('EXCHANGE_CLOCK_UNKNOWN');
  offset = clock.serverTime - Date.now();
  const [mode, positions, orders, algoOrders, account] = await Promise.all([
    get('/fapi/v1/positionSide/dual'), get('/fapi/v3/positionRisk'), get('/fapi/v1/openOrders'), get('/fapi/v1/openAlgoOrders', { algoType: 'CONDITIONAL' }), get('/fapi/v3/account')
  ]);
  const livePositions = Array.isArray(positions) ? positions.filter(p => Number(p.positionAmt) !== 0) : null;
  const allOrders = Array.isArray(orders) && Array.isArray(algoOrders) ? [...orders, ...algoOrders] : null;
  const hasTakeProfit = order => /TAKE_PROFIT/.test(String(order.type ?? order.orderType ?? '')) || /^tp_/i.test(String(order.clientOrderId ?? order.clientAlgoId ?? '')) || (String(order.type ?? order.orderType) === 'LIMIT' && order.reduceOnly === true);
  const candidateMatches = livePositions === null || allOrders === null ? null : livePositions.filter(p => allOrders.some(o => String(o.symbol) === String(p.symbol) && String(o.positionSide ?? 'BOTH') === String(p.positionSide ?? 'BOTH') && hasTakeProfit(o))).length;
  evidence.positionMode = mode; evidence.nonzeroPositions = livePositions?.length ?? null; evidence.ordinaryOpenOrders = Array.isArray(orders) ? orders.length : null; evidence.openAlgoOrders = Array.isArray(algoOrders) ? algoOrders.length : null;
  evidence.candidateProtectionMatches = candidateMatches;
  const hashId = value => value == null ? null : createHash('sha256').update(String(value)).digest('hex');
  evidence.account = { canTrade: account.canTrade ?? null, walletFactFinite: Number.isFinite(Number(account.totalWalletBalance)), availableFactFinite: Number.isFinite(Number(account.availableBalance)), availablePositive: Number(account.availableBalance) > 0 };
  // Compare confidential quantities/prices in memory; publish checks and hashes only.
  const localResponse = await fetch('http://127.0.0.1:8080/api/v3/orders', {signal:AbortSignal.timeout(10000)});
  if (!localResponse.ok) throw new Error('LOCAL_ORDER_FACTS_UNAVAILABLE');
  const local = await localResponse.json();
  evidence.exactProtection = livePositions?.map(p => {
    const matched = allOrders?.filter(o => o.symbol === p.symbol && o.positionSide === p.positionSide && hasTakeProfit(o)) ?? [];
    const o = matched.length === 1 ? matched[0] : null;
    const localMatches = o ? local.takeProfit.filter(t => hashId(t.exchangeOrderId) === hashId(o.orderId ?? o.algoId) && hashId(t.clientOrderId) === hashId(o.clientOrderId ?? o.clientAlgoId)) : [];
    const t = localMatches.length === 1 ? localMatches[0] : null;
    const remaining = o ? Number(o.origQty ?? o.quantity) - Number(o.executedQty ?? 0) : NaN;
    const checks = {
      oneOrder: matched.length === 1,
      exactDualId: !!t,
      closingSide: !!o && o.side === (Number(p.positionAmt) > 0 ? 'SELL' : 'BUY'),
      reduceOnly: o?.reduceOnly === true,
      openStatus: ['NEW','PARTIALLY_FILLED'].includes(o?.status),
      fullRemainingQuantity: Number.isFinite(remaining) && Math.abs(remaining - Math.abs(Number(p.positionAmt))) <= 1e-10,
      localQuantity: !!t && Number(t.quantity) === remaining,
      localPrice: !!t && Number(t.price) === Number(o.price),
      positivePrice: !!o && Number.isFinite(Number(o.price)) && Number(o.price) > 0
    };
    return { symbolHash: hashId(p.symbol), positionSide: p.positionSide, orderIdHash: hashId(o?.orderId), clientOrderIdHash: hashId(o?.clientOrderId), checks, result: Object.values(checks).every(Boolean) ? 'PASS' : 'UNKNOWN' };
  }) ?? null;
  evidence.eligibilityAssessment = 'OPERATOR_ATTESTED_EXISTING_ROUTE_NOT_INDEPENDENT_OFFICIAL_CONFIRMATION';
  evidence.protectionAssessment = evidence.exactProtection?.length === livePositions?.length && evidence.exactProtection.every(p => p.result === 'PASS') ? 'SIGNED_EXACT_DUAL_ID_SIDE_QTY_PRICE_MATCH' : 'UNVERIFIED';
  evidence.gate = evidence.account.canTrade === true && evidence.protectionAssessment === 'SIGNED_EXACT_DUAL_ID_SIDE_QTY_PRICE_MATCH' ? 'TECHNICAL_ACCOUNT_TP_PASS_OPERATOR_ATTESTED' : 'TECHNICAL_UNVERIFIED';
} catch (error) { evidence.errorType = error.name; evidence.gate = 'UNKNOWN'; evidence.protectionAssessment = 'UNVERIFIED'; }
finally { transport.dispose(); save(); }
console.log(JSON.stringify({ gate: evidence.gate, protectionAssessment: evidence.protectionAssessment ?? 'UNVERIFIED', nonzeroPositions: evidence.nonzeroPositions ?? null, candidateProtectionMatches: evidence.candidateProtectionMatches ?? null, requests: evidence.requests.length, exchangeWrites: 0, evidencePath: `${out}/testnet-start-gate.json` }));
