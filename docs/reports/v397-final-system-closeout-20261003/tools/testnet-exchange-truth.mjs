// Signed GETs only. The SettingsStore opens a temporary copy; the live DB is never opened writable.
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const root=path.resolve(process.argv[2]??'.');
const dataDir=path.resolve(process.argv[3]??path.join(root,'data'));
const load=relative=>import(pathToFileURL(path.join(root,relative)).href);
const {SettingsStore}=await load('apps/engine/dist/config/settingsStore.js');
const {BinanceTransport}=await load('apps/engine/dist/adapters/binance/BinanceTransport.js');
const {ExternalTradeAdapter}=await load('apps/engine/dist/adapters/exchange/ExternalTradeAdapter.js');
const temp=mkdtempSync(path.join(os.tmpdir(),'v397-testnet-truth-'));
let store;
try{
  const source=path.join(dataDir,'zdj-settings.sqlite'),copy=path.join(temp,'zdj-settings.sqlite');
  copyFileSync(source,copy);
  for(const suffix of ['-wal','-shm'])try{copyFileSync(source+suffix,copy+suffix);}catch{}
  store=new SettingsStore(path.join(root,'config'),temp);
  const settings=await store.load();
  if(settings.connections.exchange.environment!=='TESTNET')throw new Error('REFUSED_NON_TESTNET');
  const ref=settings.connections.exchange.credentialRef;
  const [apiKey,apiSecret]=await Promise.all([store.getSecret(`${ref}:apiKey`),store.getSecret(`${ref}:apiSecret`)]);
  if(!apiKey||!apiSecret)throw new Error('TESTNET_CREDENTIALS_UNAVAILABLE');
  const transport=new BinanceTransport(settings.connections);
  if(transport.restRoute().host!=='demo-fapi.binance.com')throw new Error('REFUSED_TESTNET_HOST_MISMATCH');
  const adapter=new ExternalTradeAdapter(transport,{apiKey,apiSecret},settings.connections.exchange.recvWindowMs);
  const [orders,positions]=await Promise.all([
    adapter.signed('GET','/fapi/v1/openOrders',undefined,'V397_EXCHANGE_TRUTH','PRIVATE_STATE'),
    adapter.signed('GET','/fapi/v2/positionRisk',undefined,'V397_EXCHANGE_TRUTH','PRIVATE_STATE'),
  ]);
  if(!Array.isArray(orders)||!Array.isArray(positions))throw new Error('EXCHANGE_TRUTH_SHAPE_INVALID');
  const db=new DatabaseSync(copy,{readOnly:true});
  const local={};
  for(const kind of ['entryOrders','tpOrders','manualOrders']){
    local[kind]=db.prepare('SELECT payload FROM runtime_entities WHERE kind=?').all(kind).map(row=>JSON.parse(row.payload));
  }
  db.close();
  const identities=new Map();
  for(const [kind,rows] of Object.entries(local))for(const row of rows){
    for(const id of [row.exchangeOrderId,row.clientOrderId])if(id!=null&&String(id))identities.set(`${row.symbol}:${id}`,kind);
  }
  const classified=orders.map(row=>({symbol:String(row.symbol),orderId:String(row.orderId),
    clientOrderId:String(row.clientOrderId),type:String(row.type),status:String(row.status),
    localKind:identities.get(`${row.symbol}:${row.orderId}`)??identities.get(`${row.symbol}:${row.clientOrderId}`)??'UNMATCHED'}));
  const counts=Object.fromEntries(['entryOrders','tpOrders','manualOrders','UNMATCHED'].map(kind=>[kind,classified.filter(row=>row.localKind===kind).length]));
  const nonzero=positions.filter(row=>Number(row.positionAmt)!==0).map(row=>({symbol:String(row.symbol),side:String(row.positionSide),quantity:String(row.positionAmt)}));
  console.log(JSON.stringify({capturedAt:new Date().toISOString(),environment:'TESTNET',restHost:transport.restRoute().host,
    signedGets:2,exchangeWrites:0,remoteOpenOrders:orders.length,remoteOpenOrderClass:counts,remoteNonzeroPositions:nonzero.length,
    localOrderRows:Object.fromEntries(Object.entries(local).map(([kind,rows])=>[kind,rows.length])),
    openOrders:classified,positions:nonzero},null,2));
}finally{
  store?.close();
  rmSync(temp,{recursive:true,force:true});
}
