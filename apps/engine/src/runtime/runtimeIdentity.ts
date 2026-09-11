import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { RELEASE_VERSION } from '@zdj/contracts';

export type RuntimeIdentity = {
  instanceId:string;
  pid:number;
  startedAt:number;
  host:string;
  port:number;
  version:string;
  buildId:string;
  sourceHash?:string;
  artifactHash?:string;
  startReason:string;
  lanIps:string[];
  restartCount:number;
};

export function currentLanIps(){
  return [...new Set(Object.values(os.networkInterfaces()).flatMap(items=>(items??[]).filter(item=>item.family==='IPv4'&&!item.internal&&!item.address.startsWith('169.254.')).map(item=>item.address)))].sort();
}

export async function contentTreeHash(root:string,folders:string[]){const hash=createHash('sha256');async function visit(relative:string){let entries;try{entries=await readdir(path.join(root,relative),{withFileTypes:true});}catch{return;}for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(relative,entry.name);if(entry.isDirectory())await visit(file);else{hash.update(file.replaceAll('\\','/'));hash.update(await readFile(path.join(root,file)));}}}for(const folder of folders)await visit(folder);return hash.digest('hex');}

export async function createRuntimeIdentity(dataDir:string,host:string,port:number,version=RELEASE_VERSION){
  const runtimeDir=path.join(dataDir,'runtime');await mkdir(runtimeDir,{recursive:true});
  const identityPath=path.join(runtimeDir,'engine-instance.json');let previous:any=null;try{previous=JSON.parse(await readFile(identityPath,'utf8'));}catch{}
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..'),artifactHash=await contentTreeHash(root,['apps/engine/dist','packages/core/dist','packages/contracts/dist','apps/dashboard/dist']),sourceHash=await contentTreeHash(root,['apps/engine/src','packages/core/src','packages/contracts/src','apps/dashboard/src']);
  const identity:RuntimeIdentity={instanceId:randomUUID(),pid:process.pid,startedAt:Date.now(),host,port,version,buildId:`${version}-${artifactHash.slice(0,20)}`,artifactHash,sourceHash,startReason:process.env.ZDJ_START_REASON??'UNKNOWN',lanIps:currentLanIps(),restartCount:Number(previous?.restartCount??0)+1};
  await writeFile(identityPath,JSON.stringify(identity,null,2),'utf8');
  return{identity,identityPath,previous};
}
