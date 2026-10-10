// Bounded two-symbol public market smoke; no Engine, private WS or exchange writes.
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
import {BinanceTransport} from '../../../apps/engine/dist/adapters/binance/BinanceTransport.js';
import {BinanceMarketStream} from '../../../apps/engine/dist/adapters/market/BinanceMarketStream.js';
const db=new DatabaseSync('D:/MITS/data/zdj-settings.sqlite',{readOnly:true});db.exec('PRAGMA query_only=ON');const settings=JSON.parse(db.prepare('SELECT payload FROM settings WHERE id=1').get().payload);db.close();
if(settings.connections.exchange.environment!=='TESTNET'||!settings.connections.proxy.enabled||new URL(settings.connections.proxy.url).hostname!=='127.0.0.1'||new URL(settings.connections.proxy.url).port!=='20091')throw Error('SAME_TESTNET_PROXY_REQUIRED');
const transport=new BinanceTransport(settings.connections),stream=new BinanceMarketStream(transport,async()=>{throw Error('SMOKE_REST_BACKFILL_DISABLED');});
const startedAt=Date.now();stream.start(['BTCUSDT','ETHUSDT']);await new Promise(resolve=>setTimeout(resolve,20000));const metrics=stream.metrics();stream.stop();transport.dispose();
const out=process.argv[process.argv.indexOf('--out')+1];if(!process.argv.includes('--out')||!out)throw Error('OUTPUT_REQUIRED');
const evidence={startedAt,completedAt:Date.now(),route:{publicUrl:transport.effectiveWsUrl('PUBLIC'),marketUrl:transport.effectiveWsUrl('MARKET'),throughSameProxy:true},exchangeWrites:0,metrics};writeFileSync(out,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({lanes:metrics.lanes,freshness:metrics.quoteFactFreshness.staleByField,bytes:metrics.streamTraffic}));
