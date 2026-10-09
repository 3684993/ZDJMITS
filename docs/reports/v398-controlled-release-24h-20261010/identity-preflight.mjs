// Read-only current/candidate identity evidence. Does not create approval or deploy.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const candidate = process.cwd();
const deployed = 'D:/MITS-RELEASES/ZDJMITS-v398-ai-entry-cb0de7b';
const sources = ['apps/engine/src','packages/core/src','packages/contracts/src','apps/dashboard/src'];
const artifacts = ['apps/engine/dist','packages/core/dist','packages/contracts/dist','apps/dashboard/dist'];
async function tree(root, folders) {
  const h = createHash('sha256');
  async function visit(relative) {
    const entries = await fs.readdir(path.join(root, relative), {withFileTypes:true});
    for (const e of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
      const file = path.join(relative,e.name);
      if(e.isDirectory()) await visit(file);
      else {h.update(file.replaceAll('\\','/'));h.update(await fs.readFile(path.join(root,file)));}
    }
  }
  for(const f of folders) await visit(f);
  return h.digest('hex');
}
const hashFile = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const instance = JSON.parse(await fs.readFile('D:/MITS/data/runtime/engine-instance.json','utf8'));
const receiptPath = path.join(process.env.LOCALAPPDATA,'ZDJMITS/diagnostics/testnet-entry-cutover-20261009/new-engine-receipt.json');
const receipt = JSON.parse(await fs.readFile(receiptPath,'utf8'));
const [sourceHash,artifactHash,deployedSourceHash,deployedArtifactHash,entrypointSha256] = await Promise.all([tree(candidate,sources),tree(candidate,artifacts),tree(deployed,sources),tree(deployed,artifacts),hashFile(path.join(candidate,'apps/engine/dist/main.js'))]);
const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite',{readOnly:true});
db.exec('PRAGMA query_only=ON');
const row=db.prepare('SELECT version,payload FROM settings WHERE id=1').get();
const settings=JSON.parse(row.payload);db.close();
const result={observedAt:new Date().toISOString(),candidate:{gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHash,artifactHash,buildId:`3.9.8-${artifactHash.slice(0,20)}`,entrypointSha256},runtime:{pid:instance.pid,instanceId:instance.instanceId,buildId:instance.buildId,sourceHash:instance.sourceHash,artifactHash:instance.artifactHash,entrypoint:receipt.enginePath,hostPid:receipt.hostPid,launchId:receipt.launchId},settings:{version:row.version,payloadSha256:createHash('sha256').update(row.payload).digest('hex'),environment:settings.connections.exchange.environment,executionMode:settings.connections.executionMode},checks:{actualReceiptMatchesInstance:receipt.pid===instance.pid,deployedSourceMatchesInstance:deployedSourceHash===instance.sourceHash,deployedArtifactMatchesInstance:deployedArtifactHash===instance.artifactHash,candidateSourceMatchesInstance:sourceHash===instance.sourceHash,candidateArtifactMatchesInstance:artifactHash===instance.artifactHash},taskSettingsWrites:0,taskExchangeWrites:0,taskLifecycleChanges:0,verdict:'CANDIDATE_NOT_DEPLOYED'};
await fs.writeFile(new URL('./identity-preflight.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
