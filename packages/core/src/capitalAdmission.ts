import { testnetFundsOnlyEntry } from './entryResourcePolicy.js';
import type { AssetRiskTier, DirectionPolicy, MarketSymbolSnapshot, PortfolioIntelligenceSettings, SystemSettings, UniverseCandidate } from '@zdj/contracts';
import { isEntryQuoteAsset, CapitalAdmissionSummarySchema, type CapitalAdmissionSummary } from '@zdj/contracts';
import { buildAllocationPlan, directionPermissions, exposure, resolveQuoteAsset, resolveUnderlying, riskTier } from './portfolio.js';

type AccountAsset={asset:string;availableBalance:number;usdValue:number|null};
type PositionFact={symbol:string;side:'LONG'|'SHORT';quantity:number;markPrice:number;leverage:number};

export type CapitalAdmissionReason='EXECUTABLE'|'POSITION_CAPACITY_FULL'|'ALLOCATION_FAILED'|'NO_USDT_MARGIN'|'NO_USDC_MARGIN'|'NO_USDC_CONTRACT'|'USDC_CONTRACT_NOT_ELIGIBLE'|'MIN_MARGIN_NOT_MET'|'EXPOSURE_BLOCKED'|'UNDERLYING_BLOCKED'|'MARKET_NOT_FRESH'|'LOCATION_BLOCKED'|'DIRECTION_BLOCKED'|'QUOTE_ASSET_NOT_ENTRY_ELIGIBLE';
export interface CapitalAdmissionDecision{symbol:string;underlying:string;quoteAsset:'USDT'|'USDC'|'BUSD'|'UNKNOWN';executable:boolean;reason:CapitalAdmissionReason;reasonText:string;plan:null|ReturnType<typeof buildAllocationPlan>;longPlan:null|ReturnType<typeof buildAllocationPlan>;shortPlan:null|ReturnType<typeof buildAllocationPlan>;minExecutableNotionalUsd:number;}

const quoteAvailable=(assets:AccountAsset[],quote:'USDT'|'USDC'|'BUSD'|'UNKNOWN')=>assets.find(asset=>asset.asset===quote)?.availableBalance??0;
const fresh=(snapshot:MarketSymbolSnapshot,now=Date.now())=>now-snapshot.quote.ts<=120_000&&now-snapshot.orderBook.ts<=120_000;
const reasonFromPlan=(admission:string,reasons:string[]):CapitalAdmissionReason=>{
  if(admission==='REJECT_MAX_POSITIONS'||reasons.includes('MAX_POSITIONS'))return'POSITION_CAPACITY_FULL';
  if(admission==='REJECT_DUPLICATE_UNDERLYING')return'UNDERLYING_BLOCKED';
  if(admission==='REJECT_EXPOSURE_LIMIT')return'EXPOSURE_BLOCKED';
  if(admission==='REJECT_LOCATION')return'LOCATION_BLOCKED';
  if(admission==='REJECT_DIRECTION_POLICY')return'DIRECTION_BLOCKED';
  if(reasons.some(reason=>reason.includes('DUPLICATE_UNDERLYING')))return'UNDERLYING_BLOCKED';
  if(reasons.some(reason=>reason.includes('EXPOSURE')))return'EXPOSURE_BLOCKED';
  return'EXPOSURE_BLOCKED';
};

export function evaluateCapitalAdmission(input:{candidates:UniverseCandidate[];snapshots:MarketSymbolSnapshot[];settings:SystemSettings;positions:PositionFact[];assets:AccountAsset[];poolSymbols?:Set<string>;now?:number}):{summary:CapitalAdmissionSummary;decisions:CapitalAdmissionDecision[]} {
  const p=input.settings.portfolioIntelligence,now=input.now??Date.now(),snapshots=input.snapshots,assets=input.assets,positions=input.positions;
  const candidates=input.candidates.filter(candidate=>candidate.eligible&&candidate.rank>0&&(!input.poolSymbols||input.poolSymbols.has(candidate.symbol)));
  const reasons:Record<string,number>={},decisions:CapitalAdmissionDecision[]=[];
  let usdtExecutableUnderlyings=0,usdcExecutableUnderlyings=0,noUsdtMargin=0,noUsdcMargin=0,noUsdcContract=0,liquidityRejected=0,exposureRejected=0,minMarginRejected=0,marketNotFresh=0,underlyingBlocked=0;
  const addReason=(reason:CapitalAdmissionReason)=>{reasons[reason]=(reasons[reason]??0)+1;};
  for(const candidate of candidates){
    const underlying=candidate.underlyingAsset??resolveUnderlying(candidate.symbol),snapshot=snapshots.find(item=>item.symbol===candidate.symbol);
    let quoteAsset=resolveQuoteAsset(snapshot?.symbol??candidate.symbol),plan:null|ReturnType<typeof buildAllocationPlan>=null,longPlan:null|ReturnType<typeof buildAllocationPlan>=null,shortPlan:null|ReturnType<typeof buildAllocationPlan>=null,reason:CapitalAdmissionReason='EXECUTABLE',reasonText='可执行',minExecutableNotionalUsd=0;
    const reject=()=>decisions.push({symbol:candidate.symbol,underlying,quoteAsset,executable:false,reason,reasonText,plan,longPlan,shortPlan,minExecutableNotionalUsd});
    if(!snapshot){reason='NO_USDC_CONTRACT';reasonText='当前 Underlying 没有可用合约';noUsdcContract++;addReason(reason);reject();continue;}
    if(!fresh(snapshot,now)){reason='MARKET_NOT_FRESH';reasonText='行情或订单簿超过可执行新鲜度窗口';marketNotFresh++;addReason(reason);reject();continue;}
    // Entry funding is the product's own permission, not Binance's: a BUSD/FDUSD-quoted contract (or an
    // unrecognised quote leg) never reserves, leases, routes or sizes, whatever the exchange reports.
    if(!isEntryQuoteAsset(quoteAsset)){reason='QUOTE_ASSET_NOT_ENTRY_ELIGIBLE';reasonText=`${quoteAsset} 不在 Entry 资金白名单（仅 USDT/USDC）内`;addReason(reason);reject();continue;}
    const available=quoteAvailable(assets,quoteAsset);
    if(quoteAsset==='USDT'&&available<=0&&quoteAvailable(assets,'USDC')>0){
      const usdcRows=snapshots.filter(item=>resolveUnderlying(item.symbol)===underlying&&resolveQuoteAsset(item.symbol)==='USDC'&&item.dataCompleteness>=.86);
      if(!usdcRows.length){reason='NO_USDC_CONTRACT';reasonText='USDT 无可用保证金，且同一 Underlying 没有合格 USDC 合约';noUsdcContract++;addReason(reason);reject();continue;}
      reason='USDC_CONTRACT_NOT_ELIGIBLE';reasonText='当前已选 USDT 合约无保证金；等待 Universe 选择合格 USDC 合约';noUsdcContract++;addReason(reason);reject();continue;
    }
    if(quoteAsset==='USDT'&&available<=0){reason='NO_USDT_MARGIN';reasonText='USDT 可用保证金为 0，等待合格 USDC 路由';noUsdtMargin++;addReason(reason);reject();continue;}
    if(quoteAsset==='USDC'&&available<=0){reason='NO_USDC_MARGIN';reasonText='USDC 可用保证金为 0';noUsdcMargin++;addReason(reason);reject();continue;}
    const tier=(candidate.riskTier as AssetRiskTier|undefined)??riskTier(snapshot,p),permissions=directionPermissions(snapshot.symbol,tier,p),make=(direction:'LONG'|'SHORT')=>(testnetFundsOnlyEntry(input.settings)||permissions.allowedDirections.includes(direction))?buildAllocationPlan({candidate:{...candidate,symbol:snapshot.symbol,underlyingAsset:underlying,quoteAsset},snapshot,direction,confidence:.65,settings:input.settings,positions,assets}):null;
    try{longPlan=make('LONG');shortPlan=make('SHORT');}catch{reason='ALLOCATION_FAILED';reasonText='AllocationPlan 无法生成';exposureRejected++;addReason(reason);reject();continue;}
    const valid=(candidatePlan:null|ReturnType<typeof buildAllocationPlan>)=>Boolean(candidatePlan&&!candidatePlan.admission.startsWith('REJECT_')&&candidatePlan.minExecutableMarginUsd<=available);
    plan=valid(longPlan)?longPlan:valid(shortPlan)?shortPlan:longPlan??shortPlan;
    minExecutableNotionalUsd=Math.max(snapshot.quote.minNotional,snapshot.quote.minQty*snapshot.quote.last);
    if(!plan){reason='DIRECTION_BLOCKED';reasonText='方向策略未允许任何方向';addReason(reason);reject();continue;}
    if(!valid(longPlan)&&!valid(shortPlan)&&Math.min(...[longPlan,shortPlan].filter(Boolean).map(x=>x!.minExecutableMarginUsd))>available){reason='MIN_MARGIN_NOT_MET';reasonText=`最低可执行保证金超过 ${quoteAsset} 可用余额`;minMarginRejected++;addReason(reason);reject();continue;}
    const quoteMargin=quoteAsset==='USDT'?exposure(positions,assets,p).usdtMarginUsd:quoteAsset==='USDC'?exposure(positions,assets,p).usdcMarginUsd:0;
    const directionPlans=[longPlan,shortPlan].filter(valid) as ReturnType<typeof buildAllocationPlan>[];
    if(!directionPlans.length){reason=reasonFromPlan(plan.admission,plan.reasons);reasonText=reason==='POSITION_CAPACITY_FULL'?`仓位容量 ${positions.length}/${input.settings.portfolio.maxPositions}`:plan.reasons.join(',');addReason(reason);reject();continue;}
    if(!testnetFundsOnlyEntry(input.settings)&&directionPlans.every(candidatePlan=>quoteMargin+candidatePlan.minExecutableMarginUsd>available*p.maxQuoteAssetMarginUsagePct)){reason='EXPOSURE_BLOCKED';reasonText=`${quoteAsset} 保证金或方向敞口没有最小可执行空间`;exposureRejected++;addReason(reason);reject();continue;}
    if(quoteAsset==='USDT')usdtExecutableUnderlyings++;if(quoteAsset==='USDC')usdcExecutableUnderlyings++;decisions.push({symbol:candidate.symbol,underlying,quoteAsset,executable:true,reason:'EXECUTABLE',reasonText:'可执行',plan,longPlan,shortPlan,minExecutableNotionalUsd});addReason('EXECUTABLE');
  }
  // A side that was never sized is a different fact from a side that was sized and then refused, and the
// downstream capacity gate cannot tell them apart from a boolean. The plan's own admission and reasons
// therefore travel with the route, so the first binding constraint is read from one source everywhere.
const sideFacts=(plan:null|ReturnType<typeof buildAllocationPlan>)=>plan?{present:true,admission:plan.admission,reasons:plan.reasons??[],minExecutableMarginUsd:plan.minExecutableMarginUsd,notionalUsd:plan.notionalUsd,marginUsd:plan.marginUsd,leverage:plan.leverage,capacityRoom:plan.capacityRoom??null}:null;
const sideOpen=(plan:null|ReturnType<typeof buildAllocationPlan>)=>Boolean(plan&&!plan.admission.startsWith('REJECT_'));
const routedCandidates=decisions.filter(item=>item.executable&&item.plan).slice(0,50).map(item=>({symbol:item.symbol,underlying:item.underlying,quoteAsset:item.quoteAsset,marginUsd:item.plan!.marginUsd,leverage:item.plan!.leverage,admission:item.plan!.admission,reason:item.reasonText,longExecutable:sideOpen(item.longPlan),shortExecutable:sideOpen(item.shortPlan),longRecommendedNotionalUsd:sideOpen(item.longPlan)?item.longPlan!.notionalUsd:null,shortRecommendedNotionalUsd:sideOpen(item.shortPlan)?item.shortPlan!.notionalUsd:null,longPlanFacts:sideFacts(item.longPlan),shortPlanFacts:sideFacts(item.shortPlan),longFeasibleNotionalUsd:null,shortFeasibleNotionalUsd:null,minExecutableNotionalUsd:item.minExecutableNotionalUsd}));
  const summary=CapitalAdmissionSummarySchema.parse({evaluatedAt:now,executableCandidateCount:decisions.filter(item=>item.executable).length,usdtAvailable:quoteAvailable(assets,'USDT'),usdcAvailable:quoteAvailable(assets,'USDC'),usdtExecutableUnderlyings,usdcExecutableUnderlyings,noUsdtMargin,noUsdcMargin,noUsdcContract,liquidityRejected,exposureRejected,minMarginRejected,marketNotFresh,underlyingBlocked,reasonCounts:reasons,routedCandidates,nextRecheckAt:null});
  return{summary,decisions};
}
