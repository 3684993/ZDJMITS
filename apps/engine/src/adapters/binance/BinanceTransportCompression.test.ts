import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import https from 'node:https';
import { gunzip, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceTransport, BINANCE_EGRESS_VERIFY_TIMEOUT_MS } from './BinanceTransport.js';

// Every HTTP request is intercepted. The SOCKS agents are only constructed;
// these tests never open a socket, contact Binance, or invoke a model.
vi.mock('node:https', () => ({ default: { request: vi.fn() } }));
vi.mock('node:zlib', async importOriginal => {
  const actual = await importOriginal<typeof import('node:zlib')>();
  return { ...actual, gunzip: vi.fn(actual.gunzip) };
});
const requestMock = vi.mocked(https.request);
let nextPort = 24000;
const settings = () => ({
  executionMode: 'TESTNET_ENABLED',
  exchange: { environment: 'TESTNET', testnetBaseUrl: 'https://demo-fapi.binance.com',
    testnetRestBaseUrl: 'https://demo-fapi.binance.com', productionBaseUrl: 'https://fapi.binance.com' },
  proxy: { enabled: true, url: `socks5h://127.0.0.1:${nextPort++}`, forceBinanceRest: true,
    forceBinanceWs: true, proxyDns: true, failClosed: true, expectedStaticEgressIp: '203.0.113.10' },
});

class Response extends PassThrough {
  headers: Record<string, string> = {};
  statusCode = 200;
  complete = false;
  finish(body: Buffer) { this.complete = true; this.end(body); }
}

function fixture(reply: (response: Response, request: any, options: any) => void,
  stages: { emitProxy?: boolean; completeTls?: boolean; respond?: boolean } = {}) {
  const config = settings(), transport = new BinanceTransport(config as never), budget = (transport as any).budget;
  vi.spyOn(budget, 'run').mockImplementation(async (_priority: any, _weight: any, run: any) => run());
  const observations = vi.spyOn(budget, 'observeResponse');
  requestMock.mockImplementation(((url: URL, options: any, callback: any) => {
    const request: any = new EventEmitter(), response = new Response();
    request.destroyed = false; request.reusedSocket = false;
    const abort = () => request.destroy(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    request.destroy = (error?: Error) => {
      if (request.destroyed) return request;
      request.destroyed = true;
      options.signal.removeEventListener('abort', abort);
      if (error) request.emit('error', error);
      if (!response.complete) response.destroy();
      return request;
    };
    options.signal.addEventListener('abort', abort, { once: true });
    response.once('end', () => options.signal.removeEventListener('abort', abort));
    request.end = vi.fn(() => queueMicrotask(() => {
      if (request.destroyed) return;
      if (stages.emitProxy !== false) request.emit('proxy', {});
      const socket: any = new EventEmitter(); socket.secureConnecting = true;
      request.emit('socket', socket);
      if (stages.completeTls !== false) socket.emit('secureConnect');
      if (stages.respond !== false) { callback(response); reply(response, request, options); }
    }));
    return request;
  }) as never);
  return { transport, config, observations };
}

beforeEach(() => requestMock.mockReset());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Binance REST compression and bounded deadlines', () => {
  it('negotiates gzip, decodes a complete exchangeInfo, and uses its dedicated deadline', async () => {
    const payload = { symbols: Array.from({ length: 741 }, (_, index) => ({ symbol: `S${index}USDT` })), rateLimits: [] };
    const encoded = gzipSync(JSON.stringify(payload));
    const f = fixture(response => response.finish(encoded));
    headerReply({ 'content-encoding': 'gzip', 'content-length': String(encoded.length) });
    expect(await f.transport.json('/fapi/v1/exchangeInfo')).toEqual(payload);
    const options = requestMock.mock.calls[0]![1] as any;
    expect(options.headers['accept-encoding']).toBe('gzip');
    expect(options.timeout).toBe(30_000);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(f.observations).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/fapi/v1/exchangeInfo', 'GET', 1234, 1234],
    ['/fapi/v2/account', 'GET', undefined, 15_000],
    ['/fapi/v1/order', 'POST', undefined, 15_000],
  ])('preserves timeout policy for %s %s', async (path, method, explicit, expected) => {
    const f = fixture(response => response.finish(Buffer.from('{}')));
    await f.transport.json(String(path), { method: String(method), timeoutMs: explicit as number | undefined });
    expect((requestMock.mock.calls[0]![1] as any).timeout).toBe(expected);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('retains a gzip HTTP refusal and rate-limit governance without retrying an order', async () => {
    const errorBody = JSON.stringify({ code: -1003, msg: 'Too many requests' });
    const f = fixture(response => response.finish(gzipSync(errorBody)));
    headerReply({ 'content-encoding': 'gzip', 'retry-after': '2' }, 429);
    await expect(f.transport.json('/fapi/v1/order', { method: 'POST' })).rejects.toThrow('Binance HTTP 429');
    expect(f.observations).toHaveBeenCalledWith(429, expect.anything(), '2', expect.objectContaining({ endpoint: '/fapi/v1/order' }), null, 0);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects corrupt gzip and preserves HTTP refusal facts even without a usable body', async () => {
    const f = fixture(response => response.finish(Buffer.from('not gzip')));
    headerReply({ 'content-encoding': 'gzip', 'retry-after': '2' }, 429);
    await expect(f.transport.json('/fapi/v1/order', { method: 'POST' })).rejects.toThrow('BINANCE_RESPONSE_GZIP_INVALID');
    expect(f.observations).toHaveBeenCalledTimes(1);
    expect(f.observations.mock.calls[0]![0]).toBe(429);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each(['aborted', 'error'])('rejects response %s and never returns a partial exchangeInfo', async kind => {
    const f = fixture(response => {
      response.write(Buffer.from('{"symbols":['));
      if (kind === 'error') response.emit('error', new Error('connection reset'));
      else response.emit('aborted');
    });
    await expect(f.transport.json('/fapi/v1/exchangeInfo')).rejects.toThrow(/BINANCE_RESPONSE_(ABORTED|STREAM_ERROR)/);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('enforces the total deadline while the response body is still arriving', async () => {
    const f = fixture(response => response.write(Buffer.from('{"partial":')));
    const keepTestAlive = setTimeout(() => {}, 100);
    try {
      const error = await f.transport.json<never>('/fapi/v1/order?signature=do-not-log', { method: 'POST', timeoutMs: 10,
        headers: { 'X-MBX-APIKEY': 'do-not-log-key' } }).catch((error: Error) => error);
      expect(error.message).toContain('Binance request timed out');
      expect(error.message).toContain('phase=RESPONSE_BODY');
      expect(error.message).toContain('httpStatus=200');
      expect(error.message).not.toContain('signature');
      expect(error.message).not.toContain('do-not-log');
    } finally { clearTimeout(keepTestAlive); }
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('records a bounded network code instead of leaking upstream URLs or headers', async () => {
    const f = fixture((_response, request) => request.emit('error', Object.assign(
      new Error('https://demo-fapi.binance.com/fapi/v1/order?signature=secret X-MBX-APIKEY=secret-key'), { code: 'ECONNRESET' })));
    const error = await f.transport.json<never>('/fapi/v1/order?signature=secret', { method: 'POST' }).catch((error: Error) => error);
    expect(error.message).toContain('ECONNRESET');
    expect(error.message).toContain('endpoint=/fapi/v1/order');
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('signature');
    expect(error.message).not.toContain('X-MBX-APIKEY');
  });

  it.each([
    ['undefined', undefined], ['null', null], ['string', 'signature=secret'],
    ['object', { name: 'AbortError', code: 'ECONNRESET', message: 'signature=secret' }],
    ['number', 123],
  ])('handles a %s error payload without throwing or echoing it', async (_label, payload) => {
    const f = fixture((_response, request) => request.emit('error', payload));
    const error = await f.transport.json<never>('/fapi/v1/order', { method: 'POST' }).catch((error: Error) => error);
    expect(error.message).toContain('BINANCE_TRANSPORT_BLOCKED: NETWORK_REQUEST_FAILED');
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('ECONNRESET');
    expect(error.message).not.toContain('Binance request timed out');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/fapi/v1/order', 'POST', 15_000],
    ['/fapi/v1/exchangeInfo', 'GET', 30_000],
  ])('keeps the %s deadline active after HTTP end while gunzip is pending', async (path, method, timeoutMs) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let finishDecode: (error: Error | null, value: Buffer) => void;
    vi.mocked(gunzip).mockImplementationOnce(((_input: any, _options: any, callback: any) => {
      finishDecode = callback;
    }) as never);
    const f = fixture(response => response.finish(gzipSync('{}')));
    headerReply({ 'content-encoding': 'gzip' });
    let settled = false;
    const result = f.transport.json<never>(path, { method }).catch((error: Error) => error)
      .finally(() => { settled = true; });
    // Real stream end removes the request's AbortSignal listener in the mock,
    // exactly the boundary at which a request-only timeout used to be lost.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(finishDecode!).toBeTypeOf('function');
    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await result;
    expect(error.message).toContain('Binance request timed out');
    expect(error.message).toContain('phase=RESPONSE_DECODE');
    expect(vi.getTimerCount()).toBe(0);
    finishDecode!(null, Buffer.from('{}'));
    await Promise.resolve();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('checks the deadline after synchronous JSON parsing before accepting the result', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const parse = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      const result = parse(text, reviver);
      if (text === '{"parseDeadlineCase":true}') now = 15_001;
      return result;
    });
    const f = fixture(response => response.finish(Buffer.from('{"parseDeadlineCase":true}')));
    const error = await f.transport.json<never>('/fapi/v1/order', { method: 'POST' }).catch((error: Error) => error);
    expect(error.message).toContain('Binance request timed out');
    expect(error.message).toContain('phase=RESPONSE_PARSE');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the total deadline after a successful response', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fixture(response => response.finish(Buffer.from('{}')));
    await expect(f.transport.json('/fapi/v1/order', { method: 'POST' })).resolves.toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('identifies a TLS stall from socket assignment even without a proxy event', async () => {
    const f = fixture(() => {}, { emitProxy: false, completeTls: false, respond: false });
    const error = await f.transport.json<never>('/fapi/v1/exchangeInfo', { timeoutMs: 5 }).catch((error: Error) => error);
    expect(error.message).toContain('phase=TLS_CONNECT');
    expect(error.message).toContain('httpStatus=UNKNOWN');
  });

  it('keeps bounded reusable REST connections separate from WebSockets', async () => {
    const f = fixture(response => response.finish(Buffer.from('{}')));
    await f.transport.json('/fapi/v1/exchangeInfo');
    const agent = (requestMock.mock.calls[0]![1] as any).agent;
    expect(agent).toMatchObject({ keepAlive: true, maxSockets: 6, maxFreeSockets: 2 });
    expect(agent).not.toBe(f.transport.websocketOptions().agent);
    expect(f.transport.websocketOptions().agent.keepAlive).toBe(false);
    f.transport.reconfigure(f.config as never);
    await f.transport.json('/fapi/v1/exchangeInfo');
    expect((requestMock.mock.calls[1]![1] as any).agent).toBe(agent);
    const destroy = vi.spyOn(agent, 'destroy');
    f.transport.reconfigure({ ...f.config, proxy: { ...f.config.proxy, url: 'socks5h://127.0.0.1:29998' } } as never);
    expect(destroy).toHaveBeenCalledTimes(1);
    await f.transport.json('/fapi/v1/exchangeInfo');
    expect((requestMock.mock.calls[2]![1] as any).agent).not.toBe(agent);
  });
});

describe('egress verification remains complete and fail-closed', () => {
  it('allows the measured proxy handshake budget and verifies an actual complete IP response', async () => {
    const f = fixture(response => response.finish(Buffer.from('203.0.113.10\n')));
    expect(f.transport.entryBlockReason()).toBe('BINANCE_EGRESS_UNVERIFIED');
    expect(await f.transport.verifyEgressIp()).toMatchObject({ status: 'VERIFIED', lastVerifiedEgressIp: '203.0.113.10' });
    expect((requestMock.mock.calls[0]![1] as any).timeout).toBe(BINANCE_EGRESS_VERIFY_TIMEOUT_MS);
    expect(BINANCE_EGRESS_VERIFY_TIMEOUT_MS).toBe(15_000);
    expect(() => f.transport.assertTestnetExchangeWrite()).not.toThrow();
  });

  it.each([
    ['invalid IP', 'not-an-ip', 200, 'UNAVAILABLE', 'EGRESS_VERIFY_INVALID_IP'],
    ['HTTP failure', '203.0.113.10', 503, 'UNAVAILABLE', 'EGRESS_VERIFY_HTTP_503'],
    ['different IP', '203.0.113.11', 200, 'MISMATCH', null],
  ])('rejects %s without enabling Testnet writes', async (_label, body, status, expectedStatus, lastError) => {
    const f = fixture(response => response.finish(Buffer.from(String(body))));
    headerReply({}, Number(status));
    expect(await f.transport.verifyEgressIp()).toMatchObject({ status: expectedStatus, lastError });
    expect(() => f.transport.assertTestnetExchangeWrite()).toThrow(`TESTNET_WRITE_EGRESS_NOT_VERIFIED:${expectedStatus}`);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each(['aborted', 'error', 'close', 'timeout'])('settles %s without accepting a valid-looking partial IP', async kind => {
    const f = fixture((response, request) => {
      response.write(Buffer.from('203.0.113.10'));
      if (kind === 'error') response.emit('error', new Error('connection reset'));
      else if (kind === 'timeout') request.emit('timeout');
      else response.emit(kind);
    });
    expect(await f.transport.verifyEgressIp()).toMatchObject({ status: 'UNAVAILABLE', lastVerifiedEgressIp: null });
    expect(() => f.transport.assertTestnetExchangeWrite()).toThrow('TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['proxy route', 'success'], ['proxy route', 'failure'],
    ['expected IP', 'success'], ['expected IP', 'failure'],
    ['same config', 'failure'], ['expected IP ABA', 'failure'],
  ])('does not overwrite newer proof after changing %s and receiving old %s', async (change, completion) => {
    const replies: Response[] = [];
    const f = fixture(response => { replies.push(response); });
    const oldFlight = f.transport.verifyEgressIp();
    await new Promise<void>(resolve => setImmediate(resolve));
    const updated = { ...f.config, proxy: { ...f.config.proxy,
      ...(change === 'proxy route' ? { url: `socks5h://127.0.0.1:${nextPort++}` } : {}),
      ...(change === 'expected IP' || change === 'expected IP ABA' ? { expectedStaticEgressIp: '203.0.113.11' } : {}),
    } };
    f.transport.reconfigure(updated as never);
    if (change === 'expected IP ABA') f.transport.reconfigure(f.config as never);
    const newFlight = f.transport.verifyEgressIp();
    await new Promise<void>(resolve => setImmediate(resolve));
    replies[1]!.finish(Buffer.from(change === 'expected IP' ? '203.0.113.11' : '203.0.113.10'));
    const proof = await newFlight;
    expect(proof.status).toBe('VERIFIED');
    vi.spyOn(Date, 'now').mockReturnValue(proof.lastVerifiedAt! + 1000);
    if (completion === 'success') replies[0]!.finish(Buffer.from('203.0.113.10'));
    else replies[0]!.emit('error', new Error('old connection reset'));
    expect(await oldFlight).toEqual(proof);
    expect(f.transport.egressStatus()).toEqual(proof);
    expect(() => f.transport.assertTestnetExchangeWrite()).not.toThrow();
  });

  it('carries an existing proof on identical settings without accepting an old in-flight failure', async () => {
    const replies: Response[] = [];
    const f = fixture(response => { replies.push(response); });
    const initial = f.transport.verifyEgressIp();
    await new Promise<void>(resolve => setImmediate(resolve));
    replies[0]!.finish(Buffer.from('203.0.113.10'));
    const proof = await initial;
    const stale = f.transport.verifyEgressIp();
    await new Promise<void>(resolve => setImmediate(resolve));
    f.transport.reconfigure(f.config as never);
    expect(f.transport.egressStatus()).toEqual(proof);
    replies[1]!.emit('aborted');
    expect(await stale).toEqual(proof);
    expect(f.transport.egressStatus()).toEqual(proof);
  });
});

/** Set server headers before the request callback runs, matching node:https. */
function headerReply(headers: Record<string, string>, status = 200) {
  const previous = requestMock.getMockImplementation()!;
  requestMock.mockImplementation(((url: URL, options: any, callback: any) =>
    (previous as any)(url, options, (response: Response) => {
      response.headers = headers; response.statusCode = status; callback(response);
    })) as never);
}
