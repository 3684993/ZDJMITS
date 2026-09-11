import { binanceRequestBudget } from './requestBudget.js';
import https from 'node:https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ConnectionSettings } from '@zdj/contracts';

export class BinanceTransport {
  private readonly agent: SocksProxyAgent | null;
  constructor(private readonly settings: ConnectionSettings) {
    if (settings.proxy.enabled) this.agent = new SocksProxyAgent(settings.proxy.url);
    else this.agent = null;
  }
  effectiveBaseUrl() { return this.settings.exchange.environment === 'TESTNET' ? this.settings.exchange.testnetBaseUrl : this.settings.exchange.productionBaseUrl; }
  environment(){return this.settings.exchange.environment;}
  restRoute(){const direct=this.settings.proxy.binanceRestRoute==='DIRECT';return{mode:direct?'DIRECT':'CONFIGURED',throughProxy:!direct&&Boolean(this.agent),host:new URL(this.effectiveBaseUrl()).hostname};}
  private restAgent(){if(this.settings.proxy.binanceRestRoute==='DIRECT'){if(this.settings.proxy.forceBinanceRest)throw new Error('REST_ROUTE_CONFLICT: direct route cannot force proxy');return undefined;}return this.agent??undefined;}
  executionMode(){return this.settings.executionMode;}
  assertTestnetExchangeWrite(){const url=new URL(this.effectiveBaseUrl());if(this.settings.exchange.environment!=='TESTNET'||this.settings.executionMode!=='TESTNET_ENABLED'||url.hostname!=='testnet.binancefuture.com')throw new Error('TESTNET_ONLY_WRITE_LOCK: production/private exchange write disabled');}
  effectiveWsUrl() { return this.settings.exchange.environment === 'TESTNET' ? 'wss://stream.binancefuture.com/ws' : 'wss://fstream.binance.com/ws'; }
  websocketOptions() { if (this.settings.proxy.forceBinanceWs && !this.agent) throw new Error('PROXY_UNAVAILABLE: Binance WS is configured fail-closed'); return { agent: this.settings.proxy.forceBinanceWs ? this.agent ?? undefined : undefined }; }
  websocketRoute(){return{url:this.effectiveWsUrl(),throughProxy:Boolean(this.settings.proxy.forceBinanceWs&&this.agent),proxyUrl:this.settings.proxy.forceBinanceWs?this.settings.proxy.url:null,tlsServername:new URL(this.effectiveWsUrl()).hostname};}
  private assertBinance(url: URL) { if (!(url.hostname==='binance.com'||url.hostname.endsWith('.binance.com')) && !(url.hostname==='binancefuture.com'||url.hostname.endsWith('.binancefuture.com'))) throw new Error(`Refusing non-Binance transport host: ${url.hostname}`); if (this.settings.proxy.forceBinanceRest && !this.agent) throw new Error('PROXY_UNAVAILABLE: Binance REST is configured fail-closed'); }
  async json<T>(pathOrUrl: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<T> {
    const url = new URL(pathOrUrl, this.effectiveBaseUrl()); this.assertBinance(url);
    const priority=url.pathname==='/fapi/v1/time'?0:(url.searchParams.has('signature')||Boolean(init.headers?.['X-MBX-APIKEY']))?(url.pathname.includes('/income')?1:0):2;
    return binanceRequestBudget.run(priority,()=>new Promise<T>((resolve, reject) => {
      const timeoutMs=init.timeoutMs??15_000;
      const request = https.request(url, { method: init.method ?? 'GET', headers: { 'user-agent': 'zdj-mits-v3/3.9', ...init.headers }, agent: this.restAgent(), timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) }, response => {
        binanceRequestBudget.observe(response.statusCode??500,response.headers['x-mbx-used-weight-1m'] as string|undefined,response.headers['retry-after'] as string|undefined);
        let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; }); response.on('end', () => {
          if ((response.statusCode ?? 500) >= 400) return reject(new Error(`Binance HTTP ${response.statusCode}: ${body.slice(0, 512)}`));
          try { resolve(JSON.parse(body) as T); } catch { reject(new Error('Binance returned invalid JSON')); }
        });
      });
      request.once('timeout', () => request.destroy(new Error('Binance request timed out'))); request.once('error', error => reject(new Error(`BINANCE_TRANSPORT_BLOCKED: ${error.name==='AbortError'?'Binance request timed out':error.message}`))); request.end(init.body);
    }));
  }
  async health() { const startedAt = Date.now(); const serverTime = await this.json<{ serverTime: number }>('/fapi/v1/time'); return { status: 'HEALTHY' as const, latencyMs: Date.now() - startedAt, serverTime, effectiveBaseUrl: this.effectiveBaseUrl(), throughProxy: this.restRoute().throughProxy,route:this.restRoute() }; }
}
