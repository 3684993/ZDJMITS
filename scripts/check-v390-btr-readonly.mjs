import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {BinanceTransport} from '../apps/engine/dist/adapters/binance/BinanceTransport.js';
import {WindowsDpapiSecretStore} from '../apps/engine/dist/config/windowsDpapiSecretStore.js';
import {WindowsCredentialManagerSecretStore} from '../apps/engine/dist/config/windowsCredentialManagerSecretStore.js';
const db=new DatabaseSync('data/zdj-settings.sqlite',{readOnly:true});
const settings=JSON.parse(db.prepare('SELECT payload FROM settings WHERE id=1').get().payload),conn=settings.connections;
if(conn.exchange.environment!=='TESTNET')throw new Error('TESTNET_READ_ONLY_REQUIRED');
async function secret(suffix){const ref=`${conn.exchange.credentialRef}:${suffix}`,row=db.prepare('SELECT ciphertext FROM secrets WHERE ref=?').get(`TESTNET:${ref}`);if(!row)throw new Error('SECRET_UNAVAILABLE');if(row.ciphertext.startsWith('machine-dpapi:'))return new WindowsDpapiSecretStore('LocalMachine').unprotect(row.ciphertext.slice(14));if(row.ciphertext.startsWith('credential-manager:'))return new WindowsCredentialManagerSecretStore().get(`ZDJ-MITS/V3.1/TESTNET/${ref}`);throw new Error('SECRET_FORMAT_UNAVAILABLE');}
const [key,secretKey]=await Promise.all([secret('apiKey'),secret('apiSecret')]);db.close();
const transport=new BinanceTransport(conn),clock=await transport.json('/fapi/v1/time'),query=new URLSearchParams({symbol:'BTRUSDT',orderId:'299479857',timestamp:String(clock.serverTime),recvWindow:'10000'});query.set('signature',createHmac('sha256',secretKey).update(query.toString()).digest('hex'));
const order=await transport.json('/fapi/v1/order?'+query,{method:'GET',headers:{'X-MBX-APIKEY':key}});
const snapshot=await(await fetch('http://127.0.0.1:8080/api/v3/snapshot')).json();
const result={asOf:Date.now(),source:'BINANCE_TESTNET_GET_ORDER',exchangeWrites:0,order,localPosition:snapshot.positions.find(p=>p.symbol==='BTRUSDT'),fillSummary:snapshot.exchangeFillFacts,engineEntryOrder:snapshot.entryOrders.find(o=>String(o.exchangeOrderId)==='299479857')??null};
await writeFile('docs/reports/v390-btr-terminal-readonly.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({status:order.status,orderId:order.orderId,clientOrderId:order.clientOrderId,side:order.side,quantity:order.origQty,executed:order.executedQty,averagePrice:order.avgPrice,localPosition:result.localPosition?.quantity,localManaged:result.localPosition?.managementStatus,localTp:result.localPosition?.tpStatus,localEntry:!!result.engineEntryOrder,exchangeWrites:0}));
