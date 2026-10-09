// Read-only, bounded TESTNET pre-start protection gate. Evidence stays in the caller's private directory.
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BinanceTransport } from '../apps/engine/dist/adapters/binance/BinanceTransport.js';
import { WindowsCredentialManagerSecretStore } from '../apps/engine/dist/config/windowsCredentialManagerSecretStore.js';
import { WindowsDpapiSecretStore } from '../apps/engine/dist/config/windowsDpapiSecretStore.js';

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
const save = () => writeFileSync(`${out}/testnet-start-gate.json`, JSON.stringify(evidence, null, 2) + '\n');
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
  finally { save(); }
}
try {
  const clock = await get('/fapi/v1/time', {}, false);
  if (!Number.isFinite(clock.serverTime)) throw new Error('EXCHANGE_CLOCK_UNKNOWN');
  offset = clock.serverTime - Date.now();
  const [mode, positions, orders, algoOrders] = await Promise.all([
    get('/fapi/v1/positionSide/dual'), get('/fapi/v3/positionRisk'), get('/fapi/v1/openOrders'), get('/fapi/v1/openAlgoOrders', { algoType: 'CONDITIONAL' })
  ]);
  const livePositions = Array.isArray(positions) ? positions.filter(p => Number(p.positionAmt) !== 0) : null;
  const allOrders = Array.isArray(orders) && Array.isArray(algoOrders) ? [...orders, ...algoOrders] : null;
  const hasTakeProfit = order => /TAKE_PROFIT/.test(String(order.type ?? order.orderType ?? '')) || /^tp_/i.test(String(order.clientOrderId ?? order.clientAlgoId ?? '')) || (String(order.type ?? order.orderType) === 'LIMIT' && order.reduceOnly === true);
  const candidateMatches = livePositions === null || allOrders === null ? null : livePositions.filter(p => allOrders.some(o => String(o.symbol) === String(p.symbol) && String(o.positionSide ?? 'BOTH') === String(p.positionSide ?? 'BOTH') && hasTakeProfit(o))).length;
  evidence.positionMode = mode; evidence.nonzeroPositions = livePositions?.length ?? null; evidence.ordinaryOpenOrders = Array.isArray(orders) ? orders.length : null; evidence.openAlgoOrders = Array.isArray(algoOrders) ? algoOrders.length : null;
  evidence.candidateProtectionMatches = candidateMatches;
  evidence.protectionAssessment = 'UNVERIFIED_CANDIDATE_ONLY';
  evidence.gate = 'UNKNOWN';
} catch (error) { evidence.errorType = error.name; evidence.gate = 'UNKNOWN'; evidence.protectionAssessment = 'UNVERIFIED'; }
finally { transport.dispose(); save(); }
console.log(JSON.stringify({ gate: evidence.gate, protectionAssessment: evidence.protectionAssessment ?? 'UNVERIFIED', nonzeroPositions: evidence.nonzeroPositions ?? null, candidateProtectionMatches: evidence.candidateProtectionMatches ?? null, requests: evidence.requests.length, exchangeWrites: 0, evidencePath: `${out}/testnet-start-gate.json` }));
