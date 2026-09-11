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

const transport=new BinanceTransport(conn),orders=await(await fetch('http://127.0.0.1:8080/api/v3/orders')).json(),unknown=orders.takeProfit.filter(o=>o.status==='UNKNOWN'&&!o.exchangeOrderId),proofs=[];
const audit=new DatabaseSync('data/zdj-settings.sqlite',{readOnly:true});
for(const order of unknown){const clock=await transport.json('/fapi/v1/time'),q=new URLSearchParams({symbol:order.symbol,origClientOrderId:order.clientOrderId,timestamp:String(clock.serverTime),recvWindow:'10000'});q.set('signature',createHmac('sha256',secretKey).update(q.toString()).digest('hex'));let lookup;
try{lookup={order:await transport.json('/fapi/v1/order?'+q,{method:'GET',headers:{'X-MBX-APIKEY':key}})};}catch(error){const match=error.message.match(/^Binance HTTP 400: (\{.*\})$/s);let code;try{code=JSON.parse(match?.[1]??'{}').code;}catch{}lookup={notFound:code===-2013,code:code??null};}
const events=audit.prepare("SELECT id,type,ts,symbol,payload FROM runtime_events WHERE ts>=? AND ts<=? AND symbol=? AND type IN ('TP_SUBMISSION_PREPARED','TP_REPAIR_FAILED','TP_MANUAL_REVIEW_REQUIRED','TP_PROTECTED') ORDER BY ts").all(order.createdAt-5000,order.createdAt+30000,order.symbol).map(e=>({...e,payload:JSON.parse(e.payload)}));proofs.push({order,lookup,events});}
audit.close();await writeFile('docs/reports/v391-tp-legacy-proof-20260910.json',JSON.stringify({at:Date.now(),exchangeWrites:0,proofs},null,2));console.log(JSON.stringify(proofs.map(p=>({id:p.order.id,symbol:p.order.symbol,lookup:p.lookup,events:p.events.map(e=>({type:e.type,orderId:e.payload.order?.id,message:e.payload.message}))}))));
