// Read-only identity closure: remote HEAD == local HEAD == committed source tree hash == runtime sourceHash, and
// the runtime buildId prefix == the hash of the dist the process actually loaded.
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root = path.resolve(process.argv[2] ?? '.');
const base = process.argv[3] ?? 'http://127.0.0.1:8080/api/v3';
const branch = process.argv[4] ?? 'main';
const ARTIFACT = ['apps/engine/dist', 'packages/core/dist', 'packages/contracts/dist', 'apps/dashboard/dist'];
const SOURCE = ['apps/engine/src', 'packages/core/src', 'packages/contracts/src', 'apps/dashboard/src'];

async function contentTreeHash(folders) {
  const hash = createHash('sha256');
  const visit = async (relative) => {
    let entries;
    try { entries = await fs.readdir(path.join(root, relative), {withFileTypes: true}); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(file);
      else { hash.update(file.replaceAll('\\', '/')); hash.update(await fs.readFile(path.join(root, file))); }
    }
  };
  for (const folder of folders) await visit(folder);
  return hash.digest('hex');
}

const git = (args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const localHead = git(['rev-parse', 'HEAD']);
const remoteHead = git(['rev-parse', `origin/${branch}`]);
const trackedDirty = git(['status', '--porcelain', '--', ...SOURCE]);
const response = await fetch(`${base}/diagnostics/closeout`);
if (!response.ok) throw new Error(`/diagnostics/closeout -> HTTP ${response.status}`);
const runtime = (await response.json()).runtime ?? {};
const instance = JSON.parse(await fs.readFile(path.join(root, 'data', 'runtime', 'engine-instance.json'), 'utf8'));
const [sourceHash, artifactHash] = await Promise.all([contentTreeHash(SOURCE), contentTreeHash(ARTIFACT)]);

const checks = {
  remoteHeadEqualsLocalHead: remoteHead === localHead,
  committedSourceTreeMatchesRuntimeSourceHash: sourceHash === instance.sourceHash,
  workingDistMatchesRuntimeArtifactHash: artifactHash === instance.artifactHash,
  buildIdDerivedFromArtifactHash: `${runtime.version ?? instance.version}-${artifactHash.slice(0, 20)}` === instance.buildId,
  runtimeApiMatchesInstanceFile: runtime.buildId === instance.buildId && runtime.instanceId === instance.instanceId && runtime.pid === instance.pid,
  sourceTreeCleanForHashedFolders: trackedDirty === '',
};
console.log(JSON.stringify({
  branch, localHead, remoteHead, gitHeadSubject: git(['log', '-1', '--pretty=%s']),
  computed: {sourceHash, artifactHash, buildId: `${instance.version}-${artifactHash.slice(0, 20)}`},
  runtimeFile: instance,
  runtimeApi: {buildId: runtime.buildId, instanceId: runtime.instanceId, pid: runtime.pid, version: runtime.version,
    lastRestartReason: runtime.lastRestartReason, restartCount: runtime.restartCount, lastRestartAt: runtime.lastRestartAt},
  dirtySourcePaths: trackedDirty,
  checks, verdict: Object.values(checks).every(Boolean) ? 'IDENTITY_CLOSED' : 'IDENTITY_BROKEN',
}, null, 1));
