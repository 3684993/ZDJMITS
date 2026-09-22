/**
 * Phase D0: put the durable settings into the exact档位 the cutover plan requires for the first
 * V3.9.6 start, through the product's validated settings consumer while the engine is stopped.
 * Asserts that nothing outside the named paths moved.
 */
import { DatabaseSync } from 'node:sqlite';
import { connect } from 'node:net';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsStore } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/config/settingsStore.js';

const DATA = process.argv[3] ?? 'D:/MITS/data';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const ts8 = (t) => new Date(Number(t) + 288e5).toISOString().replace('T', ' ').slice(0, 19) + '+08';
const portListening = (port) =>
  new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(600);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
const guards = [];
const guard = (name, ok, detail) => {
  guards.push({ name, ok, ...detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${JSON.stringify(detail).slice(0, 300)}`);
  if (!ok) {
    writeFileSync(join(OUT, 'launch-settings.json'), JSON.stringify({ verdict: 'FAIL', failedGuard: name, guards, nowUtc8: ts8(Date.now()) }, null, 1) + '\n');
    process.exit(1);
  }
};

/** Every leaf path whose value differs between two settings objects. */
function diffPaths(a, b, prefix = '') {
  const out = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const left = a?.[key];
    const right = b?.[key];
    if (left === right) continue;
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      out.push(...diffPaths(left, right, path));
    } else if (JSON.stringify(left) !== JSON.stringify(right)) out.push({ path, from: left, to: right });
  }
  return out;
}

guard('engine-is-stopped', (await portListening(8080)) === false, {});
const store = new SettingsStore('D:/MITS/config', DATA);
const before = await store.load();
const exit = before.riskGovernance?.exitCoordination ?? {};
const target = {
  ...before,
  connections: { ...before.connections, executionMode: 'READ_ONLY' },
  riskGovernance: { ...before.riskGovernance, exitCoordination: { ...exit, aiExitAuthority: 'SHADOW', positionReviewEnabled: false } },
  tradeEconomics: { ...before.tradeEconomics, admissionMode: 'SHADOW' },
};
const wanted = diffPaths(before, target);
const saved = wanted.length ? await store.saveIfVersion(target, Number(before.settingsVersion)) : before;
const probe = new DatabaseSync(join(DATA, 'zdj-settings.sqlite'), { readOnly: true });
const durable = JSON.parse(String(probe.prepare('select payload from settings where id=1').get().payload));
const auditRow = probe.prepare('select source, old_version, new_version, summary from settings_audit order by id desc limit 1').get();
const settingsRows = Number(probe.prepare('select count(*) c from settings').get().c);
probe.close();
const effective = await new SettingsStore('D:/MITS/config', DATA).load();

guard('only-the-required-paths-changed', JSON.stringify(wanted.map((w) => w.path).sort()) === JSON.stringify(['connections.executionMode', 'riskGovernance.exitCoordination.aiExitAuthority', 'riskGovernance.exitCoordination.positionReviewEnabled', 'tradeEconomics.admissionMode'].filter((p) => wanted.some((w) => w.path === p)).sort()) && diffPaths(durable, saved).length === 0, {
  changedPaths: wanted.map((w) => `${w.path}:${JSON.stringify(w.from)}->${JSON.stringify(w.to)}`),
  durableMatchesSavedObject: diffPaths(durable, saved).length === 0,
});
guard('execution-mode-read-only', effective.connections.executionMode === 'READ_ONLY', { executionMode: effective.connections.executionMode });
guard('ai-exit-authority-shadow', effective.riskGovernance.exitCoordination.aiExitAuthority === 'SHADOW', { aiExitAuthority: effective.riskGovernance.exitCoordination.aiExitAuthority });
guard('position-review-disabled', effective.riskGovernance.exitCoordination.positionReviewEnabled === false, { positionReviewEnabled: effective.riskGovernance.exitCoordination.positionReviewEnabled });
guard('trade-economics-admission-shadow', effective.tradeEconomics.admissionMode === 'SHADOW', { admissionMode: effective.tradeEconomics.admissionMode });
guard('environment-still-testnet-demo', effective.connections.exchange.environment === 'TESTNET' && new URL(String(effective.connections.exchange.testnetRestBaseUrl)).hostname === 'demo-fapi.binance.com', { environment: effective.connections.exchange.environment, rest: effective.connections.exchange.testnetRestBaseUrl });
guard('settings-version-monotonic', Number(saved.settingsVersion) >= Number(before.settingsVersion), { before: before.settingsVersion, after: saved.settingsVersion, auditRow, settingsRows });
guard('ai-exit-loss-limit-not-loosened', Number(effective.riskGovernance.exitCoordination.aiExitLossLimitUsd) <= 10 && Number(effective.riskGovernance.exitCoordination.aiExitMinNetProfitUsd) > 0, {
  aiExitLossLimitUsd: effective.riskGovernance.exitCoordination.aiExitLossLimitUsd,
  aiExitMinNetProfitUsd: effective.riskGovernance.exitCoordination.aiExitMinNetProfitUsd,
  aiExitAllowSmallLoss: effective.riskGovernance.exitCoordination.aiExitAllowSmallLoss,
});
guard('portfolio-limits-not-loosened', Number(effective.riskGovernance.maxGrossExposurePct) === Number(before.riskGovernance.maxGrossExposurePct) && Number(effective.portfolio.maxPositions) === Number(before.portfolio.maxPositions), {
  maxGrossExposurePct: effective.riskGovernance.maxGrossExposurePct,
  maxPositions: effective.portfolio.maxPositions,
  entryMarginUsd: effective.portfolio.entryMarginUsd,
});

const result = {
  verdict: 'PASS',
  nowUtc8: ts8(Date.now()),
  engineLifecycle: 'NOT_USED_BY_THIS_SCRIPT (settings written while the engine is stopped, through SettingsStore.saveIfVersion CAS)',
  before: { settingsVersion: before.settingsVersion, executionMode: before.connections.executionMode, aiExitAuthority: exit.aiExitAuthority ?? 'ABSENT_DEFAULT_OFF', positionReviewEnabled: exit.positionReviewEnabled ?? 'ABSENT_DEFAULT_FALSE', admissionMode: before.tradeEconomics?.admissionMode ?? null },
  after: { settingsVersion: saved.settingsVersion, executionMode: effective.connections.executionMode, aiExitAuthority: effective.riskGovernance.exitCoordination.aiExitAuthority, positionReviewEnabled: effective.riskGovernance.exitCoordination.positionReviewEnabled, admissionMode: effective.tradeEconomics.admissionMode },
  changedPaths: wanted,
  guards,
};
writeFileSync(join(OUT, 'launch-settings.json'), JSON.stringify(result, null, 1) + '\n');
console.log('VERDICT=PASS settingsVersion=' + saved.settingsVersion + ' executionMode=' + effective.connections.executionMode + ' aiExitAuthority=' + effective.riskGovernance.exitCoordination.aiExitAuthority);
