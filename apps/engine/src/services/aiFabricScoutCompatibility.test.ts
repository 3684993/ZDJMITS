import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ScoutAnnotationJsonSchema } from '@zdj/contracts';
import { EngineRuntime } from '../runtime/appRuntime.js';
import { loadAiResources } from '../config/aiResourceLoader.js';
import { AiRequestError } from '../adapters/ai/OpenAiCompatibleClient.js';
import { AiFabric } from './aiFabric.js';

const runtimes: EngineRuntime[] = [], dirs: string[] = [];
const annotation = {
  symbol: 'BTCUSDT', summary: 'Closed candle and spread facts for Primary review.',
  keyEvidence: ['technical.15m.confirmed'], contradictions: [], missingEvidence: [], attentionScore: 0.72,
};

afterEach(async () => {
  try {
    for (const runtime of runtimes.splice(0)) runtime.stop(); // Only the unstarted isolated test harness.
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

function stubModelResponse(content: string, reasoningContent = '', reasoningTokens = 0) {
  // Every fetch is intercepted; LM Studio inference must not make identity or health requests.
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'http://127.0.0.1:1234/v1/chat/completions' && init?.method === 'POST') {
      return new Response(JSON.stringify({
        model: 'qwen/qwen3.5-9b',
        choices: [{ message: { content, reasoning_content: reasoningContent }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 321, completion_tokens: 123, completion_tokens_details: { reasoning_tokens: reasoningTokens } },
      }), { status: 200 });
    }
    throw new Error(`UNEXPECTED_OFFLINE_FETCH:${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'zdj-scout-compat-'));
  dirs.push(dataDir);
  const runtime = await EngineRuntime.createTestHarness({ configDir: '../../config', dataDir });
  runtimes.push(runtime);
  runtime.state.settings.ai.scoutEnabled = true;
  runtime.state.settings.ai.scoutExperimentMode = 'SERIAL';
  runtime.state.settings.aiResources = runtime.state.settings.aiResources.map(resource => resource.role === 'SCOUT'
    ? { ...resource, enabled: true, baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen/qwen3.5-9b', maxConcurrency: 1 }
    : resource);
  runtime.state.aiResources = loadAiResources(runtime.state.settings);
  const ai = new AiFabric(runtime.state, runtime.events, runtime.eip);
  await runtime.market.refresh(20); // createTestHarness supplies synthetic market/exchange adapters.
  runtime.universe.refresh();
  runtime.runtimeControl.evaluate(true);
  const packet = runtime.eip.build('BTCUSDT');
  const events: Array<{ type: string; payload?: unknown }> = [];
  runtime.events.on('event', event => events.push(event));
  return { runtime, ai, packet, events };
}

function expectBoundedScoutRequest(fetchMock: ReturnType<typeof stubModelResponse>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'));
  expect(calls).toHaveLength(1);
  const body = JSON.parse(String(calls[0]![1]?.body));
  expect(body).toMatchObject({ model: 'qwen/qwen3.5-9b', reasoning_effort: 'none', max_tokens: 600, stream: false });
  expect(body.response_format).toEqual({
    type: 'json_schema', json_schema: { name: 'ScoutAnnotation', strict: true, schema: ScoutAnnotationJsonSchema },
  });
  expect(body.messages).toHaveLength(1);
  expect(body.messages[0]).toMatchObject({ role: 'user', content: expect.any(String) });
}

function expectNoExecution(runtime: EngineRuntime, events: Array<{ type: string }>) {
  expect(runtime.state.entryIntents.size).toBe(0);
  expect(runtime.state.entryOrders.size).toBe(0);
  expect(runtime.state.entryReservations.size).toBe(0);
  expect(runtime.state.aiRuns.some(run => run.role === 'PRIMARY_BRAIN')).toBe(false);
  expect(events.filter(event => event.type.startsWith('ENTRY_') || event.type.startsWith('PRIMARY_'))).toEqual([]);
}

describe('local 9B Scout client compatibility and durable audit', () => {
  it('requests bounded strict final JSON and archives an annotation without decision or order authority', async () => {
    const fetchMock = stubModelResponse(JSON.stringify(annotation));
    const { runtime, ai, packet, events } = await fixture();
    expect(await ai.scout(packet)).toEqual(annotation);
    expectBoundedScoutRequest(fetchMock);
    expect(runtime.state.aiRuns).toHaveLength(1);
    const run = runtime.state.aiRuns[0]!;
    expect(run).toMatchObject({ role: 'SCOUT', status: 'COMPLETED', terminalStage: 'SCHEMA_VALID',
      model: 'qwen/qwen3.5-9b', decision: null, direction: null, finishReason: 'stop',
      inputTokens: 321, outputTokens: 123, scoutHandoff: true, failure: null });
    expect(JSON.parse(run.normalizedPreview!)).toEqual(annotation);
    expect(JSON.parse(run.outputPreview!).__zdjRequestOverrides).toEqual({ reasoning_effort: 'none' });
    const saved = runtime.settingsStore.getAiRun(run.id);
    expect(saved).toMatchObject({ id: run.id, status: 'COMPLETED', role: 'SCOUT', decision: null, direction: null });
    expect(JSON.parse(saved.normalizedPreview)).toEqual(annotation);
    expect(events.filter(event => event.type === 'AI_RUN_COMPLETED')).toHaveLength(1);
    expect(events.filter(event => event.type === 'AI_RUN_FAILED')).toEqual([]);
    expectNoExecution(runtime, events);
  });

  it('archives reasoning-only stop diagnostics and rejects without completion, handoff or entry intent', async () => {
    // Even a valid annotation inside reasoning cannot be promoted into a final answer.
    const reasoning = JSON.stringify(annotation);
    const fetchMock = stubModelResponse('', reasoning, 117);
    const { runtime, ai, packet, events } = await fixture();
    const error = await ai.scout(packet).then(() => null, value => value);
    expect(error).toBeInstanceOf(AiRequestError);
    expect(error).toMatchObject({ stage: 'PARSE', message: 'AI_OUTPUT_INVALID: final content is empty (reasoning-only response)' });
    expectBoundedScoutRequest(fetchMock);
    expect(runtime.state.aiRuns).toHaveLength(1);
    const run = runtime.state.aiRuns[0]!;
    expect(run).toMatchObject({ role: 'SCOUT', status: 'FAILED', terminalStage: 'AI_OUTPUT_INVALID',
      finishReason: 'stop', inputTokens: 321, outputTokens: 123, decision: null, direction: null,
      failure: { failureStage: 'SCHEMA_VALIDATION', errorCode: 'AI_SCHEMA_INVALID', schemaValidation: true,
        timeout: false, retryCount: 0, rawOutput: JSON.stringify('') } });
    const diagnostics = { finishReason: 'stop', contentCharacters: 0, reasoningCharacters: reasoning.length, reasoningTokens: 117 };
    expect(JSON.parse(run.outputPreview!)).toEqual({ responseDiagnostics: diagnostics });
    expect(run.normalizedPreview).toBeUndefined();
    expect(run.scoutHandoff).not.toBe(true);
    expect(run.outputPreview).not.toContain(annotation.summary);
    const saved = runtime.settingsStore.getAiRun(run.id);
    expect(saved).toMatchObject({ status: 'FAILED', finishReason: 'stop', inputTokens: 321, outputTokens: 123,
      decision: null, direction: null, failure: { errorCode: 'AI_SCHEMA_INVALID' } });
    expect(JSON.parse(saved.outputPreview)).toEqual({ responseDiagnostics: diagnostics });
    expect(saved.normalizedPreview).toBeUndefined();
    expect(saved.scoutHandoff).not.toBe(true);
    expect(events.filter(event => event.type === 'AI_RUN_COMPLETED' || event.type === 'SCOUT_EXPERIMENT_SCOUT_COMPLETED')).toEqual([]);
    expect(events.filter(event => event.type === 'AI_RUN_FAILED')).toHaveLength(1);
    expectNoExecution(runtime, events);
  });
});
