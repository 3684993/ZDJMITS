// GET-only TESTNET readback. Secrets are loaded from a temporary Settings copy and never printed.
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]??'.'),data=path.resolve(process.argv[3]??path.join(root,'data'));
const temp=mkdtempSync(path.join(tmpdir(),'v397-filters-'));
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
  const info=await transport.json('/fapi/v1/exchangeInfo',{method:'GET',source:'RATE_LIMIT_CONTROL',purpose:'V397_FILTER_READ'});
  const symbol=String(process.argv[4]??'BTCUSDT').toUpperCase(),row=info.symbols.find(item=>item.symbol===symbol);
  if(!row)throw new Error('SYMBOL_NOT_IN_TESTNET_EXCHANGE_INFO');
  const brackets=await adapter.signed('GET','/fapi/v1/leverageBracket',{symbol},'V397_LEVERAGE_READ','PRIVATE_STATE');
  const bracket=Array.isArray(brackets)?brackets[0]:brackets;
  console.log(JSON.stringify({capturedAt:new Date().toISOString(),environment:'TESTNET',host:transport.restRoute().host,
    symbol,status:row.status,contractType:row.contractType,pricePrecision:row.pricePrecision,quantityPrecision:row.quantityPrecision,
    filters:row.filters.filter(item=>['PRICE_FILTER','LOT_SIZE','MARKET_LOT_SIZE','MIN_NOTIONAL','NOTIONAL','PERCENT_PRICE'].includes(item.filterType)),
    leverageBrackets:(bracket?.brackets??[]).map(item=>({bracket:item.bracket,initialLeverage:item.initialLeverage,notionalFloor:item.notionalFloor,notionalCap:item.notionalCap})),
    methods:['GET'],exchangeWrites:0},null,2));
}finally{store?.close();rmSync(temp,{recursive:true,force:true});}
