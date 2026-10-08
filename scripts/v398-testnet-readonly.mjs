// Signed GET and public GET only. Official SQLite backup observes WAL; Settings operates on disposable copy.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SettingsStore} from '../apps/engine/dist/config/settingsStore.js';
import {BinanceTransport} from '../apps/engine/dist/adapters/binance/BinanceTransport.js';
import {ExternalTradeAdapter} from '../apps/engine/dist/adapters/exchange/ExternalTradeAdapter.js';
const out='docs/reports/v398-entry-sizing-quality-review/evidence-20261008';
const snapshotArgument=process.argv.find(a=>a.startsWith('--snapshot='))?.slice('--snapshot='.length);
if(snapshotArgument&&!/^[a-z0-9-]+\.json$/.test(snapshotArgument))throw new Error('INVALID_SNAPSHOT_FILENAME');
const snapshotName=snapshotArgument??(process.argv.includes('--history')?'testnet-history-account-readback.json':'testnet-signed-readback.json');
const temp=mkdtempSync(path.join(tmpdir(),'v398-private-read-'));
let db,store;
const capturedAt=new Date().toISOString();
try {
 db=new DatabaseSync('D:/MITS/data/zdj-settings.sqlite',{readOnly:true});
 db.exec('PRAGMA query_only=ON');await backup(db,path.join(temp,'zdj-settings.sqlite'));db.close();db=undefined;
 store=new SettingsStore(path.resolve('config'),temp);const settings=await store.load();
 if(settings.connections.exchange.environment!=='TESTNET'||settings.connections.executionMode!=='TESTNET_ENABLED')throw new Error('REFUSED_NON_TESTNET');
 const transport=new BinanceTransport(settings.connections);
 if(transport.restRoute().host!=='demo-fapi.binance.com')throw new Error('REFUSED_NON_TESTNET_HOST');
 const ref=settings.connections.exchange.credentialRef;
 const apiKey=await store.getSecret(`${ref}:apiKey`),apiSecret=await store.getSecret(`${ref}:apiSecret`);
 if(!apiKey||!apiSecret)throw new Error('TESTNET_CREDENTIALS_UNAVAILABLE');
 const adapter=new ExternalTradeAdapter(transport,{apiKey,apiSecret},settings.connections.exchange.recvWindowMs);
 const result={capturedAt,environment:'TESTNET',host:'demo-fapi.binance.com',methods:['GET'],taskExchangeWrites:0};
 const specs=[['account','/fapi/v2/account'],['positions','/fapi/v3/positionRisk'],['openOrders','/fapi/v1/openOrders']];
 for(const [key,url] of specs){try{const value=await adapter.signed('GET',url,{},'V398_READ_ONLY','PRIVATE_STATE');
  if(key==='account')result[key]={assets:value.assets,positions:value.positions,totalInitialMargin:value.totalInitialMargin,totalMaintMargin:value.totalMaintMargin,availableBalance:value.availableBalance,updateTime:value.updateTime};
  else result[key]=Array.isArray(value)?value.filter(row=>key==='openOrders'||Math.abs(Number(row.positionAmt))>0).map(row=>Object.fromEntries(Object.entries(row).filter(([name])=>!['accountId','accountAlias'].includes(name)))):value;
 }catch(error){result[key]={status:'UNAVAILABLE',errorType:error?.name??'ERROR'};}}
 writeFileSync(`${out}/${snapshotName}`,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({capturedAt,environment:result.environment,positions:Array.isArray(result.positions)?result.positions.length:result.positions.status,openOrders:Array.isArray(result.openOrders)?result.openOrders.length:result.openOrders.status,taskExchangeWrites:0}));
 if(process.argv.includes('--history')){
  const until=Date.now();const windows=[];
  for(const [symbol,origin] of [['ETHUSDT',1791183300000],['AVAXUSDT',1789834200000]]){
   for(let start=origin;start<until;start+=6*86400000){
    const end=Math.min(until,start+6*86400000-1);const item={symbol,start,end,limit:1000,observedAt:Date.now(),methods:['GET']};
    for(const [kind,endpoint] of [['fills','userTrades'],['orders','allOrders']])try{
      const rows=await adapter.signed('GET',`/fapi/v1/${endpoint}`,{symbol,startTime:start,endTime:end,limit:1000},'V398_BOUNDED_HISTORY','BACKGROUND_AUDIT');
      item[kind]=rows;item[`${kind}Coverage`]=Array.isArray(rows)&&rows.length<1000?'BOUNDED_WINDOW_NOT_SATURATED':'UNKNOWN_BOUND_REACHED';
    }catch(error){item[kind]={status:'UNAVAILABLE',errorType:error?.name??'ERROR'};}
    windows.push(item);writeFileSync(`${out}/eth-avax-bounded-history.json`,JSON.stringify({capturedAt,until,windows,taskExchangeWrites:0},null,2)+'\n');
   }
  }
  console.log(JSON.stringify({historyWindows:windows.length,boundedReadRequests:windows.length*2}));
 }
 if(process.argv.includes('--bars')){
  const coverage=[];
  const clock=await transport.json('/fapi/v1/time',{source:'BACKGROUND_AUDIT',purpose:'V398_CLOCK',timeoutMs:8000});
  writeFileSync(`${out}/exchange-clock.json`,JSON.stringify({observedAt:Date.now(),...clock},null,2)+'\n');
  const symbols=[...new Set([...(Array.isArray(result.positions)?result.positions.map(r=>r.symbol):[]),'ETHUSDT','AVAXUSDT'])];
  for(const symbol of symbols)for(const [interval,limit] of [['1w',60],['1d',200],['4h',500],['1h',500],['15m',500]]){
   try{const rows=await transport.json(`/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}&endTime=${clock.serverTime}`,{source:'BACKGROUND_AUDIT',purpose:'V398_CLOSED_BARS',timeoutMs:8000});
    const closed=rows.filter(row=>Number(row[6])<clock.serverTime);
    writeFileSync(`${out}/bars-${symbol}-${interval}.json`,JSON.stringify({symbol,interval,observedAt:Date.now(),serverTime:clock.serverTime,rows:closed},null,2)+'\n');
    coverage.push({symbol,interval,requested:limit,closed:closed.length,firstOpenTime:closed[0]?.[0]??null,lastCloseTime:closed.at(-1)?.[6]??null,status:closed.length>=limit-1?'BOUNDED_READY':'SHORT_WINDOW'});
   }catch(error){coverage.push({symbol,interval,status:'UNAVAILABLE',errorType:error?.name??'ERROR'});}
   writeFileSync(`${out}/market-bars-coverage.json`,JSON.stringify(coverage,null,2)+'\n');
  }
  console.log(JSON.stringify({barRequests:coverage.length,unavailable:coverage.filter(r=>r.status==='UNAVAILABLE').length}));
 }
}catch(error){writeFileSync(`${out}/${snapshotName}`,JSON.stringify({capturedAt,status:'UNAVAILABLE',errorType:error?.name??'ERROR',taskExchangeWrites:0},null,2)+'\n');console.log('TESTNET_READ_UNAVAILABLE');}
finally{db?.close();store?.close();rmSync(temp,{recursive:true,force:true});}
