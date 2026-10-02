import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceTransport } from './BinanceTransport.js';
import { ExternalTradeAdapter } from '../exchange/ExternalTradeAdapter.js';
import { EntryDispatchGuardRejectedError, EntryExecutionExpiredBeforeDispatchError, entryDispatchDeadline } from './entryDispatchDeadline.js';

// No test contacts an exchange. Intercept the actual HTTP boundary, including reads.
vi.mock('node:https', () => ({ default: { request: vi.fn() } }));
const request = vi.mocked(https.request);
let port = 25500;
const NOW = 1_800_000_000_000;

function fixture() {
  let now = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const transport = new BinanceTransport({ executionMode: 'TESTNET_ENABLED',
    exchange: { environment: 'TESTNET', testnetBaseUrl: 'https://demo-fapi.binance.com', testnetRestBaseUrl: 'https://demo-fapi.binance.com' },
    proxy: { enabled: true, url: `socks5h://127.0.0.1:${port++}`, forceBinanceRest: true,
      forceBinanceWs: true, proxyDns: true, failClosed: true },
  } as never);
  const calls: Array<{ path: string; method: string; at: number }> = [];
  let queue: (meta: any) => void = () => {};
  let reply: (path: string, method: string) => void = () => {};
  vi.spyOn((transport as any).budget, 'run').mockImplementation(async (_priority: any, _weight: any, run: any, meta: any) => {
    queue(meta); return run();
  });
  request.mockImplementation(((url: URL, options: any, callback: any) => {
    calls.push({ path: url.pathname, method: options.method, at: now });
    const req: any = new EventEmitter();
    req.destroy = vi.fn();
    req.end = () => queueMicrotask(() => {
      const response: any = new PassThrough(); response.headers = {}; response.statusCode = 200; response.complete = true;
      reply(url.pathname, options.method);
      const payload = url.pathname.endsWith('/time') ? { serverTime: now }
        : url.pathname.endsWith('/positionSide/dual') ? { dualSidePosition: true }
        : { orderId: 12, clientOrderId: 'ML_CLOCK', status: 'NEW', origQty: '1', executedQty: '0', price: '100' };
      callback(response); response.end(JSON.stringify(payload));
    });
    return req;
  }) as never);
  const adapter = new ExternalTradeAdapter(transport, { apiKey: 'test-key', apiSecret: 'test-secret' });
  const order: any = { id: 'entry_clock', clientOrderId: 'ML_CLOCK', exchangeOrderId: '12', symbol: 'BTCUSDT', side: 'LONG',
    quantity: 1, price: 100, leverage: 10, filledQuantity: 0, status: 'NEW', createdAt: NOW, updatedAt: NOW,
    absoluteExpiresAt: NOW + 120_000, decisionCompletedAt: NOW, decisionExecutionExpiresAt: NOW + 60_000,
    repriceCount: 0, intentId: 'intent_clock', reachability: 1 };
  return { transport, adapter, calls, order, setTime: (value: number) => { now = value; },
    onQueue: (fn: typeof queue) => { queue = fn; }, onReply: (fn: typeof reply) => { reply = fn; } };
}

beforeEach(() => request.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('decision execution deadline at the actual HTTP dispatch boundary', () => {
  it.each(['POST', 'PUT'])('refuses %s when the request budget queue crosses the deadline', async method => {
    const h = fixture();
    h.onQueue(() => h.setTime(NOW + 60_000));
    const error = await h.transport.json('/fapi/v1/order', { method, purpose: 'NEW_ENTRY',
      entryExecutionExpiresAt: NOW + 60_000 }).catch(error => error);
    expect(error).toBeInstanceOf(EntryExecutionExpiredBeforeDispatchError);
    expect(error).toMatchObject({ message: 'ENTRY_DECISION_EXECUTION_EXPIRED', wireAttempted: false });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([59_999, 60_000])('uses an exclusive absolute deadline at +%sms', async elapsed => {
    const h = fixture(); h.setTime(NOW + elapsed);
    const result = await h.transport.json<{ orderId: number }>('/fapi/v1/order', { method: 'POST', purpose: 'NEW_ENTRY',
      entryExecutionExpiresAt: NOW + 60_000 }).catch(error => error);
    if (elapsed < 60_000) { expect(result.orderId).toBe(12); expect(request).toHaveBeenCalledOnce(); }
    else { expect(result).toBeInstanceOf(EntryExecutionExpiredBeforeDispatchError); expect(request).not.toHaveBeenCalled(); }
  });

  it.each([NaN, Infinity, -Infinity, null, '1800000060000'])('rejects invalid provided clock %s before dispatch', async value => {
    const h = fixture();
    await expect(h.transport.json('/fapi/v1/order', { method: 'POST', purpose: 'NEW_ENTRY',
      entryExecutionExpiresAt: value as any })).rejects.toBeInstanceOf(EntryExecutionExpiredBeforeDispatchError);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', 'NEW_ENTRY'], ['DELETE', 'NEW_ENTRY'], ['POST', undefined], ['PUT', 'USER_DATA_STREAM'],
  ])('leaves %s / %s maintenance outside the decision clock', async (method, purpose) => {
    const h = fixture();
    await expect(h.transport.json('/fapi/v1/order', { method, purpose,
      entryExecutionExpiresAt: NOW - 1 })).resolves.toMatchObject({ orderId: 12 });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each(['place', 'replace'])('does not invent a new clock for legacy %s', async action => {
    const h = fixture(); delete h.order.decisionExecutionExpiresAt; delete h.order.decisionCompletedAt;
    h.order.absoluteExpiresAt = 2;
    const result = action === 'place' ? await h.adapter.placeEntry(h.order) : await h.adapter.replaceEntry(h.order, 100);
    expect(result.exchangeOrderId).toBe('12');
    expect(h.calls.filter(row => ['POST', 'PUT'].includes(row.method))).toHaveLength(1);
  });

  it('preserves the absolute clock while hedge-mode discovery delays a place', async () => {
    const h = fixture(); h.onReply(path => { if (path.endsWith('/positionSide/dual')) h.setTime(NOW + 60_000); });
    await expect(h.adapter.placeEntry(h.order)).rejects.toBeInstanceOf(EntryExecutionExpiredBeforeDispatchError);
    expect(h.calls.some(row => row.path.endsWith('/positionSide/dual'))).toBe(true);
    expect(h.calls.filter(row => ['POST', 'PUT'].includes(row.method))).toEqual([]);
  });

  it.each(['place', 'replace'])('preserves the absolute clock while server-time refresh delays %s', async action => {
    const h = fixture(); h.onReply(path => { if (path.endsWith('/time')) h.setTime(NOW + 60_000); });
    const promise = action === 'place' ? h.adapter.placeEntry(h.order) : h.adapter.replaceEntry(h.order, 100);
    await expect(promise).rejects.toBeInstanceOf(EntryExecutionExpiredBeforeDispatchError);
    expect(h.calls.filter(row => ['POST', 'PUT'].includes(row.method))).toEqual([]);
  });

  it.each(['place', 'replace'])('forwards %s clock through signing and refuses after transport queueing', async action => {
    const h = fixture(); h.onQueue(meta => { if (meta.purpose === 'NEW_ENTRY') h.setTime(NOW + 60_000); });
    const promise = action === 'place' ? h.adapter.placeEntry(h.order) : h.adapter.replaceEntry(h.order, 100);
    await expect(promise).rejects.toBeInstanceOf(EntryExecutionExpiredBeforeDispatchError);
    expect(h.calls.filter(row => ['POST', 'PUT'].includes(row.method))).toEqual([]);
  });

  it('honors a shorter order TTL without resetting the decision deadline', async () => {
    const h = fixture(); h.order.absoluteExpiresAt = NOW + 10_000;
    h.onQueue(meta => { if (meta.purpose === 'NEW_ENTRY') h.setTime(NOW + 10_000); });
    await expect(h.adapter.placeEntry(h.order)).rejects.toBeInstanceOf(EntryExecutionExpiredBeforeDispatchError);
    expect(h.order.decisionExecutionExpiresAt).toBe(NOW + 60_000);
    expect(h.calls.filter(row => row.method === 'POST')).toEqual([]);
  });

  it('accepts a real order acknowledgement after the deadline when dispatch was timely', async () => {
    const h = fixture();
    h.onReply((_path, method) => { if (method === 'POST') h.setTime(NOW + 61_000); });
    const placed = await h.adapter.placeEntry(h.order);
    expect(placed).toMatchObject({ status: 'WORKING', exchangeOrderId: '12',
      decisionCompletedAt: NOW, decisionExecutionExpiresAt: NOW + 60_000 });
    expect(h.calls.filter(row => row.method === 'POST')).toEqual([{ path: '/fapi/v1/order', method: 'POST', at: NOW }]);
  });

  it('keeps cancel and TP writes available after an Entry clock expires', async () => {
    const h = fixture(); h.setTime(NOW + 90_000);
    await h.adapter.cancelEntry(h.order);
    await h.adapter.placeTakeProfit({ ...h.order, id: 'tp_clock', positionId: 'p', side: 'SELL' });
    expect(h.calls.filter(row => ['POST', 'DELETE'].includes(row.method)).map(row => row.method)).toEqual(['DELETE', 'POST']);
  });

  it('does not sanitize an invalid persisted decision clock into legacy behavior', () => {
    expect(() => entryDispatchDeadline({ decisionExecutionExpiresAt: NaN, absoluteExpiresAt: NOW })).toThrow(EntryExecutionExpiredBeforeDispatchError);
    expect(() => entryDispatchDeadline({ decisionExecutionExpiresAt: NOW + 60_000, absoluteExpiresAt: NaN })).toThrow(EntryExecutionExpiredBeforeDispatchError);
  });
});

describe('Entry authorization guard at the actual HTTP dispatch boundary',()=>{
  const rejection=()=>new Error('ENTRY_ANALYSIS_CONTEXT_CHANGED');

  it.each(['POST','PUT'])('checks %s after a deferred request-budget wait and proves the refusal was locally unsent',async method=>{
    const h=fixture(),controller=new AbortController();
    let release!:()=>void;
    vi.spyOn((h.transport as any).budget,'run').mockImplementation(async(_priority:any,_weight:any,run:any)=>{
      await new Promise<void>(resolve=>{release=resolve;});return run();
    });
    const guard=vi.fn(()=>controller.signal.throwIfAborted());
    const pending=h.transport.json('/fapi/v1/order',{method,purpose:'NEW_ENTRY',
      entryExecutionExpiresAt:NOW+60_000,entryDispatchGuard:guard}).catch(error=>error);
    expect(guard).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
    controller.abort(rejection());release();
    expect(await pending).toMatchObject({name:'EntryDispatchGuardRejectedError',code:'ENTRY_DISPATCH_GUARD_REJECTED',
      reason:'ENTRY_ANALYSIS_CONTEXT_CHANGED',wireAttempted:false});
    expect(guard).toHaveBeenCalledOnce();expect(request).not.toHaveBeenCalled();
  });

  it('recognizes explicit ENTRY_REPRICE without applying an Entry guard to maintenance',async()=>{
    const h=fixture(),guard=vi.fn(()=>{throw rejection();});
    await expect(h.transport.json('/fapi/v1/order',{method:'PUT',purpose:'ENTRY_REPRICE',entryDispatchGuard:guard}))
      .rejects.toBeInstanceOf(EntryDispatchGuardRejectedError);
    expect(guard).toHaveBeenCalledOnce();expect(request).not.toHaveBeenCalled();
  });

  it.each(['place','replace'] as const)('refuses an already-invalid %s before any preflight read',async action=>{
    const h=fixture(),guard=()=>{throw rejection();};
    const result=action==='place'?h.adapter.placeEntry(h.order,guard):h.adapter.replaceEntry(h.order,100,guard);
    await expect(result).rejects.toMatchObject({code:'ENTRY_DISPATCH_GUARD_REJECTED',wireAttempted:false});
    expect(request).not.toHaveBeenCalled();
  });

  it('rechecks authorization after the deferred hedge-mode read',async()=>{
    const h=fixture(),controller=new AbortController();
    h.onReply(path=>{if(path.endsWith('/positionSide/dual'))controller.abort(rejection());});
    await expect(h.adapter.placeEntry(h.order,()=>controller.signal.throwIfAborted())).rejects.toMatchObject({
      name:'EntryDispatchGuardRejectedError',reason:'ENTRY_ANALYSIS_CONTEXT_CHANGED',wireAttempted:false});
    expect(h.calls.some(row=>row.path.endsWith('/positionSide/dual'))).toBe(true);
    expect(h.calls.filter(row=>['POST','PUT'].includes(row.method))).toEqual([]);
  });

  it.each(['place','replace'] as const)('rechecks %s authorization after server-time refresh before signing the write',async action=>{
    const h=fixture(),controller=new AbortController();
    (h.adapter as any).positionMode={hedge:true,checkedAt:NOW};
    h.onReply(path=>{if(path.endsWith('/time'))controller.abort(rejection());});
    const guard=()=>controller.signal.throwIfAborted();
    await expect(action==='place'?h.adapter.placeEntry(h.order,guard):h.adapter.replaceEntry(h.order,100,guard))
      .rejects.toMatchObject({name:'EntryDispatchGuardRejectedError',wireAttempted:false});
    expect(h.calls.some(row=>row.path.endsWith('/time'))).toBe(true);
    expect(h.calls.filter(row=>['POST','PUT'].includes(row.method))).toEqual([]);
  });

  it.each(['place','replace'] as const)('forwards the %s guard through signing and refuses cancellation in transport queueing',async action=>{
    const h=fixture(),controller=new AbortController();
    h.onQueue(meta=>{if(meta.purpose==='NEW_ENTRY')controller.abort(rejection());});
    const guard=()=>controller.signal.throwIfAborted();
    await expect(action==='place'?h.adapter.placeEntry(h.order,guard):h.adapter.replaceEntry(h.order,100,guard))
      .rejects.toMatchObject({name:'EntryDispatchGuardRejectedError',reason:'ENTRY_ANALYSIS_CONTEXT_CHANGED',wireAttempted:false});
    expect(h.calls.filter(row=>['POST','PUT'].includes(row.method))).toEqual([]);
  });

  it.each(['place','replace'] as const)('retains a real %s ACK when authorization changes after timely dispatch',async action=>{
    const h=fixture(),controller=new AbortController();
    h.onReply((_path,method)=>{if(method==='POST'||method==='PUT')controller.abort(rejection());});
    const guard=()=>controller.signal.throwIfAborted();
    const result=await (action==='place'?h.adapter.placeEntry(h.order,guard):h.adapter.replaceEntry(h.order,100,guard));
    expect(result).toMatchObject({status:'WORKING',exchangeOrderId:'12'});
    expect(h.calls.filter(row=>['POST','PUT'].includes(row.method))).toHaveLength(1);
    const [url,options]=request.mock.calls.find(([,options])=>['POST','PUT'].includes((options as any).method))!;
    expect(String(url)).not.toContain('DispatchGuard');expect(options).not.toHaveProperty('entryDispatchGuard');
  });

  it('does not label a dispatched network failure as a locally unsent guard refusal',async()=>{
    const h=fixture(),controller=new AbortController(),original=request.getMockImplementation()!;
    request.mockImplementation(((url:URL,options:any,callback:any)=>{
      if(options.method!=='POST')return (original as any)(url,options,callback);
      const req:any=new EventEmitter();req.destroy=vi.fn();
      req.end=()=>queueMicrotask(()=>{
        controller.abort(rejection());
        req.emit('error',Object.assign(new Error('socket failed after dispatch'),{code:'ECONNRESET'}));
      });return req;
    }) as never);
    const error=await h.adapter.placeEntry(h.order,()=>controller.signal.throwIfAborted()).catch(error=>error);
    expect(error).not.toBeInstanceOf(EntryDispatchGuardRejectedError);
    expect(error.message).toContain('ECONNRESET');expect(error).not.toHaveProperty('wireAttempted',false);
    expect(request.mock.calls.filter(([,options])=>(options as any).method==='POST')).toHaveLength(1);
  });

  it.each([['GET','NEW_ENTRY'],['DELETE','NEW_ENTRY'],['POST',undefined],['PUT','USER_DATA_STREAM']] as const)
  ('does not apply an Entry callback to %s / %s maintenance',async(method,purpose)=>{
    const h=fixture(),guard=vi.fn(()=>{throw rejection();});
    await expect(h.transport.json('/fapi/v1/order',{method,purpose,entryDispatchGuard:guard})).resolves.toMatchObject({orderId:12});
    expect(guard).not.toHaveBeenCalled();expect(request).toHaveBeenCalledOnce();
  });

  it('refuses an accidental asynchronous guard before request creation and handles its late rejection',async()=>{
    const h=fixture();
    await expect(h.transport.json('/fapi/v1/order',{method:'POST',purpose:'NEW_ENTRY',entryDispatchGuard:async()=>{throw rejection();}}))
      .rejects.toMatchObject({name:'EntryDispatchGuardRejectedError',reason:'ASYNC_ENTRY_DISPATCH_GUARD_UNSUPPORTED',wireAttempted:false});
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps the absolute execution deadline exclusive even if a successful synchronous guard consumes time',async()=>{
    const h=fixture();
    await expect(h.transport.json('/fapi/v1/order',{method:'POST',purpose:'NEW_ENTRY',entryExecutionExpiresAt:NOW+60_000,
      entryDispatchGuard:()=>h.setTime(NOW+60_000)})).rejects.toBeInstanceOf(EntryExecutionExpiredBeforeDispatchError);
    expect(request).not.toHaveBeenCalled();
  });
});
