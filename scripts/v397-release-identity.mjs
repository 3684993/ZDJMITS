#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(path.join(root,file),'utf8');
const json=file=>JSON.parse(read(file));
const version='3.9.7';
const files=['package.json','packages/contracts/package.json','packages/core/package.json','apps/engine/package.json','apps/dashboard/package.json'];
const lock=json('package-lock.json');
for(const file of files){
  const pkg=json(file),key=file==='package.json'?'':file.replace(/\/package\.json$/,'');
  if(pkg.version!==version||lock.packages[key]?.version!==version)throw new Error(`RELEASE_IDENTITY_MISMATCH:${file}`);
  for(const [name,value] of Object.entries(pkg.dependencies??{}))
    if(name.startsWith('@zdj/')&&value!==version)throw new Error(`WORKSPACE_DEPENDENCY_MISMATCH:${file}:${name}:${value}`);
}
if(lock.version!==version||!read('packages/contracts/src/version.ts').includes(`RELEASE_VERSION = "${version}"`)||
  !read('packages/contracts/src/version.ts').includes('API_VERSION = "V3.9.7"'))throw new Error('RELEASE_CONTRACT_IDENTITY_MISMATCH');
if(!read('apps/dashboard/src/layouts/AppShell.vue').includes('RELEASE_LABEL'))throw new Error('DASHBOARD_RELEASE_LABEL_UNWIRED');
console.log(JSON.stringify({gate:'V397_RELEASE_IDENTITY_PASS',version,packages:files.length,lock:true,api:'V3.9.7'}));
