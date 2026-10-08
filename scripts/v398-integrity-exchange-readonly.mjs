// Audit only: direct read-only SQLite credentials; no SettingsStore, backup, lifecycle or exchange writes.
import {DatabaseSync} from 'node:sqlite';
import {createHmac,createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {BinanceTransport} from 'file:///D:/MITS-worktrees/v398-entry-quality-20261008/apps/engine/dist/adapters/binance/BinanceTransport.js';
import {WindowsCredentialManagerSecretStore} from 'file:///D:/MITS-worktrees/v398-entry-quality-20261008/apps/engine/dist/config/windowsCredentialManagerSecretStore.js';
import {WindowsDpapiSecretStore} from 'file:///D:/MITS-worktrees/v398-entry-quality-20261008/apps/engine/dist/config/windowsDpapiSecretStore.js';
const out='docs/reports/v398-trade-record-integrity-20261009/evidence';mkdirSync(out,{recursive:true});
const db=new DatabaseSync('D:/MITS/data/zdj-settings.sqlite',{readOnly:true});db.exec('PRAGMA query_only=ON');
const settings=JSON.parse(db.prepare('SELECT payload FROM settings WHERE id=1').get().payload);
if(settings.connections.exchange.environment!=='TESTNET'||settings.connections.executionMode!=='TESTNET_ENABLED')throw Error('TESTNET_REQUIRED');
const ref=settings.connections.exchange.credentialRef;
async function secret(suffix){const row=db.prepare('SELECT ciphertext FROM secrets WHERE ref=?').get(`TESTNET:${ref}:${suffix}`);if(!row)throw Error('CREDENTIAL_MISSING');if(row.ciphertext.startsWith('credential-manager:'))return new WindowsCredentialManagerSecretStore().get(`ZDJ-MITS/V3.1/TESTNET/${ref}:${suffix}`);if(row.ciphertext.startsWith('machine-dpapi:'))return new WindowsDpapiSecretStore('LocalMachine').unprotect(row.ciphertext.slice(14));throw Error('CREDENTIAL_BACKEND_UNSUPPORTED');}
const apiKey=await secret('apiKey'),apiSecret=await secret('apiSecret');db.close();
const transport=new BinanceTransport(settings.connections);if(transport.restRoute().host!=='demo-fapi.binance.com')throw Error('TESTNET_HOST_REQUIRED');
const result={observedAt:new Date().toISOString(),environment:'TESTNET',host:'demo-fapi.binance.com',accountScopeHash:createHash('sha256').update(apiKey).digest('hex'),methods:['GET'],taskExchangeWrites:0,taskLiveDatabaseWrites:0,requestLimit:28,requests:[],windows:[]};
const save=()=>writeFileSync(`${out}/exchange-current-history.json`,JSON.stringify(result,null,2)+'\n');
const start=Date.now();let offset=0;
async function get(endpoint,params={},signed=true){if(result.requests.length>=result.requestLimit)throw Error('REQUEST_BOUND');const request={endpoint,params,startedAt:Date.now()};result.requests.push(request);try{let query=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]));if(signed){query.set('timestamp',String(Date.now()+offset));query.set('recvWindow','5000');query.set('signature',createHmac('sha256',apiSecret).update(query.toString()).digest('hex'));}const value=await transport.json(`${endpoint}?${query}`,{method:'GET',headers:signed?{'X-MBX-APIKEY':apiKey}:{},timeoutMs:8000,signal:AbortSignal.timeout(12000),source:'BACKGROUND_AUDIT',purpose:'V398_INTEGRITY_READ_ONLY'});request.completedAt=Date.now();request.rows=Array.isArray(value)?value.length:null;return value;}catch(e){request.errorType=e.name;request.completedAt=Date.now();return{status:'UNKNOWN',errorType:e.name};}finally{save();}}
try{
 const clock=await get('/fapi/v1/time',{},false);if(!Number.isFinite(clock.serverTime))throw Error('CLOCK_UNAVAILABLE');offset=clock.serverTime-Date.now();
 result.positionMode=await get('/fapi/v1/positionSide/dual');result.positions=await get('/fapi/v3/positionRisk');result.openOrders=await get('/fapi/v1/openOrders');save();
 const until=Date.now()+offset;
 for(const [symbol,origin] of [['AVAXUSDT',Date.UTC(2026,8,19,16,0)],['ETHUSDT',Date.UTC(2026,9,4,16,0)],['UNIUSDC',until-6*86400000]]){
  for(let from=origin;from<until;from+=6*86400000){if(Date.now()-start>240000)throw Error('WALL_CLOCK_BOUND');const to=Math.min(until,from+6*86400000-1);const row={symbol,from,to,limit:1000};row.fills=await get('/fapi/v1/userTrades',{symbol,startTime:from,endTime:to,limit:1000});row.orders=await get('/fapi/v1/allOrders',{symbol,startTime:from,endTime:to,limit:1000});row.coverage=Array.isArray(row.fills)&&row.fills.length<1000&&Array.isArray(row.orders)&&row.orders.length<1000?'BOUNDED_NON_SATURATED_NOT_RETENTION_PROOF':'UNKNOWN';result.windows.push(row);save();}
 }
}catch(e){result.errorType=e.name;result.status='PARTIAL';}finally{transport.dispose();save();console.log(JSON.stringify({requests:result.requests.length,windows:result.windows.length,positionMode:result.positionMode,positions:Array.isArray(result.positions)?result.positions.filter(p=>Number(p.positionAmt)!==0).length:'UNKNOWN',writes:0}));}
