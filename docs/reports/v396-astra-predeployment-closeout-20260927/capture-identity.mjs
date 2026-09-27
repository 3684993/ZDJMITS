import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(cwd,args)=>{const r=spawnSync('git',['--no-optional-locks',...args],{cwd,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trimEnd();};
const sourceFolders=['apps/engine/src','packages/core/src','packages/contracts/src','apps/dashboard/src'];
const artifactFolders=['apps/engine/dist','packages/core/dist','packages/contracts/dist','apps/dashboard/dist'];
// Identical byte/path order to runtimeIdentity.contentTreeHash; no imports that create an Engine instance.
async function tree(base,folders,includeFiles=true){const hash=createHash('sha256'),files=[];async function visit(relative){let entries;try{entries=await readdir(path.join(base,relative),{withFileTypes:true});}catch{return;}
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){const name=path.join(relative,entry.name);if(entry.isDirectory())await visit(name);else {const bytes=await readFile(path.join(base,name)),file=name.replaceAll('\\','/');hash.update(file);hash.update(bytes);files.push({path:file,bytes:bytes.length,sha256:sha(bytes)});}}}
 for(const folder of folders)await visit(folder);return {algorithm:'runtimeIdentity.contentTreeHash SHA256(path UTF8 + raw bytes), ordered folders then localeCompare recursive traversal',hash:hash.digest('hex'),fileCount:files.length,...(includeFiles?{files}:{})};}
const runtime=JSON.parse((await readFile(path.join(out,'runtime-before.json'),'utf8')).replace(/^\uFEFF/,''));
const source=await tree(root,sourceFolders),artifact=await tree(root,artifactFolders),rollbackArtifact=await tree(runtime.process.artifactRoot,artifactFolders,false),rollbackSource=await tree(runtime.process.artifactRoot,sourceFolders,false);
const diff=git(root,['diff','--binary','HEAD','--','apps','packages']).replaceAll('\r\n','\n')+'\n';
const rawDiff=spawnSync('git',['diff','--binary','HEAD','--','apps','packages'],{cwd:root,encoding:'utf8'}).stdout.replaceAll('\r\n','\n');
const manifest={schema:'V396_ASTRA_SOURCE_BUILD_MANIFEST_1',capturedAt:new Date().toISOString(),baseCommit:git(root,['rev-parse','HEAD']),branch:git(root,['branch','--show-current']),sourceDiffSha256:sha(rawDiff),candidateBuildId:`3.9.6-${artifact.hash.slice(0,20)}`,source,artifact,
 rollback:{artifactRoot:runtime.process.artifactRoot,loadedReceipt:runtime.receipt,artifact:rollbackArtifact,source:rollbackSource,onDiskArtifactMatchesLoadedReceipt:rollbackArtifact.hash===runtime.receipt.artifactHash,onDiskSourceMatchesLoadedReceipt:rollbackSource.hash===runtime.receipt.sourceHash},
 scope:'Source includes test sources as runtimeIdentity does; raw hashes are byte-sensitive including CRLF. Candidate artifacts built locally only. No artifact copied to runtime.',sourceCommitResolution:'Containing Git commit identifies these source bytes. Manifest excluded from recursive hashing.'};
await writeFile(path.join(out,'source-build-identity.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(out,'corrective-source.diff.txt'),diff);
const status=git('D:/MITS',['-c','core.quotePath=false','status','--short']);
const protectedState={capturedAt:new Date().toISOString(),path:'D:/MITS',head:git('D:/MITS',['rev-parse','HEAD']),branch:git('D:/MITS',['branch','--show-current']),statusEntries:status.split(/\r?\n/).filter(Boolean),statusSha256:sha(status.replaceAll('\r\n','\n')),operation:'git --no-optional-locks read-only only'};
await writeFile(path.join(out,'protected-v395-worktree.json'),JSON.stringify(protectedState,null,2)+'\n');
console.log(JSON.stringify({sourceHash:source.hash,artifactHash:artifact.hash,candidateBuildId:manifest.candidateBuildId,rollbackArtifactMatches:manifest.rollback.onDiskArtifactMatchesLoadedReceipt,rollbackSourceMatches:manifest.rollback.onDiskSourceMatchesLoadedReceipt,protectedStatusCount:protectedState.statusEntries.length}));
