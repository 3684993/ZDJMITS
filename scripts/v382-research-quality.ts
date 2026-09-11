import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {OpenAiCompatibleClient} from '../apps/engine/src/adapters/ai/OpenAiCompatibleClient.js';
import {parseExternalResearch} from '../apps/engine/src/services/aiFabric.js';
import {buildExternalResearchPrompt,externalResearchJsonSchema,verifyExternalResearch} from '../apps/engine/src/services/externalResearchQuality.js';
import type {ExternalIntelligenceSnapshot} from '../apps/engine/src/services/externalIntelligenceService.js';

const raw=JSON.parse(await readFile(path.resolve('config/settings.default.json'),'utf8'));
const resource=raw.aiResources.find((x:any)=>x.role==='SCOUT'&&x.enabled);
if(!resource)throw new Error('9B resource not configured');
const snapshots:Array<ExternalIntelligenceSnapshot>=Array.from({length:20},(_,index)=>{
  const at=Date.UTC(2026,8,1,0,index),alpaca=index%2===0;
  return{id:`quality-${index}`,provider:alpaca?'ALPACA':'FEDERAL_RESERVE',instrument:alpaca?'BTC/USD':'USD_MACRO',venue:alpaca?'ALPACA_CRYPTO_SPOT':'FEDERAL_RESERVE_OFFICIAL_RSS',sourceId:`v382-quality-${index}`,url:`https://quality.invalid/${index}`,eventAt:at,publishedAt:at,receivedAt:at+1000,availableAt:at+1000,expiresAt:at+3600000,closedBar:alpaca?true:null,facts:alpaca?{open:60000+index,close:60010+index,return15m:0.000166}:{title:`Federal Reserve release ${index}`,summary:`Official statement ${index}: the target range is unchanged.`},quality:alpaca?'AUTHENTICATED_MARKET_DATA':'OFFICIAL',revision:`quality-r${index}`,contentHash:index.toString(16).padStart(64,'0')};
});
const client=new OpenAiCompatibleClient(),cases:any[]=[];
for(const source of snapshots){
  const startedAt=Date.now();
  try{
    const response=await client.runJson({baseUrl:resource.baseUrl,model:resource.model,prompt:buildExternalResearchPrompt(source),schemaName:'V382ExternalResearchQuality',jsonSchema:externalResearchJsonSchema(source),timeoutMs:120000,maxOutputTokens:900,parse:value=>parseExternalResearch(value,source.sourceId)}),quality=verifyExternalResearch(source,response.value);
    cases.push({source,raw:response.raw,parsed:response.value,accepted:quality.result,issues:quality.issues,rejectedFactCount:quality.rejectedFactCount,latencyMs:Date.now()-startedAt,status:'COMPLETED'});
  }catch(error){cases.push({source,status:'FAILED',error:error instanceof Error?error.message:String(error),latencyMs:Date.now()-startedAt});}
}
const allIssues=cases.flatMap(x=>x.issues??[]),summary={total:cases.length,completed:cases.filter(x=>x.status==='COMPLETED').length,failed:cases.filter(x=>x.status==='FAILED').length,acceptedFacts:cases.reduce((n,x)=>n+(x.accepted?.facts?.length??0),0),rejectedFacts:cases.reduce((n,x)=>n+(x.rejectedFactCount??0),0),numericErrors:allIssues.filter((x:any)=>x.code==='VALUE').length,unitErrors:allIssues.filter((x:any)=>x.code==='UNIT').length,timeErrors:allIssues.filter((x:any)=>x.code==='TIME').length,evidenceErrors:allIssues.filter((x:any)=>x.code==='EVIDENCE'||x.code==='FIELD').length,tradingPermissionErrors:allIssues.filter((x:any)=>x.code==='PERMISSION').length};
const report={version:'3.8.2',generatedAt:new Date().toISOString(),resource:{id:resource.id,model:resource.model,baseUrl:resource.baseUrl},isolated:true,exchangeWrites:false,summary,passed:summary.completed===20&&summary.failed===0&&summary.rejectedFacts===0&&summary.numericErrors===0&&summary.unitErrors===0&&summary.timeErrors===0&&summary.evidenceErrors===0&&summary.tradingPermissionErrors===0,cases};
const output=path.resolve(process.argv[2]??'docs/reports/v382-9b-quality-raw.json');await writeFile(output,JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify({output,passed:report.passed,summary},null,2));if(!report.passed)process.exitCode=1;
