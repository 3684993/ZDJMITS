// Bounded local GET diagnostics. Never sends an order, lifecycle call or Settings write.
import {writeFileSync} from 'node:fs';
const label=process.argv[2]??'post-load';
if(!/^[a-z0-9-]+$/.test(label))throw Error('INVALID_EVIDENCE_LABEL');
const out='docs/reports/v398-entry-sizing-quality-review/evidence-20261008';
const forbidden=new Set(['apiKey','apiSecret','password','access_token','refresh_token','privateKey','ciphertext','cookie','authorization','accountId','accountAlias','inputPreview','outputPreview','systemPrompt','prompt']);
function safe(value){if(Array.isArray(value))return value.map(safe);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!forbidden.has(key)).map(([key,v])=>[key,safe(v)]));return value;}
const results=await Promise.all(['/health','/api/v3/diagnostics/closeout'].map(async endpoint=>{
 try{const response=await fetch(`http://127.0.0.1:8080${endpoint}`,{signal:AbortSignal.timeout(15000)});return{endpoint,httpStatus:response.status,data:safe(await response.json())};}
 catch(error){return{endpoint,status:'UNAVAILABLE',errorType:error.name};}
}));
const result={observedAt:new Date().toISOString(),methods:['GET'],taskManualExchangeWrites:0,results};
writeFileSync(`${out}/runtime-${label}.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({observedAt:result.observedAt,endpoints:results.map(r=>({endpoint:r.endpoint,http:r.httpStatus,status:r.data?.status??r.status,ready:r.data?.ready,pid:r.data?.pid,version:r.data?.version,keys:r.data?Object.keys(r.data):[]}))}));
