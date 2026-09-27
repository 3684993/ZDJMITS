import {createHash} from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=process.cwd(),out=path.join(root,'docs/reports/v396-local-main-sync-cleanup-restart-20260928');
const SOURCE=['apps/engine/src','packages/core/src','packages/contracts/src','apps/dashboard/src'],ARTIFACT=['apps/engine/dist','packages/core/dist','packages/contracts/dist','apps/dashboard/dist'];
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
async function tree(base,folders){const h=createHash('sha256'),files=[];async function visit(rel){for(const e of (await fs.readdir(path.join(base,rel),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(rel,e.name);if(e.isDirectory())await visit(p);else{const b=await fs.readFile(path.join(base,p)),name=p.replaceAll('\\','/');h.update(name);h.update(b);files.push({path:name,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}}}for(const f of folders)await visit(f);return{hash:h.digest('hex'),fileCount:files.length,files};}
const source=await tree(root,SOURCE),artifact=await tree(root,ARTIFACT);
const receipt=JSON.parse(await fs.readFile('data/runtime/engine-instance.json','utf8'));
const file=process.argv[2]==='after'?'source-build-runtime-identity.json':'build-identity.json';
let result={capturedAt:new Date().toISOString(),canonicalRoot:root,gitSha:git('rev-parse','HEAD'),originMain:git('rev-parse','origin/main'),branch:git('branch','--show-current'),source,artifact,buildId:'3.9.6-'+artifact.hash.slice(0,20),runtimeReceipt:receipt,algorithm:'SHA256 path + raw file bytes in runtimeIdentity folder/traversal order'};
if(process.argv[2]==='after'){
 const before=JSON.parse(await fs.readFile(path.join(out,'build-identity.json'),'utf8'));
 const runtime=(await(await fetch('http://127.0.0.1:8080/api/v3/diagnostics/closeout')).json()).runtime;
 result.checks={mainEqualsOrigin:result.branch==='main'&&result.gitSha===result.originMain,sourceMatchesBuiltManifest:source.hash===before.source.hash,artifactMatchesBuiltManifest:artifact.hash===before.artifact.hash,runtimeSourceMatches:receipt.sourceHash===source.hash,runtimeArtifactMatches:receipt.artifactHash===artifact.hash,runtimeBuildMatches:receipt.buildId===result.buildId,runtimeApiMatches:runtime.pid===receipt.pid&&runtime.instanceId===receipt.instanceId&&runtime.buildId===receipt.buildId,manualStart:runtime.lastRestartReason==='MANUAL_START',canonicalData:path.resolve(runtime.runtimeDataDir).toLowerCase()===path.join(root,'data').toLowerCase(),sourceClean:git('status','--porcelain','--',...SOURCE)===''};
 result.verdict=Object.values(result.checks).every(Boolean)?'IDENTITY_CLOSED':'IDENTITY_BROKEN';
}else{
 const rollback='D:/MITS/backups/rollback-fa4fbc8660ef12849644';const rs=await tree(rollback,SOURCE),ra=await tree(rollback,ARTIFACT);result.rollback={path:rollback,sourceHash:rs.hash,artifactHash:ra.hash,matchesRunning:rs.hash===receipt.sourceHash&&ra.hash===receipt.artifactHash};if(!result.rollback.matchesRunning)throw Error('ROLLBACK_IDENTITY_MISMATCH');
}
await fs.writeFile(path.join(out,file),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({file,sourceHash:source.hash,artifactHash:artifact.hash,buildId:result.buildId,verdict:result.verdict,checks:result.checks,rollback:result.rollback},null,2));if(result.verdict==='IDENTITY_BROKEN')process.exitCode=1;
