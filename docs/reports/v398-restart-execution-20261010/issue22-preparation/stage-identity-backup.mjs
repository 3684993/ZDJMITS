import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync,backup} from 'node:sqlite';
const stage='D:/MITS-RELEASES/ZDJMITS-v398-main-6f228cd';
const old='D:/MITS-RELEASES/ZDJMITS-v398-ai-entry-cb0de7b';
const evidence=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'));
const privateDir=path.join(process.env.LOCALAPPDATA,'ZDJMITS/diagnostics/issue22-staged-6f228cd-20261010');
await fs.mkdir(privateDir,{recursive:true});
const SOURCE=['apps/engine/src','packages/core/src','packages/contracts/src','apps/dashboard/src'];
const ARTIFACT=['apps/engine/dist','packages/core/dist','packages/contracts/dist','apps/dashboard/dist'];
const {contentTreeHash}=await import(pathToFileURL(path.join(stage,'apps/engine/dist/runtime/runtimeIdentity.js')));
const {entryStartupPolicy}=await import(pathToFileURL(path.join(stage,'apps/engine/dist/services/entryStartupPolicy.js')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:stage,encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain'],{cwd:stage,encoding:'utf8'}).trim();
if(head!=='6f228cd90f9146405761f3221b70096f7ca85ed5'||dirty)throw Error('FROZEN_SOURCE_NOT_CLEAN_EXACT_MAIN');
const sourceHash=await contentTreeHash(stage,SOURCE),artifactHash=await contentTreeHash(stage,ARTIFACT);
const prior=JSON.parse(await fs.readFile(path.join(evidence,'../../v398-controlled-release-24h-20261010/identity-preflight.json'),'utf8'));
if(artifactHash!==prior.candidate.artifactHash)throw Error('INDEPENDENT_REBUILD_ARTIFACT_MISMATCH');
const eolDifferencePaths=[];
const baseline=path.resolve(evidence,'../../../..');
async function compareSource(rel){
  const entries=(await fs.readdir(path.join(stage,rel),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
  const reference=await fs.readdir(path.join(baseline,rel));
  if(entries.map(e=>e.name).sort().join('\n')!==reference.sort().join('\n'))throw Error('SOURCE_FILE_SET_MISMATCH:'+rel);
  for(const e of entries){const p=path.join(rel,e.name);if(e.isDirectory())await compareSource(p);else{const [a,b]=await Promise.all([fs.readFile(path.join(stage,p)),fs.readFile(path.join(baseline,p))]);if(!a.equals(b)){if(a.toString('utf8').replace(/\r\n/g,'\n')!==b.toString('utf8').replace(/\r\n/g,'\n'))throw Error('SOURCE_CONTENT_MISMATCH:'+p);eolDifferencePaths.push(p.replaceAll('\\','/'));}}}
}
for(const f of SOURCE)await compareSource(f);
const files={};
async function collect(rel){for(const e of (await fs.readdir(path.join(stage,rel),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(rel,e.name);if(e.isDirectory())await collect(p);else files[p.replaceAll('\\','/')]=sha(await fs.readFile(path.join(stage,p)));}}
for(const f of [...SOURCE,...ARTIFACT])await collect(f);
for(const f of ['package.json','package-lock.json','config/settings.default.json','scripts/start-zdj-engine-host.ps1','scripts/start-zdj-stack-after-reboot.ps1'])files[f]=sha(await fs.readFile(path.join(stage,f)));
const db=new DatabaseSync('D:/MITS/data/zdj-settings.sqlite',{readOnly:true});db.exec('PRAGMA query_only=ON');
const row=db.prepare('SELECT version,payload FROM settings WHERE id=1').get();const settings=JSON.parse(row.payload);
if(settings.connections.exchange.environment!=='TESTNET'||settings.connections.executionMode!=='TESTNET_ENABLED')throw Error('TESTNET_REQUIRED');
const oldApproval=JSON.parse(await fs.readFile(path.join(process.env.LOCALAPPDATA,'ZDJMITS/entry-authorization/v398-testnet-entry.json'),'utf8'));
const instance=JSON.parse(await fs.readFile('D:/MITS/data/runtime/engine-instance.json','utf8'));
if(await contentTreeHash(old,SOURCE)!==instance.sourceHash||await contentTreeHash(old,ARTIFACT)!==instance.artifactHash)throw Error('ROLLBACK_BINARY_IDENTITY_MISMATCH');
const approval={version:1,mode:'TESTNET_ENTRY_ENABLED',operatorApproval:'ONE_TESTNET_ENGINE_SWITCH',revoked:true,settingsVersion:row.version,dataRoot:'D:\\MITS\\data',sourceSha256:sourceHash,artifactSha256:artifactHash,entrypointSha256:files['apps/engine/dist/main.js'],approvedAt:Date.now(),expiresAt:Date.now()+48*60*60*1000,approvalUrl:'https://github.com/3684993/ZDJMITS/issues/22',renewalPolicy:'OPERATOR_EXPLICIT_EXACT_BUILD_AND_SETTINGS',accountScopeHash:oldApproval.accountScopeHash,preparationState:'BUSINESS_APPROVED_IDENTITY_PREPARED_NOT_ACTIVATED_ELIGIBILITY_UNKNOWN'};
const approvalPath=path.join(privateDir,'new-entry-approval.prepared.json');await fs.writeFile(approvalPath,JSON.stringify(approval,null,2));
const env={ZDJ_ENTRY_EXECUTION_POLICY:'TESTNET_ENTRY_ENABLED',ZDJ_ENTRY_ADMISSION_DISABLED:'0',ZDJ_ENTRY_APPROVAL_FILE:approvalPath,ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256:artifactHash,ZDJ_DATA_DIR:'D:\\MITS\\data'};
const inactive=entryStartupPolicy(settings,env,Date.now(),{sourceHash,artifactHash});
if(inactive.orderAuthorization!==false)throw Error('PREPARED_APPROVAL_MUST_REMAIN_INACTIVE');
const backupPath=path.join(privateDir,'before-release.sqlite');
try{await fs.access(backupPath);throw Error('BACKUP_ALREADY_EXISTS_REFUSE_OVERWRITE');}catch(e){if(e.code!=='ENOENT')throw e;}
const began=Date.now();await backup(db,backupPath);db.close();
const check=new DatabaseSync(backupPath,{readOnly:true});check.exec('PRAGMA query_only=ON');
const integrity=check.prepare('PRAGMA quick_check').all();const saved=check.prepare('SELECT version,payload FROM settings WHERE id=1').get();check.close();
if(integrity.some(r=>Object.values(r)[0]!=='ok')||saved.version!==row.version||saved.payload!==row.payload)throw Error('BACKUP_VALIDATION_FAILED');
const result={observedAt:new Date().toISOString(),verdict:'STAGED_READY_NO_GO_ELIGIBILITY_UNKNOWN',stagePath:stage,frozenGitHead:head,cleanSource:true,independentRebuildArtifactMatchesPrior:true,sourceLfNormalizedMatchesPrior:true,previousCandidateSourceHash:prior.candidate.sourceHash,eolDifferencePaths,buildId:`3.9.8-${artifactHash.slice(0,20)}`,sourceHash,artifactHash,entrypointSha256:files['apps/engine/dist/main.js'],lockSha256:files['package-lock.json'],settings:{version:row.version,payloadSha256:sha(row.payload),environment:'TESTNET',executionMode:'TESTNET_ENABLED'},approval:{privatePath:approvalPath,sha256:sha(await fs.readFile(approvalPath)),state:approval.preparationState,revoked:true,inactivePolicy:inactive,expiresAt:approval.expiresAt},backup:{privatePath:backupPath,bytes:(await fs.stat(backupPath)).size,sha256:sha(await fs.readFile(backupPath)),elapsedMs:Date.now()-began,quickCheck:'ok',settingsMatches:true},rollback:{stagePath:old,pid:instance.pid,buildId:instance.buildId,sourceHash:instance.sourceHash,artifactHash:instance.artifactHash,oldApprovalUnmodified:true,useCurrentDurableDb:true,automaticStaleDbRestore:false},taskLifecycleChanges:0,taskSettingsWrites:0,taskExchangeWrites:0,files};
await fs.writeFile(path.join(evidence,'staged-release.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,files:Object.keys(files).length}));
