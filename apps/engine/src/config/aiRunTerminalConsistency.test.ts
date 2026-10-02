import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
vi.mock('@zdj/contracts', async () => import(new URL('../../../../packages/contracts/src/index.js', import.meta.url).href));
vi.mock('@zdj/core', async () => import(new URL('../../../../packages/core/src/index.js', import.meta.url).href));
import {SettingsStore} from './settingsStore.js';
import {RuntimeState} from '../state/runtimeState.js';
import {AiRunSchema} from '@zdj/contracts';

const dirs: string[] = [];
const stores: SettingsStore[] = [];
const openStore = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zdj-terminal-consistency-'));
  dirs.push(dir);
  const store = new SettingsStore(fileURLToPath(new URL('../../../../config/', import.meta.url)), dir);
  stores.push(store);
  return {store, settings: await store.load()};
};
afterEach(async () => {
  vi.useRealTimers();
  stores.splice(0).forEach(store => store.close());
  await Promise.all(dirs.splice(0).map(dir => rm(dir, {recursive: true, force: true})));
});
const request = (id = 'interrupted-primary') => ({
  id, symbol: 'HYPEUSDT', role: 'PRIMARY_BRAIN', model: 'Qwen3.8-27B-4bit',
  status: 'RUNNING', startedAt: 1_790_955_992_044, completedAt: null,
  settingsVersion: 33, packetId: 'frozen-packet', decision: null,
  inputPreview: '{"prompt":"original prompt","packet":{"packetId":"frozen-packet"}}',
  outputPreview: undefined, normalizedPreview: undefined,
});
const completed = (id = 'completed-primary') => ({
  ...request(id), status: 'COMPLETED', completedAt: 1_790_956_100_000,
  decision: 'WAIT_FOR_PRICE', outputPreview: '{"decision":"WAIT_FOR_PRICE"}',
});
const summary = (store: SettingsStore, id: string) => store.listAiRunSummaries({from: 0}).items.find(run => run.id === id);

describe('AI terminal state authority across checkpoint recovery', () => {
  it('archives restart interruption once and makes list, detail, and filters agree without model/order events', async () => {
    const {store, settings} = await openStore();
    const running = request();
    store.upsertAiRun(running);
    store.persistRuntime({runtimeControl: {}, aiRuns: [running]});
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(1_790_956_168_169);
    const state = new RuntimeState(settings);
    state.restore(store.loadRuntime());
    state.aiRuns = store.reconcileRestoredAiRuns(state.aiRuns);
    expect(state.aiRuns[0]).toMatchObject({
      status: 'FAILED', completedAt: 1_790_956_168_169, latencyMs: 176_125,
      error: 'ENGINE_RESTART_INTERRUPTED',
      failure: {failureStage: 'RUNTIME_RECOVERY', timeout: false, schemaValidation: false},
    });
    expect(summary(store, running.id)).toMatchObject({status: 'FAILED', completedAt: 1_790_956_168_169, reason: 'ENGINE_RESTART_INTERRUPTED'});
    expect(store.resolveAiRun(running.id, running)).toEqual(state.aiRuns[0]);
    expect(store.listAiRunSummaries({from: 0, status: 'RUNNING'}).total).toBe(0);
    expect(store.listAiRunSummaries({from: 0, status: 'FAILED'}).total).toBe(1);
    expect(store.getAiRun(running.id).inputPreview).toBe(running.inputPreview);
    expect(store.getAiRun(running.id).decision).toBeNull();
    expect(store.runtimeEvents(0)).toEqual([]);
    expect(store.getDecisionChain(running.id)).toBeNull();
    const original = store.getAiRun(running.id);
    // A second boot from the still-old checkpoint must retain the first proven interruption.
    vi.setSystemTime(1_790_956_300_000);
    const second = new RuntimeState(settings);
    second.restore(store.loadRuntime());
    second.aiRuns = store.reconcileRestoredAiRuns(second.aiRuns);
    expect(second.aiRuns[0]).toEqual(original);
  });

  it('retains a durable real completion when the checkpoint still says RUNNING', async () => {
    const {store, settings} = await openStore();
    const terminal = completed();
    store.persistRuntime({runtimeControl: {}, aiRuns: [request(terminal.id)]});
    store.upsertAiRun(terminal);
    const state = new RuntimeState(settings);
    state.restore(store.loadRuntime());
    expect(state.aiRuns[0].failure?.errorCode).toBe('ENGINE_RESTART_INTERRUPTED');
    state.aiRuns = store.reconcileRestoredAiRuns(state.aiRuns);
    expect(state.aiRuns[0]).toEqual(terminal);
    expect(summary(store, terminal.id)).toMatchObject({status: 'COMPLETED', decision: 'WAIT_FOR_PRICE', completedAt: terminal.completedAt});
    expect(store.resolveAiRun(terminal.id, {...terminal, status: 'RUNNING'})).toEqual(terminal);
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELED'])('late RUNNING or a different terminal outcome cannot overwrite %s', async status => {
    const {store} = await openStore();
    const terminal = {...completed(), status, failure: status === 'FAILED' ? {errorCode: 'AI_TIMEOUT', timeout: true} : null};
    store.upsertAiRun(terminal);
    store.upsertAiRun(request(terminal.id));
    store.upsertAiRun({...terminal, status: status === 'FAILED' ? 'COMPLETED' : 'FAILED', completedAt: terminal.completedAt + 1});
    store.upsertAiRun({...terminal, completedAt: terminal.completedAt + 2, failure: {errorCode: 'ENGINE_RESTART_INTERRUPTED'}});
    expect(store.getAiRun(terminal.id)).toEqual(terminal);
    expect(summary(store, terminal.id)?.status).toBe(status);
    expect(store.resolveAiRun(terminal.id, request(terminal.id))).toEqual(terminal);
  });

  it('allows the same terminal outcome to receive its normal protocol audit enrichment', async () => {
    const {store} = await openStore();
    const terminal = completed();
    store.upsertAiRun(terminal);
    const enriched = {...terminal, parserRepaired: false, normalizedPreview: '{"decision":"WAIT_FOR_PRICE"}'};
    store.upsertAiRun(enriched);
    expect(store.getAiRun(terminal.id)).toEqual(enriched);
  });

  it('read-only lookup never changes SQLite or guesses that a current RUNNING request failed', async () => {
    const {store} = await openStore();
    const running = request();
    store.upsertAiRun(running);
    const db = (store as any).db;
    const changes = db.prepare('SELECT total_changes() AS n').get().n;
    expect(store.resolveAiRun(running.id, running)).toEqual(running);
    expect(summary(store, running.id)?.status).toBe('RUNNING');
    expect(store.resolveAiRun('missing')).toBeNull();
    expect(db.prepare('SELECT total_changes() AS n').get().n).toBe(changes);
  });

  it('honors retained terminal metadata when raw output has already been compacted', async () => {
    const {store, settings} = await openStore();
    const terminal = completed();
    store.upsertAiRun(terminal);
    const running = AiRunSchema.parse({...request(terminal.id), resourceId: 'primary-local',
      latencyMs: null, inputTokens: null, outputTokens: null, error: null,
      timing: {queueMs: 0, promptBuildMs: 0, requestMs: null, retryMs: null, parseMs: null, totalMs: 0}});
    store.persistRuntime({runtimeControl: {}, aiRuns: [running]});
    (store as any).db.prepare("UPDATE ai_runs_archive SET payload='{}' WHERE run_id=?").run(terminal.id);
    const state = new RuntimeState(settings);
    state.restore(store.loadRuntime());
    state.aiRuns = store.reconcileRestoredAiRuns(state.aiRuns);
    expect(state.aiRuns[0]).toMatchObject({id: terminal.id, status: 'COMPLETED', completedAt: terminal.completedAt,
      resourceId: running.resourceId, packetId: running.packetId, inputPreview: running.inputPreview, error: null});
    expect(() => AiRunSchema.parse(state.aiRuns[0])).not.toThrow();
    expect(state.aiRuns[0].timing).toBeUndefined();
    expect(state.aiRuns[0].failure).toBeUndefined();
    expect(state.aiRuns[0].outputPreview).toBeUndefined();
    expect(state.aiRuns[0].normalizedPreview).toBeUndefined();
    expect(store.resolveAiRun(terminal.id, request(terminal.id))).toMatchObject({
      status: 'COMPLETED', rawArtifactStatus: 'COMPACTED', decision: 'WAIT_FOR_PRICE',
    });
    expect(store.getAiRun(terminal.id).outputPreview).toBeUndefined();
    expect(store.getAiRun(terminal.id).failure).toBeUndefined();
    expect((store as any).db.prepare('SELECT payload FROM ai_runs_archive WHERE run_id=?').get(terminal.id).payload).toBe('{}');
  });

  it('does not merge compacted metadata with a checkpoint whose request identity differs', async () => {
    const {store} = await openStore();
    const terminal = completed();
    store.upsertAiRun(terminal);
    (store as any).db.prepare("UPDATE ai_runs_archive SET payload='{}' WHERE run_id=?").run(terminal.id);
    expect(() => store.reconcileRestoredAiRuns([{...request(terminal.id), symbol: 'WRONGUSDT'}]))
      .toThrow('AI_RESTORE_ARCHIVE_IDENTITY_CONFLICT');
    expect(store.getAiRun(terminal.id)).toMatchObject({symbol: 'HYPEUSDT', status: 'COMPLETED', rawArtifactStatus: 'COMPACTED'});
  });

  it('rolls back the bounded recovery set if one artifact cannot be persisted', async () => {
    const {store} = await openStore();
    store.upsertAiRun(request('first'));
    store.upsertAiRun(request('second'));
    (store as any).db.exec("CREATE TRIGGER fail_recovery BEFORE UPDATE ON ai_runs_archive WHEN NEW.run_id='second' BEGIN SELECT RAISE(ABORT,'TEST_RECOVERY_FAILURE'); END");
    expect(() => store.reconcileRestoredAiRuns([completed('first'), completed('second')])).toThrow('TEST_RECOVERY_FAILURE');
    expect(store.listAiRunSummaries({from: 0, status: 'RUNNING'}).total).toBe(2);
    expect(store.getAiRun('first').status).toBe('RUNNING');
  });
});
