#!/usr/bin/env node
import {readdirSync,statSync,rmSync} from 'node:fs';
import path from 'node:path';
const argv=process.argv.slice(2),apply=argv.includes('--apply'),dir=path.resolve(argv.find(x=>x.startsWith('--dir='))?.slice(6)??'data/backups'),keep=Math.max(1,Number(argv.find(x=>x.startsWith('--keep='))?.slice(7)??2)),maxAgeDays=Math.max(1,Number(argv.find(x=>x.startsWith('--max-age-days='))?.slice(15)??14)),maxTotalGb=Math.max(1,Number(argv.find(x=>x.startsWith('--max-total-gb='))?.slice(15)??8)),now=Date.now();
const files=readdirSync(dir).map(name=>{const file=path.join(dir,name),s=statSync(file);return{file,name,size:s.size,mtimeMs:s.mtimeMs};}).filter(x=>x.name.endsWith('.sqlite')||x.name.endsWith('.sqlite-wal')||x.name.endsWith('.sqlite-shm'));
const roots=new Map();for(const f of files){const root=f.name.replace(/\.sqlite(?:-wal|-shm)?$/,'.sqlite');const g=roots.get(root)??{root,files:[],size:0,mtimeMs:0};g.files.push(f);g.size+=f.size;g.mtimeMs=Math.max(g.mtimeMs,f.mtimeMs);roots.set(root,g);}
const groups=[...roots.values()].sort((a,b)=>b.mtimeMs-a.mtimeMs),protectedRoots=new Set(groups.slice(0,keep).map(g=>g.root));let total=groups.reduce((n,g)=>n+g.size,0),planned=[];
for(const g of [...groups].reverse()){if(protectedRoots.has(g.root))continue;const tooOld=now-g.mtimeMs>maxAgeDays*86_400_000,tooLarge=total>maxTotalGb*1024**3;if(!tooOld&&!tooLarge)continue;planned.push({...g,reason:tooOld?'AGE_LIMIT':'TOTAL_BYTES_LIMIT'});total-=g.size;}
console.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',dir,keep,maxAgeDays,maxTotalGb,beforeBytes:groups.reduce((n,g)=>n+g.size,0),afterBytes:total,protected:[...protectedRoots],delete:planned.map(g=>({root:g.root,size:g.size,reason:g.reason,files:g.files.map(f=>f.name)}))},null,2));
if(apply){if(!argv.includes('--verified-recovery-point'))throw new Error('REFUSING_DELETE_WITHOUT_VERIFIED_RECOVERY_POINT');for(const g of planned)for(const f of g.files)rmSync(f.file,{force:true});}
