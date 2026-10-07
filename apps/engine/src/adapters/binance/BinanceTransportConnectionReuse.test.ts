import {expect,it} from 'vitest';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {SocksProxyAgent} from 'socks-proxy-agent';
import {BinanceTransport} from './BinanceTransport.js';

// The fixture accepts only the allocated loopback target. No exchange/network egress.
async function fixture(handler:http.RequestListener=(_req,res)=>res.end('ok')){
 const target=http.createServer(handler);target.listen(0,'127.0.0.1');await once(target,'listening');
 const targetPort=(target.address() as net.AddressInfo).port,sockets=new Set<net.Socket>();let connects=0;
 const proxy=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  let data=Buffer.alloc(0),stage=0;
  const parse=(chunk:Buffer)=>{
   data=Buffer.concat([data,chunk]);
   if(stage===0){if(data.length<2||data.length<2+data[1]!)return;data=data.subarray(2+data[1]!);socket.write(Buffer.from([5,0]));stage=1;}
   if(stage===1){
    if(data.length<4)return;const type=data[3],hostLength=type===1?4:type===3?(data.length>4?1+data[4]!:0):0;
    if(!hostLength||data.length<4+hostLength+2)return;
    const host=type===1?[...data.subarray(4,8)].join('.'):data.subarray(5,4+hostLength).toString();const port=data.readUInt16BE(4+hostLength);
    if(data[0]!==5||data[1]!==1||host!=='127.0.0.1'||port!==targetPort){socket.destroy();return;}
    stage=2;connects++;socket.removeListener('data',parse);const remaining=data.subarray(6+hostLength);
    const upstream=net.connect(targetPort,'127.0.0.1');sockets.add(upstream);upstream.on('close',()=>sockets.delete(upstream));upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());
    upstream.once('connect',()=>{socket.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));if(remaining.length)upstream.write(remaining);socket.pipe(upstream);upstream.pipe(socket);});
   }
  };socket.on('data',parse);
 });proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
 return{target,url:`socks5h://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`,targetPort,connects:()=>connects,
  async close(){for(const socket of sockets)socket.destroy();target.closeAllConnections();await Promise.all([new Promise<void>(resolve=>proxy.close(()=>resolve())),new Promise<void>(resolve=>target.close(()=>resolve()))]);}};
}
const settings=(url:string)=>({executionMode:'TESTNET_ENABLED',exchange:{environment:'TESTNET',testnetBaseUrl:'https://demo-fapi.binance.com',productionBaseUrl:'https://fapi.binance.com',testnetWsBaseUrl:'wss://stream.binancefuture.com/ws',productionWsBaseUrl:'wss://fstream.binance.com/ws'},proxy:{enabled:true,url}});
async function read(port:number,agent:SocksProxyAgent){return new Promise<boolean>((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port,agent,path:'/'},res=>{res.resume();res.once('end',()=>resolve(req.reusedSocket));});req.once('error',reject);});}

it('reuses the real SOCKS tunnel for sequential reads instead of opening one tunnel per request',async()=>{
 const f=await fixture(),baseline=new SocksProxyAgent(f.url),transport=new BinanceTransport(settings(f.url) as never),agent=transport.websocketOptions().agent;
 try{
  await read(f.targetPort,baseline);await read(f.targetPort,baseline);expect(f.connects()).toBe(2);
  const before=f.connects();expect(await read(f.targetPort,agent)).toBe(false);expect(await read(f.targetPort,agent)).toBe(true);expect(await read(f.targetPort,agent)).toBe(true);expect(f.connects()-before).toBe(1);
 }finally{baseline.destroy();transport.dispose();await f.close();}
});

it('does not reuse an idle tunnel after the route changes',async()=>{
 const first=await fixture(),second=await fixture(),transport=new BinanceTransport(settings(first.url) as never),old=transport.websocketOptions().agent;
 try{
  await read(first.targetPort,old);const closed=Promise.all(Object.values(old.freeSockets).flat().map(socket=>once(socket,'close')));
  transport.reconfigure(settings(second.url) as never);await closed;
  const next=transport.websocketOptions().agent;await read(second.targetPort,next);expect(await read(second.targetPort,next)).toBe(true);
  expect(first.connects()).toBe(1);expect(second.connects()).toBe(1);expect(Object.values(old.freeSockets).flat()).toHaveLength(0);
 }finally{old.destroy();transport.dispose();await Promise.all([first.close(),second.close()]);}
});

it('lets a captured active request finish when retiring a route without keeping its idle socket',async()=>{
 let response:http.ServerResponse|undefined;
 const first=await fixture((_req,res)=>{response=res;}),second=await fixture(),transport=new BinanceTransport(settings(first.url) as never),old=transport.websocketOptions().agent;
 try{
  const arrived=once(first.target,'request'),pending=read(first.targetPort,old);await arrived;
  const closed=Promise.all(Object.values(old.sockets).flat().map(socket=>once(socket,'close')));
  transport.reconfigure(settings(second.url) as never);response!.end('ok');expect(await pending).toBe(false);await closed;
  expect(Object.values(old.freeSockets).flat()).toHaveLength(0);await read(second.targetPort,transport.websocketOptions().agent);expect(second.connects()).toBe(1);
 }finally{old.destroy();transport.dispose();await Promise.all([first.close(),second.close()]);}
});
