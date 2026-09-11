import {createHash,createHmac} from 'node:crypto';

type Transport={effectiveBaseUrl():string;json<T>(path:string,init?:{method?:string;headers?:Record<string,string>}):Promise<T>};
type ProductionCredentials={environment:'PRODUCTION';credentialRef:string;apiKey:string;apiSecret:string};
const allowedSigned=new Set(['/fapi/v3/account','/fapi/v3/positionRisk','/fapi/v1/openOrders','/fapi/v1/openAlgoOrders','/fapi/v1/positionSide/dual','/fapi/v1/multiAssetsMargin','/fapi/v1/leverageBracket','/fapi/v1/commissionRate']);

/** Standalone inspector: no order adapter, write method, runtime mutation, or Testnet credential fallback. */
export class ProductionReadOnlyPreflight {
  constructor(private transport:Transport,private credentials:ProductionCredentials){}
  async inspect(candidateSymbols:string[]=[]){
    const origin=new URL(this.transport.effectiveBaseUrl());
    if(origin.origin!=='https://fapi.binance.com'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new Error('PRODUCTION_READ_ONLY_ORIGIN_INVALID');
    if(this.credentials.environment!=='PRODUCTION'||!this.credentials.credentialRef||!this.credentials.apiKey||!this.credentials.apiSecret)throw new Error('SEPARATE_PRODUCTION_CREDENTIALS_REQUIRED');
    const observedAt=Date.now(),timeSamples=[] as number[];
    for(let i=0;i<3;i++){const before=Date.now(),{serverTime}=await this.transport.json<{serverTime:number}>('/fapi/v1/time',{method:'GET'}),after=Date.now();if(!Number.isFinite(serverTime))throw new Error('PRODUCTION_SERVER_TIME_UNVERIFIED');timeSamples.push(serverTime-(before+after)/2);}
    const clockOffsetMs=timeSamples.sort((a,b)=>a-b)[1]!,serverTime=Date.now()+clockOffsetMs;
    const get=async(path:string,params:Record<string,string>={})=>{if(!allowedSigned.has(path))throw new Error(`PRODUCTION_READ_ONLY_PATH_BLOCKED:${path}`);const q=new URLSearchParams({...params,timestamp:String(Math.round(serverTime)),recvWindow:'5000'});q.set('signature',createHmac('sha256',this.credentials.apiSecret).update(q.toString()).digest('hex'));return this.transport.json<any>(`${path}?${q}`,{method:'GET',headers:{'X-MBX-APIKEY':this.credentials.apiKey}});};
    const symbols=[...new Set(candidateSymbols.map(x=>String(x).trim().toUpperCase()).filter(Boolean))].slice(0,3);
    const [exchangeInfo,account,positions,orders,algoOrders,mode,multiAssets,brackets,...commissions]=await Promise.all([
      this.transport.json<any>('/fapi/v1/exchangeInfo',{method:'GET'}),get('/fapi/v3/account'),get('/fapi/v3/positionRisk'),get('/fapi/v1/openOrders'),get('/fapi/v1/openAlgoOrders'),get('/fapi/v1/positionSide/dual'),get('/fapi/v1/multiAssetsMargin'),get('/fapi/v1/leverageBracket'),...symbols.map(symbol=>get('/fapi/v1/commissionRate',{symbol}))
    ]);
    if(!Number.isFinite(Number(account.availableBalance))||!Number.isFinite(Number(account.totalWalletBalance))||!Array.isArray(positions)||!Array.isArray(orders)||!Array.isArray(algoOrders)||!Array.isArray(brackets)||typeof mode.dualSidePosition!=='boolean'||typeof multiAssets.multiAssetsMargin!=='boolean')throw new Error('PRODUCTION_ACCOUNT_FACTS_INVALID');
    const contracts=new Map((exchangeInfo.symbols??[]).map((row:any)=>[String(row.symbol),row])),candidateFacts=symbols.map((symbol,index)=>{const row:any=contracts.get(symbol),filters=Object.fromEntries((row?.filters??[]).map((filter:any)=>[String(filter.filterType),filter]));return{symbol,status:row?.status??null,contractType:row?.contractType??null,tickSize:Number(filters.PRICE_FILTER?.tickSize)||null,stepSize:Number(filters.LOT_SIZE?.stepSize)||null,minQty:Number(filters.LOT_SIZE?.minQty)||null,minNotional:Number(filters.MIN_NOTIONAL?.notional)||null,commission:commissions[index]??null};});
    const accountFingerprint=createHash('sha256').update(JSON.stringify({credentialRef:this.credentials.credentialRef,assets:(account.assets??[]).map((x:any)=>x.asset).sort(),positionMode:mode.dualSidePosition,multiAssets:multiAssets.multiAssetsMargin})).digest('hex');
    return{environment:'PRODUCTION',mode:'READ_ONLY',observedAt,credentialRef:this.credentials.credentialRef,accountFingerprint,clock:{offsetMedianMs:clockOffsetMs,samplesMs:timeSamples},availableBalance:Number(account.availableBalance),walletBalance:Number(account.totalWalletBalance),positionMode:mode.dualSidePosition?'HEDGE':'ONE_WAY',multiAssetsMargin:multiAssets.multiAssetsMargin,positionCount:positions.filter((p:any)=>Number(p.positionAmt)!==0).length,openOrderCount:orders.length,openAlgoOrderCount:algoOrders.length,leverageBracketSymbols:brackets.length,candidates:candidateFacts,exchangeWrites:0,allowedMethods:['GET'],liveApproval:'PENDING_LIMITS_EXIT_PLAN_AND_EXPLICIT_ORDER_AUTHORIZATION'};
  }
}
