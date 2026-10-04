// Regenerates docs/evidence/v396/S00/<run-id>/entrypoint-review.json from the current
// tree using the shared rule table in v396-s00-isolation-rules.mjs. It writes only that
// evidence file: no process, network or Engine lifecycle action. Run it after adding or
// renaming an entrypoint, then let v396-s00-static-check.mjs re-derive and reject drift.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEntrypointReview } from './v396-s00-isolation-rules.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..').replaceAll('\\', '/');
const target = process.argv.find(argument=>argument.startsWith('--out='))?.slice('--out='.length)
  ?? 'docs/evidence/v396/S00/20260921T145000Z/entrypoint-review.json';
const document = buildEntrypointReview(root);

writeFileSync(join(root, target), `${JSON.stringify(document, null, 2)}\n`);
const counts = document.entries.reduce((all, entry) => ({ ...all, [entry.status]: (all[entry.status] ?? 0) + 1 }), {});
console.log(JSON.stringify({ written: target, entryCount: document.entryCount, counts }, null, 2));
