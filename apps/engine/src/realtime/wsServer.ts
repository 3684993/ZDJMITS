import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import type { EventBus, DomainEvent } from '../events/eventBus.js';
export type DashboardDomain='SNAPSHOT'|'UNIVERSE'|'BRAIN'|'OPERATIONS';
export function invalidationDomains(type:string):DashboardDomain[]{
  if(/UNIVERSE|MARKET_|CANDIDATE|BLACKLIST|POOL/.test(type))return ['SNAPSHOT','UNIVERSE'];
  if(/AI_RUN|PRIMARY_DECISION|AI_PROTOCOL/.test(type))return ['SNAPSHOT','BRAIN'];
  if(/ORDER|ENTRY_|FILL|POSITION|TP_|ACCOUNT|RECONCIL|TRADE_RECORD/.test(type))return ['SNAPSHOT'];
  if(/RUNTIME|SETTINGS|HEALTH|VALIDATION|RESOURCE/.test(type))return ['SNAPSHOT','OPERATIONS'];
  return ['SNAPSHOT'];
}
export function attachWs(server:Server,events:EventBus){
  const wss=new WebSocketServer({server,path:'/ws'}),pending=new Set<DashboardDomain>();let version=0,timer:NodeJS.Timeout|null=null;
  const flush=()=>{timer=null;if(!pending.size)return;const msg=JSON.stringify({type:'DASHBOARD_INVALIDATION',domains:[...pending],version:++version,ts:Date.now()});pending.clear();for(const socket of wss.clients){if(socket.readyState!==WebSocket.OPEN)continue;if(socket.bufferedAmount>1_000_000){socket.close(1013,'CLIENT_TOO_SLOW_RESYNC');continue;}socket.send(msg);}};
  const send=(event:DomainEvent)=>{for(const domain of invalidationDomains(event.type))pending.add(domain);if(!timer){timer=setTimeout(flush,100);timer.unref();}};
  events.once('RUNTIME_STOPPING',()=>{events.off('event',send);if(timer)clearTimeout(timer);for(const socket of wss.clients)socket.close(1001,'ENGINE_STOPPING');wss.close();});
  events.on('event',send);wss.on('connection',socket=>socket.send(JSON.stringify({type:'DASHBOARD_RESYNC_REQUIRED',domains:['SNAPSHOT','UNIVERSE'],version,ts:Date.now()})));wss.on('close',()=>{events.off('event',send);if(timer)clearTimeout(timer);});return wss;
}
