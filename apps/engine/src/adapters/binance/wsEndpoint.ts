export type BinanceWsLane = 'PUBLIC' | 'MARKET' | 'PRIVATE';

/** Explicit protocol migration only: no alternate host, direct fallback or geographic retry. */
export function resolveBinanceWsEndpoint(environment: string, configured: string | undefined, lane: BinanceWsLane = 'PUBLIC') {
  const host = environment === 'TESTNET' ? 'demo-fstream.binance.com' : environment === 'PRODUCTION' ? 'fstream.binance.com' : null;
  if (!host) throw new Error('BINANCE_WS_ENVIRONMENT_INVALID');
  if (!['PUBLIC', 'MARKET', 'PRIVATE'].includes(lane)) throw new Error('BINANCE_WS_LANE_INVALID');
  const url = new URL(configured ?? `wss://${host}`);
  if (url.hostname === 'stream.binancefuture.com' || url.hostname === 'fstream.binancefuture.com') throw new Error('BINANCE_WS_LEGACY_CONFIG_REQUIRES_EXPLICIT_MIGRATION');
  if (url.protocol !== 'wss:' || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash) throw new Error('BINANCE_WS_ENVIRONMENT_ORIGIN_MISMATCH');
  if (!/^\/(?:ws\/?|(?:public|market|private)(?:\/ws)?\/?)?$/.test(url.pathname)) throw new Error('BINANCE_WS_BASE_PATH_INVALID');
  return `wss://${host}/${lane.toLowerCase()}/ws`;
}
