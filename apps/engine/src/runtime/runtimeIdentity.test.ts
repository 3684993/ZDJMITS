import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeIdentity, persistRuntimeIdentity, runtimeIdentityExecutionRefusal, stableValueHash } from './runtimeIdentity.js';

describe('runtime identity evidence', () => {
  it('keeps a stable database epoch and persists the settings identity', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'zdj-runtime-identity-'));
    try {
      const first = await createRuntimeIdentity(dataDir, '127.0.0.1', 8096, 'test');
      const finalized = await persistRuntimeIdentity(first.identityPath, first.identity, {
        settingsVersion: 31,
        nested: { b: 2, a: 1 },
      });
      const second = await createRuntimeIdentity(dataDir, '127.0.0.1', 8096, 'test');
      const stored = JSON.parse(await readFile(first.identityPath, 'utf8'));

      expect(first.identity.databaseEpoch).toBe(second.identity.databaseEpoch);
      expect(finalized.settingsVersion).toBe(31);
      expect(finalized.settingsHash).toBe(stableValueHash({ nested: { a: 1, b: 2 }, settingsVersion: 31 }));
      expect(stored.databaseEpoch).toBe(first.identity.databaseEpoch);
      expect(second.identity.restartCount).toBe(first.identity.restartCount + 1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('refuses executable TESTNET mode for a known dirty source overlay', () => {
    expect(runtimeIdentityExecutionRefusal({ gitWorktreeState: 'DIRTY' }, 'TESTNET_ENABLED'))
      .toBe('DIRTY_SOURCE_OVERLAY_EXECUTION_REFUSED');
    expect(runtimeIdentityExecutionRefusal({ gitWorktreeState: 'DIRTY' }, 'READ_ONLY')).toBeNull();
    expect(runtimeIdentityExecutionRefusal({ gitWorktreeState: 'CLEAN' }, 'TESTNET_ENABLED')).toBeNull();
    expect(runtimeIdentityExecutionRefusal({ gitWorktreeState: 'UNAVAILABLE' }, 'TESTNET_ENABLED')).toBeNull();
  });
});
