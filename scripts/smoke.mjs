const base = process.env.ZDJ_BASE_URL ?? 'http://127.0.0.1:8080';
const endpoints = ['/health','/api/v3/snapshot','/api/v3/universe','/api/v3/pool','/api/v3/brain/resources','/api/v3/operations/health'];
let failed = false;
for (const p of endpoints) {
  try {
    const r = await fetch(base + p);
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${p} ${r.status}`);
    if (!r.ok) failed = true;
  } catch (e) { failed = true; console.error(`FAIL ${p}`, e.message); }
}
if (failed) process.exit(1);
