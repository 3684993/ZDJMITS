import { BrainDecisionSchema, ScoutAnnotationSchema, type BrainDecision, type EntryIntelligencePacket, type ScoutAnnotation } from '@zdj/contracts';
import { clamp } from '@zdj/core';
import type { AiModelClient, ModelRunResult } from '../../types.js';

export class MockAiClient implements AiModelClient {
  constructor(private contextProvider:()=>{packet?:EntryIntelligencePacket; kind?:'scout'|'brain'}){}
  async runJson<T>(args:{baseUrl:string;model:string;prompt:string;schemaName:string;timeoutMs:number;parse:(value:unknown)=>T}):Promise<ModelRunResult<T>>{
    const {packet,kind}=this.contextProvider(); if(!packet)throw new Error('Mock AI packet missing');
    await new Promise(r=>setTimeout(r,70));
    let raw:unknown;
    if(kind==='scout'){
      raw={symbol:packet.symbol,summary:`${packet.symbol} ranked #${packet.selection.rank}; 15m ${packet.market.technical['15m'].trend}; reachability ${packet.microstructure.reachabilityScore.toFixed(2)}.`,keyEvidence:[`15m trend=${packet.market.technical['15m'].trend}`,`15m MACD hist=${packet.market.technical['15m'].macdHistogram.toPrecision(4)}`,`spread=${packet.microstructure.spreadBps.toFixed(2)}bps`,`OI15m=${packet.market.derivatives.openInterestChange15m??'missing'}`],contradictions:packet.contradictions,missingEvidence:packet.evidenceCompleteness<.9?['Evidence completeness below 0.90']:[],attentionScore:clamp(packet.selection.score/100,0,1)} satisfies ScoutAnnotation;
      raw=ScoutAnnotationSchema.parse(raw);
    } else {
      const t=packet.market.technical; const weights=packet.directionPolicy.weights; let score=0; for(const tf of ['1m','5m','15m','4h','1d','1w']){const card=t[tf as keyof typeof t];const sign=card.trend==='UP'?1:card.trend==='DOWN'?-1:0;score+=sign*(weights[tf]??0)*card.trendStrength;}
      const quality=packet.evidenceCompleteness*0.5+packet.microstructure.reachabilityScore*0.25+packet.selection.score/100*0.25; const reject=Math.abs(score)<.34||quality<.58; const side=score>=0?'PLACE_LONG':'PLACE_SHORT'; const p=packet.market.quote.last, atr=packet.market.technical['5m'].atr14; const ideal=side==='PLACE_LONG'?p-atr*.30:p+atr*.30; const min=p-atr*.85,max=p+atr*.85;
      raw={action:'FINAL',direction:side==='PLACE_LONG'?'LONG':'SHORT',decision:reject?'REJECT_CANDIDATE':side,confidence:clamp(.5+Math.abs(score)*.18+(quality-.5)*.4,0,0.96),idealPrice:reject?null:ideal,acceptablePriceRange:reject?null:{min,max},horizonMinutes:reject?null:5,reachability:packet.microstructure.reachabilityScore,directionAnalysis:{trend1m:t['1m'].trend,trend5m:t['5m'].trend,trend15m:t['15m'].trend,trend4h:t['4h'].trend,trend1d:t['1d'].trend,trend1w:t['1w'].trend,weightedConclusion:`weightedScore=${score.toFixed(3)}`},supportingEvidence:[`eip:${packet.packetId}`,'tech.15m.trend','tech.15m.macd','price.spread'],contradictions:packet.contradictions,missingEvidence:packet.evidenceCompleteness<.9?['Some non-core evidence is incomplete']:[],evidenceRefs:['price.last','price.spread','tech.15m.trend','tech.15m.macd','derivatives.oi15','derivatives.taker'],entryInvalidation:'15m structure materially reverses before fill or acceptable price range becomes unreachable',reason:reject?'No sufficiently strong, reachable directional edge.':'Weighted multi-timeframe evidence supports an entry while higher timeframes remain contextual.',evidenceRequests:[]} satisfies BrainDecision;
      raw=BrainDecisionSchema.parse(raw);
    }
    return{value:args.parse(raw),inputTokens:Math.round(args.prompt.length/4),outputTokens:Math.round(JSON.stringify(raw).length/4),finishReason:'stop',modelIdentity:{requestedModel:args.model,modelAlias:'mock',quantization:null,templateSha256:null,serverBuild:'test-harness'},raw,timing:{requestMs:70,parseMs:0,retryMs:0}};
  }
}
