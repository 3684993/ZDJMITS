import type { Position, Side, SystemSettings } from '@zdj/contracts';
import type { PendingEntryRiskExposure } from './entryRiskOccupancy.js';

// OTHER describes missing classification, not a shared correlation factor.
export function riskUnderlying(symbol:string){return symbol.toUpperCase().replace(/(USDT|USDC|BUSD|FDUSD)$/,'').replace(/^1000(?=[A-Z])/,'');}
export function clusterFor(symbol:string){
  const asset=riskUnderlying(symbol);
  const groups:Record<string,string[]>={BTC:['BTC'],ETH_L1:['ETH'],MEME:['DOGE','SHIB','PEPE','BONK','BOME','FLOKI','MEME'],AI:['FET','RNDR','RENDER','TAO','WLD','AI'],DEFI:['UNI','AAVE','MKR','CRV','LDO'],EXCHANGE:['BNB','OKB','LEO','KCS']};
  return Object.keys(groups).find(key=>groups[key].includes(asset))??'OTHER';
}
export function riskClusterKey(symbol:string){const cluster=clusterFor(symbol);return cluster==='OTHER'?`OTHER:${riskUnderlying(symbol)}`:cluster;}
export type HeadroomInput={settings:SystemSettings;equity:number;positions:Pick<Position,'symbol'|'side'|'quantity'|'markPrice'>[];pendingRiskExposures?:PendingEntryRiskExposure[];symbol:string;side:Side;plannedNotional:number;expectedAdverseMovePct:number;dailyDrawdownPct:number;quoteNotionalCapacity?:number;minimumNotional?:number};

/** Pure capacity calculation shared by routing, pre-Primary JIT and final risk validation. */
export function computeExecutableRiskHeadroom(input:HeadroomInput){
  const g=input.settings.riskGovernance,equity=input.equity,cluster=clusterFor(input.symbol),clusterKey=riskClusterKey(input.symbol),pending=input.pendingRiskExposures??[];
  const exposures=[
    ...input.positions.map(p=>({id:`position:${p.symbol}:${p.side}`,symbol:p.symbol,side:p.side as Side|'BOTH',notionalUsd:Math.abs(p.quantity*p.markPrice),source:'POSITION'})),
    ...pending.map(p=>({id:p.id,symbol:p.symbol,side:p.side,notionalUsd:Math.abs(p.notionalUsd),source:p.source})),
  ];
  const sum=(predicate:(p:typeof exposures[number])=>boolean)=>exposures.filter(predicate).reduce((n,p)=>n+p.notionalUsd,0);
  const gross=sum(()=>true),long=sum(p=>p.side==='LONG'||p.side==='BOTH'),short=sum(p=>p.side==='SHORT'||p.side==='BOTH'),clusterNow=sum(p=>riskClusterKey(p.symbol)===clusterKey),clusterDirectionNow=sum(p=>riskClusterKey(p.symbol)===clusterKey&&(p.side===input.side||p.side==='BOTH'));
  const move=Math.max(.0001,input.expectedAdverseMovePct),perTradeRiskUsd=equity*g.perTradeRiskPctEquity;
  const limits={gross:equity*g.maxGrossExposurePct,direction:equity*g.maxDirectionExposurePct,cluster:equity*g.maxClusterExposurePct,clusterDirection:equity*g.maxClusterDirectionExposurePct};
  const remaining={gross:Math.max(0,limits.gross-gross),direction:Math.max(0,limits.direction-(input.side==='LONG'?long:short)),cluster:Math.max(0,limits.cluster-clusterNow),clusterDirection:Math.max(0,limits.clusterDirection-clusterDirectionNow),riskSizing:perTradeRiskUsd/move,quote:input.quoteNotionalCapacity??Number.MAX_VALUE};
  const minimum=Math.max(1,input.minimumNotional??1),blockers:string[]=[];
  const checks:[keyof typeof remaining,string][]=[['gross','REJECT_GROSS_EXPOSURE'],['direction','REJECT_DIRECTION_EXPOSURE'],['cluster','REJECT_CORRELATED_CLUSTER'],['clusterDirection','REJECT_CLUSTER_DIRECTION_EXPOSURE'],['riskSizing','REJECT_RISK_PER_TRADE'],['quote','INSUFFICIENT_AVAILABLE_MARGIN']];
  const valid=equity>0&&Number.isFinite(equity)&&Number.isFinite(input.plannedNotional)&&input.plannedNotional>=0&&Number.isFinite(move)&&Number.isFinite(input.dailyDrawdownPct)&&Object.values(limits).every(Number.isFinite)&&Object.values(remaining).every(v=>Number.isFinite(v)&&v>=0)&&exposures.every(p=>Number.isFinite(p.notionalUsd)&&p.notionalUsd>=0&&Boolean(p.symbol));
  if(!valid)blockers.push('RISK_FACTS_INVALID');
  if(input.dailyDrawdownPct>g.maxDailyDrawdownPct)blockers.push('REJECT_DAILY_DRAWDOWN');
  for(const [key,reason] of checks)if(remaining[key]+1e-8<minimum)blockers.push(reason);
  const finalNotional=valid?Math.max(0,Math.min(input.plannedNotional,...Object.values(remaining))):0;
  if(finalNotional+1e-8<minimum&&!blockers.length)blockers.push('BELOW_MINIMUM_NOTIONAL');
  const factVersion=JSON.stringify({equity,side:input.side,symbol:input.symbol,exposures:exposures.map(p=>[p.id,p.symbol,p.side,Number(p.notionalUsd.toFixed(8))]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),limits,dailyDrawdownPct:input.dailyDrawdownPct,expectedAdverseMovePct:move});
  return {factVersion,equity,cluster,clusterKey,gross,long,short,clusterNow,clusterDirectionNow,pendingRiskNotional:pending.reduce((n,p)=>n+Math.max(0,p.notionalUsd),0),limits,remaining,perTradeRiskUsd,expectedAdverseMovePct:move,plannedNotional:input.plannedNotional,finalNotional:blockers.length?0:finalNotional,minimumNotional:minimum,executable:!blockers.length,reason:blockers[0]??'PASS',blockers};
}
