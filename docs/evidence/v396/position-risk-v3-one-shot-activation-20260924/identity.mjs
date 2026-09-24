// Predicts the next instance's identity two ways: with this file's own copy of the hashing rule and
// with the helper compiled into the currently running build. If the two disagree, the deployed code
// is not the code we think we are measuring.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentTreeHash } from '../../../../apps/engine/dist/runtime/runtimeIdentity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DIST = ['apps/engine/dist', 'packages/core/dist', 'packages/contracts/dist', 'apps/dashboard/dist'];
const SRC = ['apps/engine/src', 'packages/core/src', 'packages/contracts/src', 'apps/dashboard/src'];

async function ownTreeHash(folders) {
  const hash = createHash('sha256');
  async function visit(relative) {
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(file);
      else { hash.update(file.replaceAll('\\', '/')); hash.update(await readFile(path.join(root, file))); }
    }
  }
  for (const folder of folders) await visit(folder);
  return hash.digest('hex');
}

const [ownArtifact, ownSource, builtArtifact, builtSource] = [
  await ownTreeHash(DIST), await ownTreeHash(SRC),
  await contentTreeHash(root, DIST), await contentTreeHash(root, SRC),
];
console.log(`root=${root.replaceAll('\\', '/')}`);
console.log(`HEAD=${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()}`);
console.log(`artifactHash(own)=${ownArtifact}`);
console.log(`artifactHash(runtime helper)=${builtArtifact} same=${ownArtifact === builtArtifact}`);
console.log(`sourceHash(own)=${ownSource}`);
console.log(`sourceHash(runtime helper)=${builtSource} same=${ownSource === builtSource}`);
console.log(`expected buildId=3.9.6-${builtArtifact.slice(0, 20)}`);
