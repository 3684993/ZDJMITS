// Offline reproduction: only this process's loopback SOCKS fixture is reachable.
import net from 'node:net';import {once} from 'node:events';
process.env.VITEST='1';
const {BinanceTransport}=await import('../../../apps/engine/dist/adapters/binance/BinanceTransport.js');
const sockets=new Set();const server=net.createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});s.resume();});
server.listen(0,'127.0.0.1');await once(server,'listening');
const t=new BinanceTransport({executionMode:'TESTNET_ENABLED',exchange:{environment:'TESTNET',testnetBaseUrl:'https://demo-fapi.binance.com',productionBaseUrl:'https://fapi.binance.com',testnetWsBaseUrl:'wss://stream.binancefuture.com/ws'},proxy:{enabled:true,url:`socks5h://127.0.0.1:${server.address().port}`}});
const start=Date.now();const cleanup=setTimeout(()=>{for(const socket of sockets)socket.destroy();},500);
try{
 let error;try{await t.json('/fapi/v2/account',{timeoutMs:100});}catch(e){error=e.message;}
 const settled=Date.now()-start;await new Promise(r=>setTimeout(r,150));
 console.log(JSON.stringify({timeoutMs:100,fixtureForcedCloseMs:500,actualSettledMs:settled,error,proxySocketsAfter150msGrace:sockets.size,budgetActive:t.requestBudgetHealth().active}));
}finally{clearTimeout(cleanup);t.dispose();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
