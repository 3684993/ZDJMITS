import type {AiResource} from '@zdj/contracts';
export type AiServiceIdentity={endpoint:string;physicalServiceId:string;modelSha256:string;templateSha256:string;contextSize:number;outputContractHash:string;generationConfigHash:string};
export type AiCapacityPolicy={borrowIdle?:boolean;identities?:readonly AiServiceIdentity[]};
export type AiCapacityLease={resourceId:string;serviceKey:string;release:()=>boolean};
export function serviceEndpoint(baseUrl:string){
 const url=new URL(baseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('AI_SERVICE_ENDPOINT_INVALID');
 const host=['localhost','127.0.0.1','[::1]'].includes(url.hostname.toLowerCase())?'loopback':url.hostname.toLowerCase();
 // /v1 and trailing slashes refer to the same physical server capacity.
 return `${url.protocol}//${host}:${url.port|| (url.protocol==='https:'?'443':'80')}`;
}
const hash=(v:string)=>/^[a-f0-9]{64}$/i.test(v);
export class AiPhysicalResourceScheduler{
 private active=new Map<string,Set<symbol>>();
 constructor(private readonly policy:AiCapacityPolicy={}){}
 private identity(resource:AiResource){const endpoint=serviceEndpoint(resource.baseUrl);const matches=this.policy.identities?.filter(i=>{try{return serviceEndpoint(i.endpoint)===endpoint;}catch{return false;}})??[];return matches.length===1?matches[0]:undefined;}
 key(resource:AiResource){return this.identity(resource)?.physicalServiceId||serviceEndpoint(resource.baseUrl);}
 activeCount(resource:AiResource){return this.active.get(this.key(resource))?.size??0;}
 available(resource:AiResource){try{return resource.enabled!==false&&resource.status!=='OFFLINE'&&this.activeCount(resource)<1;}catch{return false;}}
 tryAcquire(resource:AiResource):AiCapacityLease|null{
  if(!this.available(resource))return null;const key=this.key(resource),set=this.active.get(key)??new Set<symbol>(),token=Symbol(resource.id);set.add(token);this.active.set(key,set);
  let released=false;return{resourceId:resource.id,serviceKey:key,release:()=>{if(released)return false;released=true;const removed=set.delete(token);if(!set.size)this.active.delete(key);return removed;}};
 }
 compatible(a:AiResource,b:AiResource){try{
  if(!this.policy.borrowIdle||a.role==='SCOUT'||b.role==='SCOUT'||this.key(a)===this.key(b))return false;
  const x=this.identity(a),y=this.identity(b);if(!x||!y||!x.physicalServiceId||!y.physicalServiceId||!hash(x.modelSha256)||!hash(x.templateSha256)||!hash(x.outputContractHash)||!hash(x.generationConfigHash)||!Number.isInteger(x.contextSize)||x.contextSize<=0)return false;
  return x.modelSha256===y.modelSha256&&x.templateSha256===y.templateSha256&&x.contextSize===y.contextSize&&x.outputContractHash===y.outputContractHash&&x.generationConfigHash===y.generationConfigHash;
 }catch{return false;}}
 select(home:AiResource,others:AiResource[],borrowBlocked=false){
  if(this.available(home))return home;if(borrowBlocked)return undefined;
  return others.find(r=>this.available(r)&&this.compatible(home,r));
 }
}
