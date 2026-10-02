import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RELEASE_VERSION } from '@zdj/contracts';

const execFileAsync=promisify(execFile);

export type RuntimeIdentity = {
  instanceId:string;
  pid:number;
  startedAt:number;
  host:string;
  port:number;
  version:string;
  buildId:string;
  gitCommit:string|null;
  gitWorktreeState:'CLEAN'|'DIRTY'|'UNAVAILABLE';
  sourceHash?:string;
  artifactHash?:string;
  settingsVersion?:number|null;
  settingsHash?:string|null;
  databaseEpoch:string;
  startReason:string;
  lanIps:string[];
  restartCount:number;
};

export function currentLanIps(){
  return [...new Set(Object.values(os.networkInterfaces()).flatMap(items=>(items??[]).filter(item=>item.family==='IPv4'&&!item.internal&&!item.address.startsWith('169.254.')).map(item=>item.address)))].sort();
}

export async function contentTreeHash(root:string,folders:string[]){const hash=createHash('sha256');async function visit(relative:string){let entries;try{entries=await readdir(path.join(root,relative),{withFileTypes:true});}catch{return;}for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(relative,entry.name);if(entry.isDirectory())await visit(file);else{hash.update(file.replaceAll('\\','/'));hash.update(await readFile(path.join(root,file)));}}}for(const folder of folders)await visit(folder);return hash.digest('hex');}

const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
export const stableValueHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

async function gitCommit(root:string):Promise<string|null>{
  const explicit=process.env.ZDJ_GIT_COMMIT??process.env.GITHUB_SHA??process.env.CI_COMMIT_SHA;
  if(explicit&&/^[0-9a-f]{7,64}$/i.test(explicit))return explicit.toLowerCase();
  try{
    let gitDir=path.join(root,'.git');
    const dotGit=await readFile(gitDir,'utf8').catch(()=>null);
    if(dotGit?.startsWith('gitdir:'))gitDir=path.resolve(root,dotGit.slice('gitdir:'.length).trim());
    const head=(await readFile(path.join(gitDir,'HEAD'),'utf8')).trim();
    if(/^[0-9a-f]{40,64}$/i.test(head))return head.toLowerCase();
    if(!head.startsWith('ref:'))return null;
    const ref=head.slice(4).trim();
    const direct=await readFile(path.join(gitDir,ref),'utf8').catch(()=>null);
    if(direct&&/^[0-9a-f]{40,64}$/i.test(direct.trim()))return direct.trim().toLowerCase();
    const commonText=await readFile(path.join(gitDir,'commondir'),'utf8').catch(()=>null);
    const commonDir=commonText?path.resolve(gitDir,commonText.trim()):gitDir;
    const commonRef=await readFile(path.join(commonDir,ref),'utf8').catch(()=>null);
    if(commonRef&&/^[0-9a-f]{40,64}$/i.test(commonRef.trim()))return commonRef.trim().toLowerCase();
    const packed=await readFile(path.join(commonDir,'packed-refs'),'utf8').catch(()=>null);
    const row=packed?.split(/\r?\n/).find(line=>line.endsWith(` ${ref}`));
    const packedHash=row?.split(' ')[0];
    return packedHash&&/^[0-9a-f]{40,64}$/i.test(packedHash)?packedHash.toLowerCase():null;
  }catch{return null;}
}

async function gitWorktreeState(root:string):Promise<RuntimeIdentity['gitWorktreeState']>{
  try{
    const {stdout}=await execFileAsync('git',['-C',root,'status','--porcelain=v1','--untracked-files=all','--',
      'apps/engine/src','apps/dashboard/src','packages/core/src','packages/contracts/src','config','package.json','package-lock.json','tsconfig.base.json'],
      {timeout:5_000,maxBuffer:1024*1024});
    return String(stdout).trim()?'DIRTY':'CLEAN';
  }catch{return'UNAVAILABLE';}
}

/** A known dirty source overlay may be inspected read-only, but it cannot own TESTNET orders. */
export function runtimeIdentityExecutionRefusal(identity:Pick<RuntimeIdentity,'gitWorktreeState'>,executionMode:string){
  return executionMode==='TESTNET_ENABLED'&&identity.gitWorktreeState==='DIRTY'
    ?'DIRTY_SOURCE_OVERLAY_EXECUTION_REFUSED'
    :null;
}

async function databaseEpoch(runtimeDir:string){
  const epochPath=path.join(runtimeDir,'database-epoch.json');
  try{const value=JSON.parse(await readFile(epochPath,'utf8'));if(typeof value?.databaseEpoch==='string'&&value.databaseEpoch)return value.databaseEpoch as string;}catch{}
  const value={databaseEpoch:randomUUID(),createdAt:Date.now()};
  await writeFile(epochPath,JSON.stringify(value,null,2),'utf8');
  return value.databaseEpoch;
}

export async function persistRuntimeIdentity(identityPath:string,identity:RuntimeIdentity,settings:unknown){
  const settingsVersion=Number((settings as any)?.settingsVersion);
  const finalized:RuntimeIdentity={...identity,settingsVersion:Number.isFinite(settingsVersion)?settingsVersion:null,settingsHash:stableValueHash(settings)};
  await writeFile(identityPath,JSON.stringify(finalized,null,2),'utf8');
  return finalized;
}

export async function createRuntimeIdentity(dataDir:string,host:string,port:number,version:string=RELEASE_VERSION){
  const runtimeDir=path.join(dataDir,'runtime');await mkdir(runtimeDir,{recursive:true});
  const identityPath=path.join(runtimeDir,'engine-instance.json');let previous:any=null;try{previous=JSON.parse(await readFile(identityPath,'utf8'));}catch{}
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..'),artifactHash=await contentTreeHash(root,['apps/engine/dist','packages/core/dist','packages/contracts/dist','apps/dashboard/dist']),sourceHash=await contentTreeHash(root,['apps/engine/src','packages/core/src','packages/contracts/src','apps/dashboard/src']);
  const identity:RuntimeIdentity={instanceId:randomUUID(),pid:process.pid,startedAt:Date.now(),host,port,version,buildId:`${version}-${artifactHash.slice(0,20)}`,gitCommit:await gitCommit(root),gitWorktreeState:await gitWorktreeState(root),artifactHash,sourceHash,settingsVersion:null,settingsHash:null,databaseEpoch:await databaseEpoch(runtimeDir),startReason:process.env.ZDJ_START_REASON??'UNKNOWN',lanIps:currentLanIps(),restartCount:Number(previous?.restartCount??0)+1};
  await writeFile(identityPath,JSON.stringify(identity,null,2),'utf8');
  return{identity,identityPath,previous};
}
