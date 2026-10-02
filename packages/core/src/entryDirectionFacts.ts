import type {EntryIntelligencePacket,MarketSymbolSnapshot} from '@zdj/contracts';

type TrendDirectionRole='SUPPORTS_LONG'|'SUPPORTS_SHORT'|'NEUTRAL';
const roleOf=(trend:unknown):TrendDirectionRole=>trend==='UP'?'SUPPORTS_LONG':trend==='DOWN'?'SUPPORTS_SHORT':'NEUTRAL';
const sideOf=(role:TrendDirectionRole):'LONG'|'SHORT'|null=>role==='SUPPORTS_LONG'?'LONG':role==='SUPPORTS_SHORT'?'SHORT':null;

/** Objective labels are source facts, not the model's chosen trade direction. */
export function directionFacts(snapshot:MarketSymbolSnapshot){
  const trend1dRole=roleOf(snapshot.technical['1d']?.trend),trend4hRole=roleOf(snapshot.technical['4h']?.trend),
    trend15mRole=roleOf(snapshot.technical['15m']?.trend);
  const oneDay=sideOf(trend1dRole),fourHour=sideOf(trend4hRole),fifteen=sideOf(trend15mRole);
  const strategicConsensus=oneDay!==null&&oneDay===fourHour?oneDay:null;
  const baseAlignmentClass:'ALIGNED_LONG'|'ALIGNED_SHORT'|'MIXED'=
    strategicConsensus==='LONG'&&(fifteen===null||fifteen==='LONG')?'ALIGNED_LONG':
    strategicConsensus==='SHORT'&&(fifteen===null||fifteen==='SHORT')?'ALIGNED_SHORT':'MIXED';
  return{trend1dRole,trend4hRole,trend15mRole,strategicConsensus,baseAlignmentClass};
}

/** Packet identity binds the private request snapshot. It does not renew any execution clock. */
export function frozenEntryDirectionFacts(packet:EntryIntelligencePacket){
  return{version:`${packet.packetId}:D1`,packetId:packet.packetId,...directionFacts(packet.market)};
}
