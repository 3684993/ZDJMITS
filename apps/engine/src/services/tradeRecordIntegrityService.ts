import { TradeRecordSchema, type TradeRecord, type TradeRecordClassification } from '@zdj/contracts';
import type { RuntimeState } from '../state/runtimeState.js';

const hasExitFacts=(record:TradeRecord)=>record.exitFillCount>0&&record.exitAveragePrice!=null&&record.exitGrossNotional>0;
const hasEntryFacts=(record:TradeRecord)=>record.entryFillCount>0||record.entryQty>0&&record.entryAveragePrice!=null;
const validNumber=(value:number|null|undefined)=>value!=null&&Number.isFinite(value);

export interface TradeRecordIntegritySummary {
  total:number;complete:number;partial:number;imported:number;external:number;duplicate:number;conflict:number;invalid:number;
  invalidClosed:number;invalidRoi:number;missingExit:number;missingFee:number;missingMargin:number;
}

export class TradeRecordIntegrityService {
  constructor(private state:RuntimeState){}

  /** COMPLETE is only allowed when the stored record reconciles to the retained
   * exchange/user-trade fills.  Booked averages or position size are not a fill fact. */
  private conserved(record:TradeRecord){
    const matched=this.state.executionFills.filter((fill:any)=>fill.symbol===record.symbol&&(record.linkedFillIds.includes(fill.fillId)||record.entryOrderIds.includes(fill.orderId)||record.exitOrderIds.includes(fill.orderId))),related=[...new Map(matched.map((fill:any)=>[`${fill.symbol}:${fill.tradeId}`,fill])).values()] as any[];
    const entry=related.filter((fill:any)=>fill.side===(record.direction==='LONG'?'BUY':'SELL')),
      exit=related.filter((fill:any)=>!entry.includes(fill));
    const entryQty=entry.reduce((n:number,fill:any)=>n+Number(fill.qty),0),exitQty=exit.reduce((n:number,fill:any)=>n+Number(fill.qty),0),eps=1e-8;
    return {ok:entry.length===record.entryFillCount&&exit.length===record.exitFillCount&&Math.abs(entryQty-record.entryQty)<=eps&&Math.abs(exitQty-record.entryQty)<=eps,entryQty,exitQty,entryCount:entry.length,exitCount:exit.length};
  }

  private duplicateGroups(records:TradeRecord[]){
    const groups=new Map<string,TradeRecord[]>();
    for(const record of records){
      const ids=[...record.entryOrderIds,...record.exitOrderIds,...record.linkedFillIds].filter(Boolean).sort();
      if(!ids.length&&record.cycleId==null)continue;
      const key=`${record.symbol}:${record.direction}:${record.cycleId??ids.join('|')}`;
      const group=groups.get(key)??[];group.push(record);groups.set(key,group);
    }
    return [...groups.values()].filter(group=>group.length>1);
  }

  classifyAll():TradeRecordIntegritySummary{
    const source=[...this.state.tradeRecords.values()].map(row=>TradeRecordSchema.parse(row));
    const summary:TradeRecordIntegritySummary={total:source.length,complete:0,partial:0,imported:0,external:0,duplicate:0,conflict:0,invalid:0,invalidClosed:0,invalidRoi:0,missingExit:0,missingFee:0,missingMargin:0};
    const duplicateOf=new Map<string,string>();
    for(const record of source)if(record.duplicateOf)duplicateOf.set(record.tradeId,record.duplicateOf);
    for(const group of this.duplicateGroups(source)){
      const ranked=[...group].sort((a,b)=>this.score(b)-this.score(a));
      for(const duplicate of ranked.slice(1))duplicateOf.set(duplicate.tradeId,ranked[0]!.tradeId);
    }
    for(const raw of source){
      const flags=new Set(raw.integrityFlags),missing=new Set(raw.missingFacts),hasEntry=hasEntryFacts(raw),hasExit=hasExitFacts(raw);
      let record={...raw,entryFee:raw.entryFee,exitFee:raw.exitFee,totalFee:raw.totalFee,netPnl:raw.netPnl,netRoiOnMargin:raw.netRoiOnMargin,canonical:true,duplicateOf:null as string|null,integrityFlags:[...flags],missingFacts:[...missing]};
      const conservation=this.conserved(raw);
      if(!hasEntry){missing.add('ENTRY_FACT');}else missing.delete('ENTRY_FACT');
      if(!conservation.ok){missing.add('EXCHANGE_FILL_CONSERVATION');flags.add('FILL_CONSERVATION_FAILED');}else{missing.delete('EXCHANGE_FILL_CONSERVATION');flags.delete('FILL_CONSERVATION_FAILED');}
      if(raw.status==='CLOSED'&&!hasExit){missing.add('EXIT_FACT');summary.invalidClosed++;summary.missingExit++;}else if(hasExit){missing.delete('EXIT_FACT');flags.delete('CLOSED_NO_EXIT_FACT');}
      if(raw.feeCompleteness!=='COMPLETE'){missing.add('FEE_FACT');summary.missingFee++;record={...record,entryFee:raw.feeCompleteness==='UNKNOWN'?null:raw.entryFee,exitFee:raw.feeCompleteness==='UNKNOWN'?null:raw.exitFee,totalFee:null,netPnl:null,netRoiOnMargin:null};}
      else missing.delete('FEE_FACT');
      if(raw.netRoiOnMargin!=null&&(!validNumber(raw.netRoiOnMargin)||Math.abs(raw.netRoiOnMargin)>=1000)){flags.add('INVALID_ROI_SENTINEL');record={...record,netRoiOnMargin:null};summary.invalidRoi++;}
      // Margin is needed for ROI-on-margin, but not for fill/PnL conservation.
      // Keep it observable without downgrading an otherwise complete closed trade.
      if(raw.marginUsed==null&&raw.netPnl!=null){summary.missingMargin++;missing.delete('MARGIN_FACT');record={...record,netRoiOnMargin:null};}else if(raw.marginUsed!=null)missing.delete('MARGIN_FACT');
      if(!hasExit){record={...record,exitAveragePrice:null,exitGrossNotional:0,grossRealizedPnl:null,netPnl:null,netReturnOnNotional:null,netRoiOnMargin:null};}
      let classification:TradeRecordClassification='PARTIAL';
      if(duplicateOf.has(raw.tradeId)){classification='DUPLICATE';record={...record,canonical:false,duplicateOf:duplicateOf.get(raw.tradeId)!};summary.duplicate++;}
      else if(raw.source==='IMPORTED_AT_STARTUP'||raw.status==='IMPORTED_OPEN_POSITION'){classification='IMPORTED';summary.imported++;}
      else if(raw.source==='EXTERNAL'){classification='EXTERNAL';summary.external++;}
      else if(flags.has('CONFLICT')){classification='CONFLICT';summary.conflict++;}
      else if(flags.has('INVALID_ROI_SENTINEL')||raw.entryQty<0||raw.entryGrossNotional<0||raw.updatedAt<raw.createdAt){classification='INVALID';summary.invalid++;}
      else if(raw.status==='CLOSED'&&raw.recordCompleteness==='COMPLETE'&&raw.feeCompleteness==='COMPLETE'&&hasEntry&&hasExit&&conservation.ok&&(record.tradingNetPnlExFunding??record.netPnl)!=null&&missing.size===0){classification='COMPLETE';summary.complete++;}
      else{classification='PARTIAL';summary.partial++;}
      if(classification==='COMPLETE')record.missingFacts=[];
      record={...record,classification,missingFacts:[...missing],integrityFlags:[...flags],repairSource:raw.repairSource??(raw.source==='LOCAL_LIFECYCLE_REPAIR_FROM_EXCHANGE_FACT'?raw.source:null)};
      this.state.tradeRecords.set(record.tradeId,TradeRecordSchema.parse(record));
      if(classification!=='COMPLETE')this.state.experienceSamples.delete(`sample_${record.tradeId}`);
    }
    return summary;
  }

  private score(record:TradeRecord){return(record.recordCompleteness==='COMPLETE'?100000:0)+(record.feeCompleteness==='COMPLETE'?10000:0)+(record.entryFillCount+record.exitFillCount)*10+(record.linkedFillIds.length)+(record.createdAt?1:0);}
  summary(){
    const copy=Object.create(Object.getPrototypeOf(this.state));Object.assign(copy,this.state,{tradeRecords:new Map(this.state.tradeRecords),experienceSamples:new Map(this.state.experienceSamples)});
    return new TradeRecordIntegrityService(copy).classifyAll();
  }
  canonicalRecords(){return [...this.state.tradeRecords.values()].filter(record=>record.canonical&&record.classification==='COMPLETE'&&record.status==='CLOSED'&&record.recordCompleteness==='COMPLETE'&&record.feeCompleteness==='COMPLETE');}
}
