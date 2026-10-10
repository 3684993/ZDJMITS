import fs from 'node:fs';import WebSocket from 'ws';import {SocksProxyAgent} from 'socks-proxy-agent';
// Two bounded read-only Demo subscriptions, same existing proxy, no listenKey/credentials/REST writes.
const rows=[];
for(const [lane,stream]of [['public','btcusdt@bookTicker'],['market','btcusdt@markPrice@1s']]){
 const agent=new SocksProxyAgent('socks5h://127.0.0.1:20091',{timeout:8000});
 const row={lane,url:`wss://demo-fstream.binance.com/${lane}/ws/${stream}`,startedAt:new Date().toISOString(),opened:false,messages:0,decodedBytes:0,eventTypes:[],httpStatus:null,error:null};
 await new Promise(resolve=>{const ws=new WebSocket(row.url,{agent,handshakeTimeout:10000});let finished=false;const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);ws.terminate();agent.destroy();row.completedAt=new Date().toISOString();resolve();};const timer=setTimeout(finish,15000);ws.on('open',()=>row.opened=true);ws.on('message',raw=>{row.messages++;row.decodedBytes+=Buffer.byteLength(raw.toString());try{const type=JSON.parse(raw.toString()).e;if(type&&!row.eventTypes.includes(type))row.eventTypes.push(type);}catch{}});ws.on('unexpected-response',(_r,res)=>{row.httpStatus=res.statusCode;res.resume();finish();});ws.on('error',e=>{row.error=e.message;finish();});ws.on('close',finish);});
 rows.push(row);if(row.httpStatus===451)break;
}
fs.writeFileSync(new URL('./demo-public-probe.json',import.meta.url),JSON.stringify({observedAt:new Date().toISOString(),rows,route:'EXISTING_PROXY_20091_NO_FALLBACK',privateDemoCompatibility:'NOT_PROBED_NO_LISTEN_KEY_WRITE_AUTHORIZED',exchangeWrites:0},null,2)+'\n');console.log(JSON.stringify(rows));
