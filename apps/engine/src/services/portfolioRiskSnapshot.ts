/**
 * S05-A: one deterministic, fail-closed portfolio risk snapshot.
 *
 * This module is deliberately offline and side-effect free. It does not read RuntimeState,
 * Settings, an exchange, or a database. Callers must provide versioned facts. HUMAN_MANAGED
 * and HANDOFF_PENDING positions remain full risk; UNKNOWN facts remain occupied risk; a
 * CLOSED label never erases a non-zero verified quantity.
 */
export type PortfolioOwnerState='AI_ACTIVE'|'HANDOFF_PENDING'|'HUMAN_MANAGED'|'CLOSED';
export type PortfolioFactStatus='VERIFIED'|'UNKNOWN'|'CONFLICT';
export type PortfolioRiskSide='LONG'|'SHORT'|'BOTH';

export interface PortfolioAssetFact{
  asset:string;
  equityUsd:number|null;
  availableMarginUsd:number|null;
  factStatus:PortfolioFactStatus;
}

export interface PortfolioCashFlowFact{
  id:string;
  amountUsd:number;
  factStatus:PortfolioFactStatus;
}

export interface PortfolioPositionFact{
  scope:string;
  cycleId:string;
  symbol:string;
  side:'LONG'|'SHORT';
  quantity:number;
  markPrice:number;
  leverage:number;
  quoteAsset:string;
  marginAsset:string;
  ownerState:PortfolioOwnerState;
  factStatus:PortfolioFactStatus;
  maintenanceMarginUsd?:number|null;
  liquidationBufferPct?:number|null;
  handoffAt?:number|null;
  acknowledgedAt?:number|null;
}

export interface PortfolioPendingRiskFact{
  id:string;
  /** Same reservation/order lineage must share one dedupeKey. */
  dedupeKey:string;
  symbol:string;
  side:PortfolioRiskSide;
  notionalUsd:number;
  marginUsd:number;
  quoteAsset:string;
  source:'RESERVATION'|'ORDER'|'UNKNOWN';
  factStatus:PortfolioFactStatus;
}

export interface PortfolioRiskExposure{
  id:string;
  kind:'POSITION'|'PENDING';
  symbol:string;
  underlying:string;
  side:PortfolioRiskSide;
  notionalUsd:number;
  marginUsd:number;
  quoteAsset:string;
  marginAsset:string;
  ownerState:PortfolioOwnerState|null;
  factStatus:PortfolioFactStatus;
  maintenanceMarginUsd:number|null;
  liquidationBufferPct:number|null;
  handoffAt:number|null;
  acknowledgedAt:number|null;
}

export interface PortfolioRiskSnapshot{
  version:'V3.9.6_PORTFOLIO_RISK_SNAPSHOT';
  riskGeneration:number;
  createdAt:number;
  snapshotHash:string;
  complete:boolean;
  blockers:string[];
  equityUsd:number;
  netExternalFlowUsd:number;
  flowAdjustedEquityUsd:number;
  peakEquityUsd:number;
  drawdownPct:number;
  grossNotionalUsd:number;
  longNotionalUsd:number;
  shortNotionalUsd:number;
  capitalAtRiskUsd:number;
  pendingNotionalUsd:number;
  assets:Array<{asset:string;equityUsd:number;availableMarginUsd:number}>;
  exposures:PortfolioRiskExposure[];
  underlying:Array<{underlying:string;grossNotionalUsd:number;longNotionalUsd:number;shortNotionalUsd:number}>;
  quoteAssets:Array<{asset:string;grossNotionalUsd:number;marginUsedUsd:number;availableMarginUsd:number|null}>;
}

const QUOTES=['USDT','USDC','BUSD','FDUSD'] as const;
const STATUS_RANK:Record<PortfolioFactStatus,number>={VERIFIED:0,UNKNOWN:1,CONFLICT:2};
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
const nonNegative=(value:unknown)=>finite(value)&&Number(value)>=0;
const positive=(value:unknown)=>finite(value)&&Number(value)>0;
const norm=(value:string)=>String(value??'').trim().toUpperCase();

export function canonicalRiskUnderlying(symbol:string){
  let value=norm(symbol);
  for(const quote of QUOTES)if(value.endsWith(quote)&&value.length>quote.length){value=value.slice(0,-quote.length);break;}
  return value.replace(/^1000(?=[A-Z])/,'');
}

function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  if(typeof value==='number')return Number.isFinite(value)?Number(value.toFixed(12)):String(value);
  return value;
}

export function stableRiskHash(value:unknown){
  const text=JSON.stringify(canonical(value));
  let hash=0x811c9dc5>>>0;
  for(let index=0;index<text.length;index++)hash=Math.imul(hash^text.charCodeAt(index),16777619)>>>0;
  return `v396r${hash.toString(16).padStart(8,'0')}`;
}

function worstStatus(rows:Array<{factStatus:PortfolioFactStatus}>):PortfolioFactStatus{
  return rows.reduce<PortfolioFactStatus>((worst,row)=>STATUS_RANK[row.factStatus]>STATUS_RANK[worst]?row.factStatus:worst,'VERIFIED');
}

function materiallyDifferent(a:PortfolioPositionFact,b:PortfolioPositionFact){
  return norm(a.symbol)!==norm(b.symbol)||a.side!==b.side||a.ownerState!==b.ownerState||a.quantity!==b.quantity||a.markPrice!==b.markPrice||a.leverage!==b.leverage||norm(a.quoteAsset)!==norm(b.quoteAsset)||norm(a.marginAsset)!==norm(b.marginAsset);
}

export function buildPortfolioRiskSnapshot(input:{
  riskGeneration:number;
  now:number;
  peakEquityUsd:number;
  assets:PortfolioAssetFact[];
  cashFlows:PortfolioCashFlowFact[];
  positions:PortfolioPositionFact[];
  pending:PortfolioPendingRiskFact[];
}):PortfolioRiskSnapshot{
  const blockers=new Set<string>();
  if(!Number.isSafeInteger(input.riskGeneration)||input.riskGeneration<=0)blockers.add('RISK_GENERATION_INVALID');
  if(!finite(input.now)||input.now<0)blockers.add('SNAPSHOT_TIME_INVALID');
  if(!positive(input.peakEquityUsd))blockers.add('PEAK_EQUITY_INVALID');

  const assetMap=new Map<string,{asset:string;equityUsd:number;availableMarginUsd:number}>();
  for(const row of input.assets){
    const asset=norm(row.asset);
    if(!asset||row.factStatus!=='VERIFIED'||!nonNegative(row.equityUsd)||!nonNegative(row.availableMarginUsd)){
      blockers.add(`ACCOUNT_ASSET_UNVERIFIED:${asset||'UNKNOWN'}`);
      continue;
    }
    if(assetMap.has(asset))blockers.add(`ACCOUNT_ASSET_DUPLICATE:${asset}`);
    assetMap.set(asset,{asset,equityUsd:Number(row.equityUsd),availableMarginUsd:Number(row.availableMarginUsd)});
  }
  const assets=[...assetMap.values()].sort((a,b)=>a.asset.localeCompare(b.asset));
  const equityUsd=assets.reduce((sum,row)=>sum+row.equityUsd,0);
  if(!(equityUsd>0))blockers.add('ACCOUNT_EQUITY_UNPROVEN');

  let netExternalFlowUsd=0;
  const flowIds=new Set<string>();
  for(const flow of input.cashFlows){
    const id=String(flow.id??'').trim();
    if(!id||flowIds.has(id)){blockers.add(`CASH_FLOW_ID_INVALID:${id||'EMPTY'}`);continue;}
    flowIds.add(id);
    if(flow.factStatus!=='VERIFIED'||!finite(flow.amountUsd)){blockers.add(`CASH_FLOW_UNVERIFIED:${id}`);continue;}
    netExternalFlowUsd+=flow.amountUsd;
  }
  const flowAdjustedEquityUsd=equityUsd-netExternalFlowUsd;
  const drawdownPct=positive(input.peakEquityUsd)?Math.max(0,(input.peakEquityUsd-flowAdjustedEquityUsd)/input.peakEquityUsd):1;

  const exposures:PortfolioRiskExposure[]=[];
  const groupedPositions=new Map<string,PortfolioPositionFact[]>();
  for(const row of input.positions){
    const scope=String(row.scope??'').trim(),cycleId=String(row.cycleId??'').trim();
    if(!scope||!cycleId){blockers.add('POSITION_IDENTITY_MISSING');continue;}
    const key=`${scope}|${cycleId}`;
    const group=groupedPositions.get(key)??[];group.push(row);groupedPositions.set(key,group);
  }
  for(const [key,rows] of groupedPositions){
    const sample=rows[0];
    let status=worstStatus(rows);
    if(rows.slice(1).some(row=>materiallyDifferent(sample,row))){status='CONFLICT';blockers.add(`POSITION_FACT_CONFLICT:${key}`);}
    const invalid=rows.some(row=>!norm(row.symbol)||!['LONG','SHORT'].includes(row.side)||!nonNegative(row.quantity)||!positive(row.markPrice)||!positive(row.leverage)||!norm(row.quoteAsset)||!norm(row.marginAsset));
    if(invalid){status='CONFLICT';blockers.add(`POSITION_FACT_INVALID:${key}`);}
    if(status!=='VERIFIED')blockers.add(`POSITION_FACT_UNVERIFIED:${key}`);
    const notionalUsd=Math.max(0,...rows.map(row=>nonNegative(row.quantity)&&positive(row.markPrice)?Math.abs(row.quantity*row.markPrice):0));
    const leverage=Math.min(...rows.map(row=>positive(row.leverage)?row.leverage:Number.POSITIVE_INFINITY));
    const marginUsd=Number.isFinite(leverage)&&leverage>0?notionalUsd/leverage:notionalUsd;
    const maintenanceRows=rows.map(row=>row.maintenanceMarginUsd).filter(nonNegative) as number[];
    const liquidationRows=rows.map(row=>row.liquidationBufferPct).filter(nonNegative) as number[];
    if(sample.ownerState==='CLOSED'&&notionalUsd>0){status='CONFLICT';blockers.add(`CLOSED_POSITION_HAS_RISK:${key}`);}
    exposures.push({id:`position:${key}`,kind:'POSITION',symbol:norm(sample.symbol),underlying:canonicalRiskUnderlying(sample.symbol),side:sample.side,notionalUsd,marginUsd,quoteAsset:norm(sample.quoteAsset),marginAsset:norm(sample.marginAsset),ownerState:sample.ownerState,factStatus:status,maintenanceMarginUsd:maintenanceRows.length?Math.max(...maintenanceRows):null,liquidationBufferPct:liquidationRows.length?Math.min(...liquidationRows):null,handoffAt:finite(sample.handoffAt)?Number(sample.handoffAt):null,acknowledgedAt:finite(sample.acknowledgedAt)?Number(sample.acknowledgedAt):null});
  }

  const groupedPending=new Map<string,PortfolioPendingRiskFact[]>();
  for(const row of input.pending){
    const key=String(row.dedupeKey??'').trim();
    if(!key){blockers.add(`PENDING_DEDUPE_KEY_MISSING:${String(row.id??'UNKNOWN')}`);continue;}
    const group=groupedPending.get(key)??[];group.push(row);groupedPending.set(key,group);
  }
  for(const [key,rows] of groupedPending){
    const sample=rows[0],status=worstStatus(rows);
    const invalid=rows.some(row=>!String(row.id??'').trim()||!norm(row.symbol)||!['LONG','SHORT','BOTH'].includes(row.side)||!nonNegative(row.notionalUsd)||!nonNegative(row.marginUsd)||!norm(row.quoteAsset));
    if(invalid)blockers.add(`PENDING_RISK_INVALID:${key}`);
    if(status!=='VERIFIED')blockers.add(`PENDING_RISK_UNVERIFIED:${key}`);
    const notionalUsd=Math.max(0,...rows.map(row=>nonNegative(row.notionalUsd)?row.notionalUsd:0));
    const marginUsd=Math.max(0,...rows.map(row=>nonNegative(row.marginUsd)?row.marginUsd:0));
    exposures.push({id:`pending:${key}`,kind:'PENDING',symbol:norm(sample.symbol),underlying:canonicalRiskUnderlying(sample.symbol),side:sample.side,notionalUsd,marginUsd,quoteAsset:norm(sample.quoteAsset),marginAsset:norm(sample.quoteAsset),ownerState:null,factStatus:invalid?'CONFLICT':status,maintenanceMarginUsd:null,liquidationBufferPct:null,handoffAt:null,acknowledgedAt:null});
  }

  exposures.sort((a,b)=>a.id.localeCompare(b.id));
  const grossNotionalUsd=exposures.reduce((sum,row)=>sum+row.notionalUsd,0);
  const longNotionalUsd=exposures.filter(row=>row.side==='LONG'||row.side==='BOTH').reduce((sum,row)=>sum+row.notionalUsd,0);
  const shortNotionalUsd=exposures.filter(row=>row.side==='SHORT'||row.side==='BOTH').reduce((sum,row)=>sum+row.notionalUsd,0);
  const capitalAtRiskUsd=exposures.reduce((sum,row)=>sum+row.marginUsd,0);
  const pendingNotionalUsd=exposures.filter(row=>row.kind==='PENDING').reduce((sum,row)=>sum+row.notionalUsd,0);

  const underlyingMap=new Map<string,{underlying:string;grossNotionalUsd:number;longNotionalUsd:number;shortNotionalUsd:number}>();
  const quoteMap=new Map<string,{asset:string;grossNotionalUsd:number;marginUsedUsd:number;availableMarginUsd:number|null}>();
  for(const row of exposures){
    const underlying=underlyingMap.get(row.underlying)??{underlying:row.underlying,grossNotionalUsd:0,longNotionalUsd:0,shortNotionalUsd:0};
    underlying.grossNotionalUsd+=row.notionalUsd;if(row.side==='LONG'||row.side==='BOTH')underlying.longNotionalUsd+=row.notionalUsd;if(row.side==='SHORT'||row.side==='BOTH')underlying.shortNotionalUsd+=row.notionalUsd;underlyingMap.set(row.underlying,underlying);
    const asset=quoteMap.get(row.marginAsset)??{asset:row.marginAsset,grossNotionalUsd:0,marginUsedUsd:0,availableMarginUsd:assetMap.get(row.marginAsset)?.availableMarginUsd??null};
    asset.grossNotionalUsd+=row.notionalUsd;asset.marginUsedUsd+=row.marginUsd;quoteMap.set(row.marginAsset,asset);
  }
  for(const row of quoteMap.values())if(row.availableMarginUsd==null)blockers.add(`MARGIN_ASSET_UNVERIFIED:${row.asset}`);
  const underlying=[...underlyingMap.values()].sort((a,b)=>a.underlying.localeCompare(b.underlying));
  const quoteAssets=[...quoteMap.values()].sort((a,b)=>a.asset.localeCompare(b.asset));
  const blockerList=[...blockers].sort();
  const hashPayload={riskGeneration:input.riskGeneration,peakEquityUsd:input.peakEquityUsd,assets,cashFlows:[...input.cashFlows].map(row=>({id:row.id,amountUsd:row.amountUsd,factStatus:row.factStatus})).sort((a,b)=>a.id.localeCompare(b.id)),exposures,underlying,quoteAssets};
  return {version:'V3.9.6_PORTFOLIO_RISK_SNAPSHOT',riskGeneration:input.riskGeneration,createdAt:input.now,snapshotHash:stableRiskHash(hashPayload),complete:blockerList.length===0,blockers:blockerList,equityUsd,netExternalFlowUsd,flowAdjustedEquityUsd,peakEquityUsd:input.peakEquityUsd,drawdownPct,grossNotionalUsd,longNotionalUsd,shortNotionalUsd,capitalAtRiskUsd,pendingNotionalUsd,assets,exposures,underlying,quoteAssets};
}
