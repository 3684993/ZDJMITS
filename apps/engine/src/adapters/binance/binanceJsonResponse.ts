import type { IncomingMessage } from 'node:http';
import { gunzip } from 'node:zlib';

// The observed exchangeInfo document is about 0.9 MiB (39 KiB gzip). These
// limits bound both the network buffer and decompression without trusting its headers.
export const BINANCE_JSON_MAX_WIRE_BYTES = 4 * 1024 * 1024;
export const BINANCE_JSON_MAX_DECODED_BYTES = 8 * 1024 * 1024;

export function binanceJsonTimeoutMs(url: URL, method: string, explicit?: number) {
  return explicit ?? (method === 'GET' && url.pathname === '/fapi/v1/exchangeInfo' ? 30_000 : 15_000);
}

type BodyOptions = {
  maxWireBytes?: number;
  maxDecodedBytes?: number;
  onProgress?: (wireBytes: number) => void;
};

/** Binary collection is mandatory: setting UTF-8 on a gzip stream corrupts it. */
export function readBinanceJsonBody(response: IncomingMessage, options: BodyOptions = {}): Promise<string> {
  const maxWireBytes = options.maxWireBytes ?? BINANCE_JSON_MAX_WIRE_BYTES;
  const maxDecodedBytes = options.maxDecodedBytes ?? BINANCE_JSON_MAX_DECODED_BYTES;
  return new Promise((resolve, reject) => {
    let settled = false, ended = false, wireBytes = 0;
    const chunks: Buffer[] = [];
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      response.destroy();
      reject(new Error(reason));
    };
    const finish = (decoded: Buffer) => {
      if (settled) return;
      if (decoded.length > maxDecodedBytes) return fail('BINANCE_RESPONSE_DECODED_TOO_LARGE');
      let body: string;
      try { body = new TextDecoder('utf-8', { fatal: true }).decode(decoded); }
      catch { return fail('BINANCE_RESPONSE_UTF8_INVALID'); }
      settled = true;
      resolve(body);
    };
    response.on('error', () => fail('BINANCE_RESPONSE_STREAM_ERROR'));
    response.once('aborted', () => fail('BINANCE_RESPONSE_ABORTED'));
    response.once('close', () => { if (!ended) fail('BINANCE_RESPONSE_TRUNCATED'); });
    const encoding = String(response.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
    if (!['identity', 'gzip'].includes(encoding)) return fail('BINANCE_RESPONSE_ENCODING_UNSUPPORTED');
    const lengthHeader = response.headers['content-length'];
    if (lengthHeader !== undefined && (typeof lengthHeader !== 'string' || !/^\d+$/.test(lengthHeader)))
      return fail('BINANCE_RESPONSE_CONTENT_LENGTH_INVALID');
    const expectedBytes = lengthHeader === undefined ? null : Number(lengthHeader);
    if (expectedBytes !== null && (!Number.isSafeInteger(expectedBytes) || expectedBytes > maxWireBytes))
      return fail('BINANCE_RESPONSE_WIRE_TOO_LARGE');
    response.on('data', (chunk: Buffer) => {
      if (settled) return;
      if (!Buffer.isBuffer(chunk)) return fail('BINANCE_RESPONSE_BINARY_REQUIRED');
      wireBytes += chunk.length;
      options.onProgress?.(wireBytes);
      if (wireBytes > maxWireBytes) return fail('BINANCE_RESPONSE_WIRE_TOO_LARGE');
      chunks.push(chunk);
    });
    response.once('end', () => {
      ended = true;
      if (settled) return;
      if (!response.complete) return fail('BINANCE_RESPONSE_TRUNCATED');
      if (expectedBytes !== null && wireBytes !== expectedBytes) return fail('BINANCE_RESPONSE_CONTENT_LENGTH_MISMATCH');
      const encoded = Buffer.concat(chunks, wireBytes);
      chunks.length = 0;
      if (encoding === 'identity') return finish(encoded);
      // maxOutputLength is enforced inside zlib, before an oversized decoded
      // Buffer can be returned; the wire cap alone cannot bound a gzip bomb.
      gunzip(encoded, { maxOutputLength: maxDecodedBytes }, (error, decoded) => {
        if (error) return fail((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
          ? 'BINANCE_RESPONSE_DECODED_TOO_LARGE' : 'BINANCE_RESPONSE_GZIP_INVALID');
        finish(decoded);
      });
    });
  });
}
