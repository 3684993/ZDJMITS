import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { binanceJsonTimeoutMs, readBinanceJsonBody } from './binanceJsonResponse.js';

class Response extends PassThrough {
  headers: Record<string, string> = {};
  complete = false;
  asIncoming() { return this as unknown as IncomingMessage; }
  finish(body: Buffer) { this.complete = true; this.end(body); }
}

describe('bounded Binance JSON body', () => {
  it.each(['identity', 'gzip'])('reads complete %s bodies as strict UTF-8', async encoding => {
    const value = JSON.stringify({ symbols: [{ symbol: 'BTCUSDT', name: '比特币' }] });
    const bytes = encoding === 'gzip' ? gzipSync(value) : Buffer.from(value);
    const response = new Response();
    response.headers = { 'content-encoding': encoding, 'content-length': String(bytes.length) };
    const body = readBinanceJsonBody(response.asIncoming());
    response.write(bytes.subarray(0, 5));
    response.finish(bytes.subarray(5));
    expect(await body).toBe(value);
  });

  it.each(['damaged', 'truncated'])('rejects %s gzip even when HTTP framing completed', async kind => {
    const response = new Response(); response.headers = { 'content-encoding': 'gzip' };
    const encoded = gzipSync('{"symbols":[]}');
    const bytes = kind === 'truncated' ? encoded.subarray(0, -5) : Buffer.from(encoded);
    if (kind === 'damaged') bytes[bytes.length - 5] ^= 0xff;
    const result = readBinanceJsonBody(response.asIncoming());
    response.finish(bytes);
    await expect(result).rejects.toThrow('BINANCE_RESPONSE_GZIP_INVALID');
  });

  it('limits decompression inside zlib, independent of small wire size', async () => {
    const response = new Response(); response.headers = { 'content-encoding': 'gzip' };
    const result = readBinanceJsonBody(response.asIncoming(), { maxWireBytes: 1024, maxDecodedBytes: 128 });
    response.finish(gzipSync('x'.repeat(8192)));
    await expect(result).rejects.toThrow('BINANCE_RESPONSE_DECODED_TOO_LARGE');
  });

  it('rejects a declared wire body above the cap without buffering it', async () => {
    const response = new Response(); response.headers = { 'content-length': '129' };
    await expect(readBinanceJsonBody(response.asIncoming(), { maxWireBytes: 128 })).rejects.toThrow('BINANCE_RESPONSE_WIRE_TOO_LARGE');
    expect(response.destroyed).toBe(true);
  });

  it('also caps chunked bodies without Content-Length', async () => {
    const response = new Response();
    const result = readBinanceJsonBody(response.asIncoming(), { maxWireBytes: 8 });
    response.write(Buffer.alloc(9));
    await expect(result).rejects.toThrow('BINANCE_RESPONSE_WIRE_TOO_LARGE');
    expect(response.destroyed).toBe(true);
  });

  it('rejects Content-Length disagreement rather than accepting a valid JSON prefix', async () => {
    const response = new Response(); response.headers = { 'content-length': '100' };
    const result = readBinanceJsonBody(response.asIncoming()); response.finish(Buffer.from('{}'));
    await expect(result).rejects.toThrow('BINANCE_RESPONSE_CONTENT_LENGTH_MISMATCH');
  });

  it.each(['aborted', 'error', 'close', 'incomplete-end'])('settles and rejects a %s response', async kind => {
    const response = new Response(); const result = readBinanceJsonBody(response.asIncoming());
    response.write(Buffer.from('{"partial":'));
    if (kind === 'incomplete-end') response.end();
    else if (kind === 'error') response.emit('error', new Error('connection reset'));
    else response.emit(kind);
    await expect(result).rejects.toThrow(/BINANCE_RESPONSE_(ABORTED|STREAM_ERROR|TRUNCATED)/);
  });

  it('refuses unsupported encodings rather than parsing compressed bytes as JSON', async () => {
    const response = new Response(); response.headers = { 'content-encoding': 'br' };
    await expect(readBinanceJsonBody(response.asIncoming())).rejects.toThrow('BINANCE_RESPONSE_ENCODING_UNSUPPORTED');
  });

  it('refuses invalid UTF-8 rather than silently replacing source bytes', async () => {
    const response = new Response(); const result = readBinanceJsonBody(response.asIncoming());
    response.finish(Buffer.from([0xff]));
    await expect(result).rejects.toThrow('BINANCE_RESPONSE_UTF8_INVALID');
  });
});

describe('endpoint-specific transport budget', () => {
  const url = (path: string) => new URL(path, 'https://demo-fapi.binance.com');
  it('extends only exchangeInfo GET and preserves explicit budgets', () => {
    expect(binanceJsonTimeoutMs(url('/fapi/v1/exchangeInfo'), 'GET')).toBe(30_000);
    expect(binanceJsonTimeoutMs(url('/fapi/v1/exchangeInfo'), 'POST')).toBe(15_000);
    expect(binanceJsonTimeoutMs(url('/fapi/v1/exchangeInfo'), 'GET', 1234)).toBe(1234);
    expect(binanceJsonTimeoutMs(url('/fapi/v1/order'), 'POST')).toBe(15_000);
    expect(binanceJsonTimeoutMs(url('/fapi/v1/order'), 'POST', 2000)).toBe(2000);
    expect(binanceJsonTimeoutMs(url('/fapi/v2/account'), 'GET')).toBe(15_000);
  });
});
