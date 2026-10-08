import {FundingIncomeLedger} from './fundingIncomeLedger.js';
import {projectTradeLearningFacts} from './tradeLearningFacts.js';
import {summarizeEntryQuality} from './tradingQualityBaseline.js';
import {buildEpisodeEvidence} from './tradingEpisodeEvidence.js';
import {describe,it,expect,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {projectExitProvenance} from './exitProvenance.js';
import {OrderProvenanceRegistry} from './orderProvenanceRegistry.js';
import {projectFillLedgers,attributeFunding} from './factLedgers.js';
import {projectEntryLineage} from './entryLineage.js';
import {canonicalPnlEligible} from './tradingQualityEligibility.js';
import {projectTradeRecordRow} from './tradeRecordReadModel.js';
import {economicEvidence} from './economicEvidence.js';
import {EconomicEvidenceSchema} from '@zdj/contracts';
const golden=JSON.parse(readFileSync(new URL('./fixtures/p0-exit-golden.json',import.meta.url),'utf8'));
const registries:OrderProvenanceRegistry[]=[];
afterEach(()=>{for(const r of registries.splice(0))r.close();});
function context(c:any){const registry=new OrderProvenanceRegistry(':memory:',()=>({environment:'TESTNET',account:'binance-primary'}));registries.push(registry);for(const row of c.registry)registry.record(row);return{executionFills:c.fills,manualOrders:new Map<string,any>(c.manualOrders.map((o:any)=>[o.id,o])),tpOrders:new Map<string,any>(c.tpOrders.map((o:any)=>[o.id,o])),orderProvenance:registry};}
const fill=(o:any={})=>({fillId:'f1',tradeId:'1',symbol:'BTCUSDT',direction:'LONG',side:'BUY',positionSide:'LONG',cycleId:'cy1',orderId:'ex1',clientOrderId:'cid1',qty:1,price:100,executionTime:2000,commission:.04,commissionAsset:'USDT',commissionUsd:.04,realizedPnl:0,source:'USER_DATA_WS',attributionStatus:'SYSTEM_ATTRIBUTED',...o});
const record=(o:any={})=>({tradeId:'t1',symbol:'BTCUSDT',direction:'LONG',cycleId:'cy1',status:'CLOSED',classification:'COMPLETE',recordCompleteness:'COMPLETE',feeCompleteness:'COMPLETE',canonical:true,integrityFlags:[],entryQty:1,exitQty:1,remainingQty:0,entryAveragePrice:100,exitAveragePrice:101,entryFillCount:1,exitFillCount:1,entryFee:.04,exitFee:.04,totalFee:.08,grossRealizedPnl:1,tradingNetPnlExFunding:.92,funding:0,fundingAttributionStatus:'EXACT',pnlBasis:'CANONICAL_NET_WITH_FUNDING',netPnl:.92,openedAt:2000,closedAt:4000,entryOrderIds:['o1','ex1'],exitOrderIds:['ex2'],linkedFillIds:['f1','f2'],source:'SYSTEM',entryLots:[{lotId:'lot1',intentId:'i1',orderId:'o1',exchangeOrderId:'ex1',quantity:1,averagePrice:100,filledAt:2000,allocatedEntryFee:.04}],...o});
function lineage(){return{executionFills:entries,entryIntents:new Map([['i1',{id:'i1',symbol:'BTCUSDT',brainRunId:'r1',planId:'p1',planVersion:1,createdAt:1600,packetId:'packet1'}]]),entryOrders:new Map([['o1',{id:'o1',intentId:'i1',symbol:'BTCUSDT',exchangeOrderId:'ex1'}]]),tradePlans:new Map([['p1',{planId:'p1',symbol:'BTCUSDT',cycleId:'cy1',planVersion:1,targetPrice:101,provenance:{modelRunId:'r1'}}]]),aiRuns:[{id:'r1',symbol:'BTCUSDT',role:'PRIMARY_BRAIN',requestSource:'ENTRY',status:'COMPLETED',startedAt:1000,completedAt:1500,model:'qwen',resourceId:'primary',modelIdentity:{modelAlias:'qwen'},inputPreview:JSON.stringify({packet:{packetId:'packet1',createdAt:900}})}]};}
const proof={accountScope:'acct',cycleId:'cy1',asset:'USDT',from:1000,to:5000,verifiedAt:6000,coverageIds:['coverage1'],complete:true,exposureUniverseComplete:true};
const income=(o:any={})=>({id:'fund1',asset:'USDT',symbol:'BTCUSDT',type:'FUNDING_FEE',amount:.1,at:3000,observedAt:5000,...o});
const entries=[fill(),fill({fillId:'f2',tradeId:'2',orderId:'ex2',clientOrderId:'cid2',side:'SELL',price:101,executionTime:4000,realizedPnl:1})];
describe('P0 exact exit golden facts',()=>{
 it('AAVE is pure manual with exact finalizer',()=>{const c=golden[0],r=projectExitProvenance(c.record,context(c));expect(r).toMatchObject({closeProvenance:'SYSTEM_MANUAL',exitComposition:'MANUAL',finalizer:'SYSTEM_MANUAL',identityConflict:false,proofCoverage:{complete:true,provenQuantity:11.4,unknownQuantity:0}});});
 it('ETHFI distinct TP/manual identities are mixed, never a collision',()=>{const c=golden[1],r=projectExitProvenance(c.record,context(c));expect(r).toMatchObject({closeProvenance:'MIXED_TP_MANUAL',exitComposition:'MIXED_TP_MANUAL',finalizer:'SYSTEM_MANUAL',identityConflict:false,proofCoverage:{complete:true,roleQuantities:{TP:118.5,MANUAL:3493.1}}});});
 it('same exchange ID dual role remains unresolved even with local manual compatibility',()=>{const c=golden[0],ctx=context(c),row=c.registry[0];ctx.orderProvenance.record({...row,clientOrderId:'collision',role:'TP'});expect(ctx.orderProvenance.resolve({symbol:c.symbol,exchangeOrderId:row.exchangeOrderId}).status).toBe('UNRESOLVED');expect(projectExitProvenance(c.record,ctx)).toMatchObject({closeProvenance:'CONFLICT',identityConflict:true});});
 it('same role across different cycles is a real identity conflict',()=>{const c=golden[0],ctx=context(c),row=c.registry[0];ctx.orderProvenance.record({...row,clientOrderId:'other-cycle',cycleId:'other'});expect(projectExitProvenance(c.record,ctx).identityConflict).toBe(true);});
 it('out of order WS and duplicate facts do not change mixed finalizer',()=>{const c=golden[1],ctx=context(c);ctx.executionFills=[...ctx.executionFills.reverse(),ctx.executionFills[0]];expect(projectExitProvenance(c.record,ctx)).toMatchObject({exitComposition:'MIXED_TP_MANUAL',finalizer:'SYSTEM_MANUAL',identityConflict:false});});
 it('missing partial exit is unknown coverage, not falsely fully manual',()=>{const c=golden[1],ctx=context(c);ctx.executionFills=ctx.executionFills.filter((f:any)=>f.fillId!=='exchange_ETHFIUSDC_63982896');expect(projectExitProvenance(c.record,ctx)).toMatchObject({finalizer:'TP',finalizerIsTerminalProof:false,proofCoverage:{complete:false}});});
 it('no maker flag or UI/source text can prove manual',()=>{const c=golden[0],ctx=context(c);ctx.manualOrders.clear();ctx.orderProvenance={resolve:()=>({status:'UNRESOLVED',rows:[]})} as any;expect(projectExitProvenance(c.record,ctx).closeProvenance).toBe('UNKNOWN');});
 it('a conflicting second writer cannot overwrite the registry raw row',()=>{const c=golden[0],ctx=context(c),row=c.registry[0],before=ctx.orderProvenance.list();expect(ctx.orderProvenance.record({...row,role:'TP'}).conflict).toBe('PROVENANCE_ROLE_CONFLICT');expect(ctx.orderProvenance.list()).toEqual(before);});
});
describe('P0 independent money and funding facts',()=>{
 it('missing coverage is UNKNOWN; complete zero is exact without fabricated income',()=>{expect(attributeFunding({record:record(),asset:'USDT',accountScope:'acct',income:[],exposures:[]}).amount).toBeNull();expect(attributeFunding({record:record(),asset:'USDT',accountScope:'acct',income:[],exposures:[],proof})).toMatchObject({status:'EXACT',amount:0});});
 it('separates commission and realized income from funding',()=>{expect(attributeFunding({record:record(),asset:'USDT',accountScope:'acct',income:[income({type:'COMMISSION'}),income({id:'pnl',type:'REALIZED_PNL'})],exposures:[],proof}).amount).toBe(0);});
 it('late funding needs coverage reverification and cannot preserve old zero',()=>{const args={record:record(),asset:'USDT',accountScope:'acct',income:[income({observedAt:7000})],exposures:[{cycleId:'cy1',side:'LONG' as const,fills:entries,complete:true}],proof};expect(attributeFunding(args).reasons).toContain('LATE_FUNDING_REQUIRES_REVERIFICATION');expect(attributeFunding({...args,proof:{...proof,verifiedAt:8000}})).toMatchObject({status:'EXACT',amount:.1});});
 it('uses quantities at funding time across adds and partial exit',()=>{const lots=[fill({qty:2}),fill({fillId:'add',tradeId:'3',qty:3,executionTime:2100}),fill({fillId:'partial',tradeId:'4',qty:1,side:'SELL',executionTime:2200})];const result=attributeFunding({record:record(),asset:'USDT',accountScope:'acct',income:[income()],proof,exposures:[{cycleId:'cy1',side:'LONG',fills:lots,complete:true}]});expect(result.allocations[0]?.quantityAtEvent).toBe(4);expect(result.amount).toBe(.1);});
 it('hedge/multiple cycles and missing symbol stay unknown, not proportional guessed allocation',()=>{const args={record:record(),asset:'USDT',accountScope:'acct',income:[income()],proof,exposures:[{cycleId:'cy1',side:'LONG' as const,fills:entries,complete:true},{cycleId:'cy2',side:'SHORT' as const,fills:[fill({side:'SELL'})],complete:true}]};expect(attributeFunding(args).status).toBe('UNKNOWN');expect(attributeFunding({...args,income:[income({symbol:null})]}).status).toBe('UNKNOWN');});
 it('conserves separate assets without assumed USDC/USDT FX',()=>{expect(projectFillLedgers(record(),entries)).toMatchObject({complete:true,byAsset:{USDT:{commission:.08,realizedPnl:1}}});expect(projectFillLedgers(record(),entries.map(f=>({...f,commissionAsset:'USDC'}))).reasons).toContain('FEE_FX_PROOF_MISSING');});
});
describe('P0 origin authority chain',()=>{
 it('exact lot has own model/resource/context/TP/time binding',()=>{expect(projectEntryLineage(record(),lineage())).toMatchObject({complete:true,lots:[{runId:'r1',entryCost:100,tpVersion:1,firstFillAt:2000,status:'EXACT'}]});});
 it('late/missing/review run is omitted without clamp or cycle fallback',()=>{for(const mode of ['late','missing','review']){const c=lineage();if(mode==='late')c.aiRuns[0]!.completedAt=2500;else if(mode==='missing')c.aiRuns=[];else c.aiRuns[0]!.role='REVIEW_BRAIN';expect(projectEntryLineage(record(),c).complete).toBe(false);}});
 it('add lot must use independent intent/order/plan/run',()=>{const c=lineage(),r=record();r.entryLots.push({...r.entryLots[0],lotId:'lot2',intentId:'missing-add'});expect(projectEntryLineage(r,c)).toMatchObject({complete:false,originRunId:null});});
 it('final cycle VWAP cannot change origin lot cost or first fill',()=>{expect(projectEntryLineage(record({entryAveragePrice:999}),lineage()).lots[0]?.entryCost).toBe(100);});
});
describe('P0 canonical training and calibrated economics',()=>{
 it('only complete scoped funding, fill, identity, and origin proofs can qualify even mixed exits',()=>{const rec=record(),c={...lineage(),executionFills:entries,manualOrders:new Map(),tpOrders:new Map(),orderProvenance:{resolve:()=>({status:'SYSTEM_PROVEN',rows:[{symbol:'BTCUSDT',clientOrderId:'cid2',exchangeOrderId:'ex2',cycleId:'cy1',role:'TP'}]})}} as any;const facts={fillLedger:projectFillLedgers(rec,entries),entry:projectEntryLineage(rec,c),exit:projectExitProvenance(rec,c),funding:attributeFunding({record:rec,asset:'USDT',accountScope:'acct',income:[],exposures:[],proof})};const f={attributionStatus:'EXACT' as const,factIds:['coverage1'],coverageStartAt:1000,coverageEndAt:5000,verifiedAt:6000,accountScope:'acct',cycleId:'cy1'};expect(canonicalPnlEligible(rec,{fundingEvidence:f,accountScope:'acct',learningFacts:facts}).eligible).toBe(true);expect(canonicalPnlEligible({...rec,funding:null,fundingAttributionStatus:'UNKNOWN'},{fundingEvidence:f,accountScope:'acct',learningFacts:facts}).eligible).toBe(false);expect(projectTradeRecordRow(rec).formalNetPnl).toBeNull();});
 it('a probability or scenario does not become calibrated EV',()=>{const e=economicEvidence({conditionalNet:2,requiredProfit:1,probability:.9,samples:65,source:'CANDLES'});expect(e).toMatchObject({historicalTouchEstimate:{status:'ESTIMATE'},scenarioExpectedPayoff:{status:'SCENARIO'},calibratedExpectedNetPnl:{status:'UNKNOWN',value:null}});expect(EconomicEvidenceSchema.safeParse({...e,calibratedExpectedNetPnl:{status:'KNOWN',value:1,proof:null}}).success).toBe(false);});
});

it('mixed exact identities can qualify when every money and origin proof is complete',()=>{
 const rec=record({exitOrderIds:['ex2','ex3'],exitFillCount:2}),fills=[entries[0]!,{...entries[1]!,qty:.5,commission:.02,realizedPnl:.5},{...entries[1]!,fillId:'f3',tradeId:'3',qty:.5,commission:.02,realizedPnl:.5,orderId:'ex3',clientOrderId:'cid3',executionTime:3900}];rec.linkedFillIds.push('f3');
 const c={...lineage(),executionFills:fills,manualOrders:new Map(),tpOrders:new Map(),orderProvenance:{resolve:({exchangeOrderId}:any)=>({status:'SYSTEM_PROVEN',rows:[{symbol:'BTCUSDT',exchangeOrderId,cycleId:'cy1',role:exchangeOrderId==='ex3'?'MANUAL':'TP'}]})}} as any;
 const facts=projectTradeLearningFacts(rec,c,attributeFunding({record:rec,asset:'USDT',accountScope:'acct',income:[],exposures:[],proof}));
 expect(facts.exit.exitComposition).toBe('MIXED_TP_MANUAL');
 const fundingEvidence={attributionStatus:'EXACT' as const,factIds:['coverage1'],coverageStartAt:1000,coverageEndAt:5000,verifiedAt:6000,accountScope:'acct',cycleId:'cy1'};
 expect(canonicalPnlEligible(rec,{accountScope:'acct',fundingEvidence,learningFacts:facts}).eligible).toBe(true);
});
it('read model consumes durable zero proof and rejects a foreign account scope',()=>{
 const rec=record({learningFundingProof:{accountScope:'TESTNET|acct',cycleId:'cy1',asset:'USDT',amount:0,from:1000,to:5000,verifiedAt:6000,coverageIds:['coverage1'],allocations:[]}});
 const c={...lineage(),executionFills:entries,manualOrders:new Map(),tpOrders:new Map(),settings:{connections:{exchange:{environment:'TESTNET',credentialRef:'acct'}}},orderProvenance:{resolve:()=>({status:'SYSTEM_PROVEN',rows:[{symbol:'BTCUSDT',exchangeOrderId:'ex2',cycleId:'cy1',role:'TP'}]})}} as any;
 expect(projectTradeRecordRow(rec,{learningContext:c}).formalNetPnl).toBe(.92);
 c.settings.connections.exchange.credentialRef='other';expect(projectTradeRecordRow(rec,{learningContext:c}).formalNetPnl).toBeNull();
});
it('durable ledger requires unique timeline ownership for nonzero funding and never treats USDC as USD',()=>{
 const ledger=new FundingIncomeLedger(':memory:',()=>({environment:'TESTNET',account:'acct'}));
 try{ledger.recordRows([{incomeId:'f',incomeType:'FUNDING_FEE',asset:'USDT',symbol:'BTCUSDT',income:.1,time:3000,observedAt:5000}]);ledger.recordCoverage({asset:'USDT',sinceMs:1000,untilMs:5000,complete:true,pages:1,rows:1,observedAt:6000});
 const input={asset:'USDT',symbol:'BTCUSDT',fromMs:2000,toMs:4000};expect(ledger.attribution(input).status).toBe('UNKNOWN');
 expect(ledger.attribution({...input,ownership:{record:record(),exposures:[{cycleId:'cy1',side:'LONG',fills:entries,complete:true}],universeComplete:true}})).toMatchObject({status:'EXACT',fundingNative:{asset:'USDT',amount:.1}});
 ledger.recordCoverage({asset:'USDC',sinceMs:1000,untilMs:5000,complete:true,pages:1,rows:0,observedAt:6000});expect(ledger.attribution({...input,asset:'USDC'})).toMatchObject({status:'EXACT',fundingUsd:null,fundingNative:{asset:'USDC',amount:0}});
 ledger.recordRows([{incomeId:'f',incomeType:'FUNDING_FEE',asset:'USDT',symbol:'BTCUSDT',income:99,time:3000,observedAt:7000}]);expect(ledger.attribution(input).reason).toBe('FUNDING_IDENTITY_CONFLICT');
 }finally{ledger.close();}
});
it('late origin is explicitly omitted from aggregate path metrics rather than clamped',()=>{
 const ep=buildEpisodeEvidence({run:{id:'r1',symbol:'BTCUSDT',startedAt:1000,completedAt:2500,status:'COMPLETED',requestSource:'ENTRY'},intent:{id:'i1',brainRunId:'r1',symbol:'BTCUSDT'},orders:[{id:'o1',intentId:'i1',symbol:'BTCUSDT',exchangeOrderId:'ex1'}],fills:entries as any,tradeRecords:[record()]});
 expect(ep.originRunEligibility).toMatchObject({eligible:false,reasons:['ORIGIN_RUN_AFTER_FILL']});expect(summarizeEntryQuality([ep])).toMatchObject({originUncertainOmitted:1,episodeCount:0});
});

it('a later add lot keeps its own Entry decision and execution stages',()=>{
 const c=lineage(),rec=record({entryQty:2}),add=fill({fillId:'addfill',tradeId:'3',orderId:'ex3',clientOrderId:'cid3',executionTime:3600,price:110});
 c.executionFills=[...entries,add];rec.linkedFillIds.push('addfill');rec.entryOrderIds.push('o3','ex3');rec.entryLots.push({...rec.entryLots[0],lotId:'lot3',orderId:'o3',intentId:'i3',exchangeOrderId:'ex3',averagePrice:110,filledAt:3600});
 c.entryOrders.set('o3',{id:'o3',intentId:'i3',symbol:'BTCUSDT',exchangeOrderId:'ex3'});c.entryIntents.set('i3',{...c.entryIntents.get('i1')!,id:'i3',brainRunId:'r3',planId:'p3',createdAt:3550,packetId:'packet3'});
 c.tradePlans.set('p3',{...c.tradePlans.get('p1')!,planId:'p3',planVersion:1,provenance:{modelRunId:'r3'}});c.aiRuns.push({...c.aiRuns[0]!,id:'r3',startedAt:3000,completedAt:3500,inputPreview:JSON.stringify({packet:{packetId:'packet3',createdAt:2900}})});
 expect(projectEntryLineage(rec,c)).toMatchObject({complete:true,originRunId:'r1',lots:[{runId:'r1',entryCost:100,fillStages:[{quantity:1,entryCost:100}]},{runId:'r3',entryCost:110,fillStages:[{quantity:1,entryCost:110}]}]});
});
