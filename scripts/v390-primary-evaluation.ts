import {readFile,writeFile} from 'node:fs/promises';
import {EntryIntelligencePacketSchema,EntryDecisionJsonSchema} from '@zdj/contracts';
import {buildCompactBrainPrompt} from '@zdj/core';
import {entryDecisionParse} from '../apps/engine/src/services/aiFabric.js';
import {OpenAiCompatibleClient} from '../apps/engine/src/adapters/ai/OpenAiCompatibleClient.js';
const settings=JSON.parse(await readFile('config/settings.default.json','utf8')),resource=settings.aiResources.find((r:any)=>r.role==='PRIMARY_BRAIN'&&r.enabled),fixtures=JSON.parse(await readFile('apps/engine/src/services/fixtures/v363-entry.json','utf8'));
resource.baseUrl=process.env.V390_PRIMARY_BASE_URL??resource.baseUrl;
const client=new OpenAiCompatibleClient(),cases:any[]=[],count=Number(process.env.V390_PRIMARY_CASES??60);
for(let i=0;i<count;i++){
 const p=EntryIntelligencePacketSchema.parse(structuredClone(fixtures[i%fixtures.length].packet)),now=Date.now(),trend=['UP','DOWN','RANGE'][i%3],direction=trend==='UP'?'LONG':trend==='DOWN'?'SHORT':null;
 p.createdAt=now;p.expiresAt=now+300000;p.packetId=`isolated-primary-${i}`;p.market.quote.ts=now;p.market.orderBook.ts=now;
 for(const [tf,t] of Object.entries(p.market.technical)){const row:any=t;row.asOf=now-1000;row.barCloseTime=now-1000;row.receivedAt=now;row.isClosed=true;delete row.inProgressBar;if(tf==='15m'){row.trend=trend;row.trendStrength=trend==='RANGE'?.1:.65+(i%7)*.04;row.emaSlope21=direction==='LONG'?.002:direction==='SHORT'?-.002:0;row.macdHistogram=direction==='LONG'?Math.abs(row.macdHistogram):direction==='SHORT'?-Math.abs(row.macdHistogram):0;}}
 const q=p.market.quote;p.market.recentTradedPrices=[{price:q.bid,lastSeenAt:now},{price:q.ask,lastSeenAt:now}];
 if(p.portfolioIntelligence)p.portfolioIntelligence.allowedDirections=['LONG','SHORT'];
 (p as any).capitalEnvelope={longExecutable:true,shortExecutable:true,longAvailableNotionalUsd:1000+i,shortAvailableNotionalUsd:1000+i,minExecutableMargin:5,capitalGeneration:i};
 const start=Date.now();
 try{const result=await client.runJson({baseUrl:resource.baseUrl,model:resource.model,prompt:buildCompactBrainPrompt(p),schemaName:'EntryDecision',jsonSchema:EntryDecisionJsonSchema as any,timeoutMs:90000,maxOutputTokens:900,parse:v=>entryDecisionParse(v,p)});
 const d:any=result.value,isPlace=String(d.decision).startsWith('PLACE_'),expectedPrice=d.direction==='LONG'?q.bid:q.ask,range=d.acceptablePriceRange;
 const directionConflict=direction!==null&&d.direction!==direction,unreachablePlace=isPlace&&(!range||expectedPrice<range.min||expectedPrice>range.max);
 cases.push({id:i,trend,source:'SYNTHETIC_VARIANT_OF_ARCHIVED_PACKET',packet:p,raw:result.raw,decision:d,latencyMs:Date.now()-start,directionConflict,unreachablePlace,passed:!directionConflict&&!unreachablePlace});
 }catch(e:any){cases.push({id:i,trend,packet:p,error:String(e),rawOutput:e.rawOutput??null,latencyMs:Date.now()-start,passed:false});}
 if((i+1)%10===0){await persist();console.log(JSON.stringify({completed:i+1,failed:cases.filter(x=>!x.passed).length}));}
}
async function persist(){const summary={cases:cases.length,passed:cases.filter(x=>x.passed).length,failed:cases.filter(x=>!x.passed).length,directionConflicts:cases.filter(x=>x.directionConflict).length,unreachablePlaces:cases.filter(x=>x.unreachablePlace).length};await writeFile(process.env.V390_PRIMARY_OUTPUT??'docs/reports/v390-primary-quality-raw.json',JSON.stringify({generatedAt:new Date().toISOString(),scope:'CONTRACT_AND_DIRECTION_CONSISTENCY_ONLY_NOT_PROFITABILITY',model:resource.model,baseUrl:resource.baseUrl,exchangeWrites:0,summary,cases},null,2));return summary;}
console.log(JSON.stringify(await persist()));if(cases.some(x=>!x.passed))process.exitCode=1;
