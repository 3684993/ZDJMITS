import {readFile,writeFile} from 'node:fs/promises';
import {parseExternalResearch} from '../apps/engine/src/services/aiFabric.js';
import {OpenAiCompatibleClient} from '../apps/engine/src/adapters/ai/OpenAiCompatibleClient.js';
import {buildExternalResearchPrompt,externalResearchJsonSchema,verifyExternalResearch,materializeExternalResearch} from '../apps/engine/src/services/externalResearchQuality.js';
import type {ExternalIntelligenceSnapshot} from '../apps/engine/src/services/externalIntelligenceService.js';

// Synthetic boundary set. Model calls are local inference only; no exchange adapter is constructed.
const settings=JSON.parse(await readFile('config/settings.default.json','utf8'));
const resource=settings.aiResources.find((r:any)=>r.role==='SCOUT'&&r.enabled),client=new OpenAiCompatibleClient(),cases:any[]=[];
const types=['UP','DOWN','RANGE','NEGATION','CONFLICT','EMPTY','STALE'];
for(let i=0;i<Number(process.env.V390_RESEARCH_CASES??60);i++){
  const category=types[i%types.length]!,now=Date.now(),at=now-60000-i*1000;
  const facts:Record<string,string|number|boolean|null>=category==='EMPTY'?{}:category==='NEGATION'?{notice:'The source does not confirm approval; no policy change was announced.'}:category==='CONFLICT'?{sourceA:'reported increase',sourceB:'reported no change'}:{return15m:category==='DOWN'?-.012:category==='UP'?.015:0,close:50000+i};
  const source:ExternalIntelligenceSnapshot={id:`isolated-${i}`,provider:'ALPACA',instrument:'BTC/USD',venue:'ISOLATED_FIXTURE',sourceId:`isolated-quality-${i}`,url:`local://isolated-fixture/${i}`,eventAt:at,publishedAt:at,receivedAt:at,availableAt:at,expiresAt:category==='STALE'?now-1:now+300000,closedBar:true,facts,sourceConflicts:category==='CONFLICT'?['sourceA and sourceB disagree']:[],quality:'AUTHENTICATED_MARKET_DATA',revision:String(i),contentHash:String(i).padStart(64,'0')};
  if(category==='STALE'){
    const checked=verifyExternalResearch(source,{sourceId:source.sourceId,entities:[],facts:[],conflicts:[]},now);
    cases.push({category,source,status:'GATED_BEFORE_MODEL',passed:!checked.passed&&checked.result.facts.length===0});continue;
  }
  try{
    const start=Date.now(),response=await client.runJson({baseUrl:resource.baseUrl,model:resource.model,prompt:buildExternalResearchPrompt(source),schemaName:'ExternalResearchFacts',jsonSchema:externalResearchJsonSchema(source),timeoutMs:60000,maxOutputTokens:512,parse:v=>parseExternalResearch(materializeExternalResearch(source,v),source.sourceId)});
    const check=verifyExternalResearch(source,response.value,Date.now());
    const complete=category==='EMPTY'?check.result.facts.length===0:check.result.facts.length>0;
    const conflictCorrect=category!=='CONFLICT'||check.result.conflicts.includes(source.sourceConflicts![0]!);
    cases.push({category,source,status:'MODEL_COMPLETED',raw:response.raw,accepted:check.result,issues:check.issues,latencyMs:Date.now()-start,passed:check.passed&&complete&&conflictCorrect});
  }catch(error){cases.push({category,source,status:'MODEL_FAILED',error:String(error),passed:false});}
  if((i+1)%10===0)console.log(JSON.stringify({completed:i+1,failures:cases.filter(x=>!x.passed).length}));
}
const report={generatedAt:new Date().toISOString(),source:'SYNTHETIC_BOUNDARY_FIXTURES_NOT_MARKET_PROFITABILITY',model:resource.model,exchangeWrites:0,summary:{cases:cases.length,modelCalls:cases.filter(c=>c.status.startsWith('MODEL')).length,passed:cases.filter(c=>c.passed).length,failed:cases.filter(c=>!c.passed).length},cases};
await writeFile(process.env.V390_RESEARCH_OUTPUT??'docs/reports/v390-research-quality-raw.json',JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify(report.summary));
if(report.summary.failed)process.exitCode=1;
