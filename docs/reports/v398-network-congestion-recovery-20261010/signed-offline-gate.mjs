// GET-only pre-start TP evidence. Secrets and order payloads remain in memory.
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {BinanceTransport} from '../../../apps/engine/dist/adapters/binance/BinanceTransport.js';
import {WindowsCredentialManagerSecretStore} from '../../../apps/engine/dist/config/windowsCredentialManagerSecretStore.js';
import {WindowsDpapiSecretStore} from '../../../apps/engine/dist/config/windowsDpapiSecretStore.js';
const out=process.argv[process.argv.indexOf('--out')+1];if(!process.argv.includes('--out')||!out)throw Error('OUTPUT_REQUIRED');
const db=new DatabaseSync('D:/MITS/data/zdj-settings.sqlite',{readOnly:true});db.exec('PRAGMA query_only=ON');
const settingsRow=db.prepare('SELECT version,payload FROM settings WHERE id=1').get(),settings=JSON.parse(settingsRow.payload);
if(settings.connections.exchange.environment!=='TESTNET'||!settings.connections.proxy.enabled||new URL(settings.connections.proxy.url).hostname!=='127.0.0.1'||new URL(settings.connections.proxy.url).port!=='20091')throw Error('TESTNET_SAME_PROXY_REQUIRED');
async function secret(suffix){const ref=settings.connections.exchange.credentialRef,row=db.prepare('SELECT ciphertext FROM secrets WHERE ref=?').get(`TESTNET:${ref}:${suffix}`);if(!row)throw Error('SECRET_MISSING');if(row.ciphertext.startsWith('credential-manager:'))return new WindowsCredentialManagerSecretStore().get(`ZDJ-MITS/V3.1/TESTNET/${ref}:${suffix}`);if(row.ciphertext.startsWith('machine-dpapi:'))return new WindowsDpapiSecretStore('LocalMachine').unprotect(row.ciphertext.slice(14));throw Error('SECRET_BACKEND_UNSUPPORTED');}
const [key,signingSecret]=await Promise.all([secret('apiKey'),secret('apiSecret')]);
// Read only the authoritative manifest's current TP entries, without constructing SettingsStore.
const core=JSON.parse(db.prepare('SELECT payload FROM runtime_state WHERE id=1').get().payload);
const localTp=core._entityLists?.tpOrders?core._entityLists.tpOrders.ids.map(id=>{const row=db.prepare("SELECT payload FROM runtime_entities WHERE kind='tpOrders' AND entity_id=?").get(id);if(!row)throw Error('LOCAL_TP_ENTITY_MISSING');return JSON.parse(row.payload);}):(core.tpOrders??[]).map(x=>Array.isArray(x)?x[1]:x);
db.close();
const transport=new BinanceTransport(settings.connections);if(transport.restRoute().host!=='demo-fapi.binance.com')throw Error('DEMO_HOST_REQUIRED');
const evidence={observedAt:new Date().toISOString(),settingsVersion:settingsRow.version,environment:'TESTNET',host:'demo-fapi.binance.com',exchangeWrites:0,productionWrites:0,recvWindowMs:5000,requests:[],gate:'UNKNOWN'};
const save=()=>writeFileSync(out,JSON.stringify(evidence,null,2)+'\n');let offset=0;
async function get(endpoint,params={},signed=true){const startedAt=Date.now(),row={endpoint,startedAt};evidence.requests.push(row);try{const q=new URLSearchParams(params);if(signed){q.set('timestamp',String(Date.now()+offset));q.set('recvWindow','5000');q.set('signature',createHmac('sha256',signingSecret).update(q.toString()).digest('hex'));}const data=await transport.json(`${endpoint}?${q}`,{method:'GET',headers:signed?{'X-MBX-APIKEY':key}:{},timeoutMs:8000,signal:AbortSignal.timeout(12000),source:'BACKGROUND_AUDIT',purpose:'NETWORK_RECOVERY_SIGNED_GATE'});row.completedAt=Date.now();return data;}catch(error){row.completedAt=Date.now();row.httpStatus=Number(String(error.message).match(/Binance HTTP (\d+)/)?.[1])||null;row.exchangeCode=Number(String(error.message).match(/"code"\s*:\s*(-?\d+)/)?.[1])||null;row.errorType=error.name;throw error;}finally{const d=transport.requestBudgetHealth().recentDispatches.findLast(x=>x.endpoint===endpoint&&x.purpose==='NETWORK_RECOVERY_SIGNED_GATE');if(d)row.dispatch={status:d.status??null,networkTiming:d.networkTiming??null};save();}}
try{
 const clock=await get('/fapi/v1/time',{},false);offset=clock.serverTime-Date.now();
 // Sign each request immediately before its own admission. A pre-signed Promise.all
 // batch queued behind one audit lane previously expired the final account request.
 const mode=await get('/fapi/v1/positionSide/dual');
 const positions=await get('/fapi/v3/positionRisk');
 const orders=await get('/fapi/v1/openOrders');
 const algos=await get('/fapi/v1/openAlgoOrders',{algoType:'CONDITIONAL'});
 const account=await get('/fapi/v2/account');
 if(!Array.isArray(positions)||!Array.isArray(orders)||!Array.isArray(algos)||typeof mode.dualSidePosition!=='boolean')throw Error('PRIVATE_RESPONSE_SHAPE');
 const live=positions.filter(p=>Number(p.positionAmt)!==0),all=[...orders,...algos];
 evidence.positions=live.length;evidence.openOrders=orders.length;evidence.openAlgoOrders=algos.length;evidence.canTrade=account.canTrade===true;evidence.hedgeMode=mode.dualSidePosition;
 evidence.protection=live.map((p,index)=>{const matches=all.filter(o=>o.symbol===p.symbol&&String(o.positionSide??'BOTH')===String(p.positionSide??'BOTH')&&(/TAKE_PROFIT/.test(String(o.type??o.orderType??''))||(o.type==='LIMIT'&&(o.reduceOnly===true||mode.dualSidePosition))));const o=matches.length===1?matches[0]:null;
  const locals=o?localTp.filter(t=>String(t.exchangeOrderId)===String(o.orderId??o.algoId)&&String(t.clientOrderId)===String(o.clientOrderId??o.clientAlgoId)&&t.symbol===p.symbol):[];const t=locals.length===1?locals[0]:null,remaining=o?Number(o.origQty??o.quantity)-Number(o.executedQty??0):NaN;
  const checks={uniqueOrder:matches.length===1,dualId:!!t,closingSide:!!o&&o.side===(Number(p.positionAmt)>0?'SELL':'BUY'),positionSide:!!o&&String(o.positionSide??'BOTH')===String(p.positionSide??'BOTH'),reduceOnlyOrHedgeClose:!!o&&(o.reduceOnly===true||mode.dualSidePosition&&o.positionSide===p.positionSide&&o.side===(Number(p.positionAmt)>0?'SELL':'BUY')),working:!!o&&['NEW','PARTIALLY_FILLED'].includes(o.status),remainingQuantity:Number.isFinite(remaining)&&Math.abs(remaining-Math.abs(Number(p.positionAmt)))<=1e-10,localQuantity:!!t&&Number(t.quantity)===remaining,localPrice:!!t&&Number(t.price)===Number(o.price),positivePrice:!!o&&Number(o.price)>0};return{index,checks,result:Object.values(checks).every(Boolean)?'PASS':'UNKNOWN'};});
 evidence.signedFactMaxAgeMs=Date.now()-evidence.requests[1].completedAt;
 evidence.gate=evidence.canTrade&&evidence.signedFactMaxAgeMs<=30000&&evidence.protection.every(p=>p.result==='PASS')?'SIGNED_ALL_POSITION_TP_PASS':'UNKNOWN';
}catch(error){evidence.errorType=error.name;}
finally{transport.dispose();save();}
console.log(JSON.stringify({gate:evidence.gate,positions:evidence.positions??null,protected:evidence.protection?.filter(p=>p.result==='PASS').length??null,requests:evidence.requests.length,exchangeWrites:0}));
