// GET-only current TESTNET position/open-order evidence; secrets never leave a temporary Settings copy.
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]??'.'),data=path.resolve(process.argv[3]??path.join(root,'data'));
const temp=mkdtempSync(path.join(tmpdir(),'v397-position-read-'));
let store;
try{
  const source=path.join(data,'zdj-settings.sqlite');copyFileSync(source,path.join(temp,'zdj-settings.sqlite'));
  for(const suffix of ['-wal','-shm'])try{copyFileSync(source+suffix,path.join(temp,'zdj-settings.sqlite'+suffix));}catch{}
  const load=relative=>import(pathToFileURL(path.join(root,relative)).href);
  const {SettingsStore}=await load('apps/engine/dist/config/settingsStore.js');
  const {BinanceTransport}=await load('apps/engine/dist/adapters/binance/BinanceTransport.js');
  const {ExternalTradeAdapter}=await load('apps/engine/dist/adapters/exchange/ExternalTradeAdapter.js');
  store=new SettingsStore(path.join(root,'config'),temp);const settings=await store.load();
  if(settings.connections.exchange.environment!=='TESTNET')throw new Error('REFUSED_NON_TESTNET');
  const ref=settings.connections.exchange.credentialRef,apiKey=await store.getSecret(`${ref}:apiKey`),apiSecret=await store.getSecret(`${ref}:apiSecret`);
  if(!apiKey||!apiSecret)throw new Error('TESTNET_CREDENTIALS_UNAVAILABLE');
  const transport=new BinanceTransport(settings.connections);
  if(transport.restRoute().host!=='demo-fapi.binance.com')throw new Error('REFUSED_NON_TESTNET_HOST');
  const adapter=new ExternalTradeAdapter(transport,{apiKey,apiSecret},settings.connections.exchange.recvWindowMs);
  const positions=await adapter.signed('GET','/fapi/v3/positionRisk',{},'V397_POSITION_READ','PRIVATE_STATE');
  const orders=await adapter.signed('GET','/fapi/v1/openOrders',{},'V397_OPEN_ORDERS_READ','PRIVATE_STATE');
  const active=(Array.isArray(positions)?positions:[]).filter(row=>Math.abs(Number(row.positionAmt??0))>0)
    .map(row=>({symbol:row.symbol,positionSide:row.positionSide,positionAmt:row.positionAmt,entryPrice:row.entryPrice,updateTime:row.updateTime}));
  const open=(Array.isArray(orders)?orders:[]).map(row=>({symbol:row.symbol,side:row.side,positionSide:row.positionSide,
    type:row.type,reduceOnly:row.reduceOnly,closePosition:row.closePosition,status:row.status,orderId:row.orderId,clientOrderId:row.clientOrderId}));
  console.log(JSON.stringify({capturedAt:new Date().toISOString(),environment:'TESTNET',host:transport.restRoute().host,
    methods:['GET'],exchangeWrites:0,positions:active,openOrders:open},null,2));
}finally{store?.close();rmSync(temp,{recursive:true,force:true});}
