import type {ExecutionFill, TradeRecord} from '@zdj/contracts';
export type IncomeFact={id:string;asset:string;symbol:string|null;type:string;amount:number;at:number;observedAt:number};
export type FundingProof={accountScope:string;cycleId:string;asset:string;from:number;to:number;verifiedAt:number;coverageIds:string[];complete:boolean;exposureUniverseComplete:boolean};
export type CycleExposure={cycleId:string;side:'LONG'|'SHORT';fills:ExecutionFill[];complete:boolean};
const eps=(n:number)=>Math.max(1e-10,Math.abs(n)*1e-8);
/** Never derives FX, never folds income COMMISSION/REALIZED_PNL into FUNDING_FEE. */
export function attributeFunding(input:{record:TradeRecord;asset:string;accountScope:string;proof?:FundingProof;income:IncomeFact[];exposures:CycleExposure[]}) {
  const {record,proof}=input; const reasons:string[]=[];
  if (!proof || !proof.complete || !proof.coverageIds.length || proof.accountScope!==input.accountScope || proof.asset!==input.asset || proof.cycleId!==record.cycleId || record.openedAt==null || record.closedAt==null || proof.from>record.openedAt || proof.to<record.closedAt || proof.verifiedAt<proof.to) reasons.push('FUNDING_COVERAGE_NOT_PROVEN');
  const rows=input.income.filter(r=>r.type==='FUNDING_FEE' && r.asset===input.asset && r.at>=(record.openedAt??Infinity) && r.at<=(record.closedAt??-Infinity) && (r.symbol===record.symbol||r.symbol===null));
  const dedup=new Map<string,IncomeFact>();
  for (const row of rows) {const prior=dedup.get(row.id);if(!Number.isFinite(row.amount)||!Number.isFinite(row.at)||prior&&JSON.stringify(prior)!==JSON.stringify(row))reasons.push('FUNDING_IDENTITY_CONFLICT');else dedup.set(row.id,row);}
  if(rows.some(row=>!Number.isFinite(row.observedAt)||row.observedAt>(proof?.verifiedAt??-Infinity)))reasons.push('LATE_FUNDING_REQUIRES_REVERIFICATION');
  let amount=0;const allocations:Array<{incomeId:string;cycleId:string;quantityAtEvent:number;amount:number;asset:string}>=[];
  for(const row of dedup.values()) {
    if(row.symbol===null) {reasons.push('FUNDING_SYMBOL_UNRESOLVED');continue;}
    if(!proof?.exposureUniverseComplete) {reasons.push('FUNDING_EXPOSURE_UNIVERSE_UNPROVEN');continue;}
    const universe=input.exposures.filter(e=>e.fills.some(f=>f.symbol===record.symbol));
    if(universe.some(e=>e.fills.some(f=>f.symbol!==record.symbol||!Number.isFinite(f.qty)||f.qty<=0||!Number.isFinite(f.executionTime)))){reasons.push('FUNDING_EXPOSURE_FACT_INVALID');continue;}
    const owners=universe.filter(e=>{
      if(!e.complete)return true;
      const signed=e.fills.filter(f=>f.executionTime<row.at).reduce((n,f)=>n+(f.side===(e.side==='LONG'?'BUY':'SELL')?f.qty:-f.qty),0);
      return signed>eps(signed);
    });
    if(owners.length!==1||!owners[0]!.complete||owners[0]!.cycleId!==record.cycleId||owners[0]!.fills.some(f=>f.executionTime===row.at)) {reasons.push('FUNDING_OWNER_NOT_UNIQUE');continue;}
    const exposure=owners[0]!,qty=exposure.fills.filter(f=>f.executionTime<row.at).reduce((n,f)=>n+(f.side===(exposure.side==='LONG'?'BUY':'SELL')?f.qty:-f.qty),0);
    allocations.push({incomeId:row.id,cycleId:exposure.cycleId,quantityAtEvent:qty,amount:row.amount,asset:row.asset});amount+=row.amount;
  }
  return {status:reasons.length?'UNKNOWN' as const:'EXACT' as const,amount:reasons.length?null:amount,asset:input.asset,reasons:[...new Set(reasons)],allocations,coverageIds:proof?.coverageIds??[]};
}
/** Per-asset fill ledger. Numeric usd fields do not prove a USDC/USDT conversion. */
export function projectFillLedgers(record:TradeRecord, fills:ExecutionFill[]) {
  const linked=new Set(record.linkedFillIds);const rows=new Map<string,ExecutionFill>();const reasons:string[]=[];
  for(const f of fills.filter(f=>linked.has(f.fillId))) {
    const prior=rows.get(f.fillId);
    if(prior && ['qty','price','commission','commissionAsset','realizedPnl','orderId','executionTime','cycleId'].some(k=>(prior as any)[k]!==(f as any)[k]))reasons.push('FILL_LEDGER_CONFLICT');else rows.set(f.fillId,f);
  }
  if(rows.size!==linked.size||!linked.size)reasons.push('FILL_LEDGER_COVERAGE_MISSING');
  const byAsset:Record<string,{commission:number;realizedPnl:number;funding:null}>={};let entryQty=0,exitQty=0;
  const quoteAsset=record.symbol.endsWith('USDC')?'USDC':record.symbol.endsWith('USDT')?'USDT':null;
  if(!quoteAsset)reasons.push('QUOTE_ASSET_UNKNOWN');
  for(const f of rows.values()) {
    if(!Number.isFinite(f.qty)||f.qty<=0||!Number.isFinite(f.price)||f.price<=0||!Number.isFinite(f.executionTime)||record.openedAt==null||record.closedAt==null||f.executionTime<record.openedAt||f.executionTime>record.closedAt)reasons.push('FILL_RANGE_INVALID');
    const isEntry=f.side===(record.direction==='LONG'?'BUY':'SELL'),ids=isEntry?record.entryOrderIds:record.exitOrderIds;
    if(!ids.includes(f.orderId)&&!ids.includes(f.clientOrderId))reasons.push('FILL_ORDER_CHAIN_UNPROVEN');
    if(f.symbol!==record.symbol||f.cycleId&&f.cycleId!==record.cycleId)reasons.push('FILL_SCOPE_CONFLICT');
    if(!Number.isFinite(f.commission)||f.commission<0||!f.commissionAsset)reasons.push('COMMISSION_FACT_MISSING');
    if(f.commissionAsset!==quoteAsset)reasons.push('FEE_FX_PROOF_MISSING');
    if(!Number.isFinite(f.realizedPnl))reasons.push('REALIZED_PNL_FACT_MISSING');
    const fee=byAsset[f.commissionAsset]??={commission:0,realizedPnl:0,funding:null};fee.commission+=f.commission;
    if(quoteAsset)(byAsset[quoteAsset]??={commission:0,realizedPnl:0,funding:null}).realizedPnl+=f.realizedPnl;
    if(f.side===(record.direction==='LONG'?'BUY':'SELL'))entryQty+=f.qty;else exitQty+=f.qty;
  }
  if(Math.abs(entryQty-record.entryQty)>eps(record.entryQty)||Math.abs(exitQty-(record.exitQty??-1))>eps(record.entryQty))reasons.push('FILL_QUANTITY_NOT_CONSERVED');
  if(record.totalFee==null||record.grossRealizedPnl==null)reasons.push('FILL_MONEY_FACTS_MISSING');
  if(quoteAsset&&byAsset[quoteAsset]&&(Math.abs(byAsset[quoteAsset]!.commission-(record.totalFee??NaN))>1e-8||Math.abs(byAsset[quoteAsset]!.realizedPnl-(record.grossRealizedPnl??NaN))>1e-8))reasons.push('FILL_MONEY_NOT_CONSERVED');
  return {complete:reasons.length===0,reasons:[...new Set(reasons)],quoteAsset,byAsset,entryQty,exitQty,fillIds:[...rows.keys()]};
}
