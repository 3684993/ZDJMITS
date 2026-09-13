import { describe, expect, it, vi } from "vitest";
import { BinancePublicMarketDataProvider } from "./BinancePublicMarketDataProvider.js";

it('advances all three closed frames during a REST outage without crossing frame histories',()=>{
 const provider=new BinancePublicMarketDataProvider({json:vi.fn(()=>Promise.reject(new Error('418')))} as any),stream=(provider as any).stream,now=Date.now();
 let snapshot:any={symbol:'BTCUSDT',technical:{}};
 for(const [tf,period,count]of [['1m',60000,81],['5m',300000,81],['15m',900000,241]] as const){const end=Math.floor(now/period)*period;const rows=Array.from({length:count},(_,i)=>({openTime:end-(count-i)*period,closeTime:end-(count-i-1)*period-1,open:100+i*.01,high:102+i*.01,low:99+i*.01,close:101+i*.01,volume:100,receivedAt:now,isClosed:true,source:'BINANCE_WS',quoteVolume:10000,trades:10}));stream.seedCandles('BTCUSDT',tf,rows);}
 for(let i=0;i<3;i++)snapshot=provider.hydrateLiveTechnical(snapshot);
 for(const [tf,period]of [['1m',60000],['5m',300000],['15m',900000]] as const)expect(snapshot.technical[tf].barCloseTime).toBe(Math.floor(now/period)*period-1);
 expect(provider.hydrateLiveTechnical(snapshot)).toBe(snapshot);
});

describe("BinancePublicMarketDataProvider live symbols", () => {
  it('collects approved underlyings ahead of the volume slice and reports unavailable assets without starting WS',async()=>{
    const transport={json:vi.fn(async(path:string)=>path==='/fapi/v1/ticker/24hr'?[{symbol:'BTCUSDT',quoteVolume:'100'},{symbol:'SOLUSDT',quoteVolume:'1'}]:path==='/fapi/v1/exchangeInfo'?{symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL'},{symbol:'SOLUSDT',status:'TRADING',contractType:'PERPETUAL'}]}:[])} as any;
    const provider=new BinancePublicMarketDataProvider(transport),start=vi.spyOn((provider as any).stream,'start').mockImplementation(()=>{});
    expect(await provider.listSymbols(1,['SOL','MISSING'])).toEqual(['BTCUSDT','ETHUSDT','SOLUSDT']);
    expect(provider.collectionCoverage()).toEqual([{requested:'SOL',symbol:'SOLUSDT',status:'COLLECTED',reason:null},{requested:'MISSING',symbol:null,status:'UNAVAILABLE',reason:'NO_EXECUTION_MARKET_DATA'}]);
    expect(start).not.toHaveBeenCalled();
  });
  it('collects both available quote contracts for an approved underlying before routing',async()=>{const transport={json:vi.fn(async(path:string)=>path==='/fapi/v1/ticker/24hr'?[{symbol:'BTCUSDT',quoteVolume:'100'},{symbol:'SOLUSDT',quoteVolume:'2'},{symbol:'SOLUSDC',quoteVolume:'1'}]:path==='/fapi/v1/exchangeInfo'?{symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL'},{symbol:'SOLUSDT',status:'TRADING',contractType:'PERPETUAL'},{symbol:'SOLUSDC',status:'TRADING',contractType:'PERPETUAL'}]}:[])} as any;const provider=new BinancePublicMarketDataProvider(transport);const symbols=await provider.listSymbols(1,['SOL']);expect(symbols).toContain('SOLUSDT');expect(symbols).toContain('SOLUSDC');});
  it('does not return an expired WebSocket quote when an independent REST quote is required', async () => {
    const transport={json:vi.fn(async(path:string)=>{if(path==='/fapi/v1/exchangeInfo')return{symbols:[{symbol:'BTCUSDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.1'},{filterType:'LOT_SIZE',minQty:'0.001',stepSize:'0.001'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]};if(path.includes('ticker/24hr'))return{lastPrice:'100',quoteVolume:'10',priceChangePercent:'0',count:1};if(path.includes('premiumIndex'))return{markPrice:'100'};if(path.includes('bookTicker'))return{bidPrice:'99.9',askPrice:'100.1'};return [];})} as any;
    const provider=new BinancePublicMarketDataProvider(transport),stream=(provider as any).stream;vi.spyOn(stream,'quote').mockReturnValue({last:90,mark:90,bid:89,ask:91,ts:Date.now()-15_001});const quote=await provider.getQuote('BTCUSDT');expect(quote).toMatchObject({last:100,mark:100,bid:99.9,ask:100.1});expect(transport.json).toHaveBeenCalledWith('/fapi/v1/ticker/24hr?symbol=BTCUSDT');
  });
  it('rejects missing exchange filters instead of inventing executable rules',async()=>{const transport={json:vi.fn(async(path:string)=>path==='/fapi/v1/exchangeInfo'?{symbols:[{symbol:'BTCUSDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.1'}]}]}:{lastPrice:'100',markPrice:'100',bidPrice:'99',askPrice:'101'})} as any;const provider=new BinancePublicMarketDataProvider(transport);await expect(provider.getQuote('BTCUSDT')).rejects.toThrow('BINANCE_REQUIRED_FILTER_INVALID');});
  it("keeps discovery side-effect free and makes retention the authoritative WS set", async () => {
    const transport={json:vi.fn(async(path:string)=>path==="/fapi/v1/ticker/24hr"?[{symbol:"BTCUSDT",quoteVolume:"20"},{symbol:"ETHUSDT",quoteVolume:"10"},{symbol:"ETHUSDC",quoteVolume:"5"}]:path==="/fapi/v1/exchangeInfo"?{symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL'},{symbol:'ETHUSDT',status:'TRADING',contractType:'PERPETUAL'},{symbol:'ETHUSDC',status:'TRADING',contractType:'PERPETUAL'}]}:[])} as any;
    const provider=new BinancePublicMarketDataProvider(transport),stream=(provider as any).stream,start=vi.spyOn(stream,"start").mockImplementation(()=>{});provider.setLiveSymbols(["ethusdc","PNUTUSDT"]);expect(start).toHaveBeenLastCalledWith(["ETHUSDC","PNUTUSDT"]);await provider.listSymbols(1);expect(start).toHaveBeenCalledTimes(1);provider.setLiveSymbols(["ADAUSDC"]);expect(start).toHaveBeenLastCalledWith(["ADAUSDC"]);expect(start.mock.calls.at(-1)?.[0]).not.toContain("PNUTUSDT");await provider.discoverSymbols(3);expect(start).toHaveBeenCalledTimes(2);
  });
});

it('deduplicates concurrent candles and reloads when an open candle closes',async()=>{
 vi.useFakeTimers();vi.setSystemTime(60_000);let resolve!:(v:any)=>void;const transport={json:vi.fn().mockReturnValueOnce(new Promise(r=>resolve=r)).mockResolvedValue([[0,'1','2','1','2','10',119999,'20',3]])} as any;const provider=new BinancePublicMarketDataProvider(transport);const reads=Array.from({length:20},()=>provider.getCandles('BTCUSDT','1m',1));resolve([[60000,'1','2','1','2','10',119999,'20',3]]);const rows=await Promise.all(reads);expect(transport.json).toHaveBeenCalledTimes(1);expect(rows[0]![0]!.isClosed).toBe(false);await provider.getCandles('BTCUSDT','1m',1);expect(transport.json).toHaveBeenCalledTimes(1);vi.setSystemTime(121001);expect((await provider.getCandles('BTCUSDT','1m',1))[0]!.isClosed).toBe(true);expect(transport.json).toHaveBeenCalledTimes(2);vi.useRealTimers();
});

it('never calls unsupported futures analytics routes on TESTNET and caches derivatives for five minutes',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_000_000);
  const json=vi.fn(async(path:string)=>path.startsWith('/fapi/v1/openInterest')?{openInterest:'123'}:path.startsWith('/fapi/v1/premiumIndex')?{lastFundingRate:'0.001'}:[]),transport={json,environment:()=> 'TESTNET'} as any,provider=new BinancePublicMarketDataProvider(transport);
  const [a,b]=await Promise.all([provider.getDerivatives('BTCUSDT'),provider.getDerivatives('BTCUSDT')]);expect(a.openInterest).toBe(123);expect(b.fundingRate).toBe(.001);expect(json).toHaveBeenCalledTimes(2);expect(json.mock.calls.map(call=>String(call[0])).some(path=>path.startsWith('/futures/data/'))).toBe(false);
  await provider.getDerivatives('BTCUSDT');expect(json).toHaveBeenCalledTimes(2);vi.advanceTimersByTime(300_001);await provider.getDerivatives('BTCUSDT');expect(json).toHaveBeenCalledTimes(4);vi.useRealTimers();
});

it('hydrates a cold snapshot in bounded REST phases with 15m candles first',async()=>{
  let inFlight=0,maxInFlight=0;const calls:string[]=[];
  const json=vi.fn(async(path:string)=>{calls.push(path);inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(resolve=>setTimeout(resolve,1));inFlight--;
    if(path==='/fapi/v1/exchangeInfo')return{symbols:[{symbol:'BTCUSDT',onboardDate:Date.now()-86_400_000,filters:[{filterType:'PRICE_FILTER',tickSize:'0.1'},{filterType:'LOT_SIZE',minQty:'0.001',stepSize:'0.001'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]};
    if(path.includes('/ticker/24hr?'))return{lastPrice:'100',quoteVolume:'100000',priceChangePercent:'1',count:1000};
    if(path.includes('/premiumIndex?'))return{markPrice:'100',lastFundingRate:'0.001'};
    if(path.includes('/ticker/bookTicker?'))return{bidPrice:'99.9',askPrice:'100.1'};
    if(path.includes('/depth?'))return{bids:[['99.9','10']],asks:[['100.1','10']]};
    if(path.includes('/openInterest?'))return{openInterest:'123'};
    if(path.includes('/klines?')){const limit=Number(new URLSearchParams(path.split('?')[1]).get('limit')??80),now=Date.now();return Array.from({length:limit},(_,i)=>[now-(limit-i)*60_000,'100','101','99','100','10',now-(limit-i-1)*60_000-1,'1000',10]);}
    return[];
  });
  const provider=new BinancePublicMarketDataProvider({json,environment:()=> 'TESTNET',streamUrl:()=>'',proxyAgent:()=>undefined,restRoute:()=>({routeIdentity:'test'})} as any),stream=(provider as any).stream;
  vi.spyOn(stream,'quote').mockReturnValue(null);vi.spyOn(stream,'book').mockReturnValue(null);vi.spyOn(stream,'candleSeries').mockReturnValue(null);vi.spyOn(stream,'seedCandles').mockImplementation(()=>{});vi.spyOn(stream,'seed').mockImplementation(()=>{});
  const snapshot=await provider.getSnapshot('BTCUSDT');
  expect(snapshot.technical['15m']).toBeDefined();expect(maxInFlight).toBe(1);
  const klines=calls.filter(path=>path.includes('/klines?'));expect(klines[0]).toContain('interval=15m');
});