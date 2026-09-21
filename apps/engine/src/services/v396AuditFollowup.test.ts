import {describe,expect,it,vi} from 'vitest';
import {executionScope} from './executionLifecycle.js';
import {canonicalScope} from './v396OfflineStages.js';
import {createHistoryReadBudget, readHistoryWindows} from '../adapters/exchange/historyWindow.js';
import {ExternalTradeAdapter} from '../adapters/exchange/ExternalTradeAdapter.js';

/** Follow-up boundary cases added by the completion audit: claim identity and read cost. */
describe('persisted claim identity',()=>{
  it('keeps the vocabulary that already-occupied journals were written with',()=>{
    expect(executionScope('TESTNET','a','btcusdt','ENTRY')).toBe('["TESTNET","a","BTCUSDT","ENTRY"]');
    expect(executionScope('TESTNET','a','btcusdt','ENTRY')).not.toBe(executionScope('TESTNET','a','btcusdt','BOTH'));
    expect(executionScope('TESTNET','a','btcusdt','LONG')).toBe(executionScope('TESTNET','a','btcusdt','LONG'));
  });

  it('refuses to mint a new claim identity from a mistyped side',()=>{
    for(const side of ['entry','Entry','BUY','SELL','both','','LONG ',undefined,null,'0']){
      expect(()=>executionScope('TESTNET','a','btcusdt',side as any)).toThrow('EXECUTION_SCOPE_SIDE_UNSUPPORTED');
    }
  });

  it('agrees with the contract scope for every real position side, so a migration is 1:1',()=>{
    for(const positionSide of ['LONG','SHORT','BOTH'] as const){
      expect(executionScope('TESTNET','a','btcusdt',positionSide))
        .toBe(canonicalScope({environment:'TESTNET',accountId:'a',symbol:'BTCUSDT',positionSide}));
    }
    expect(()=>canonicalScope({environment:'TESTNET',accountId:'a',symbol:'BTCUSDT',positionSide:'ENTRY' as any})).toThrow('INVALID_SCOPE');
  });
});

describe('shared history read budget',()=>{
  it('refuses requests once the rolling allowance is spent and refills after the interval',()=>{
    let clock=0;
    const budget=createHistoryReadBudget({capacity:3,intervalMs:1_000,now:()=>clock});
    expect([budget.tryConsume(),budget.tryConsume(),budget.tryConsume(),budget.tryConsume()]).toEqual([true,true,true,false]);
    expect(budget.used()).toBe(3);
    expect(budget.capacity()).toBe(3);
    expect(budget.rejected()).toBe(1);
    clock=1_000;
    expect(budget.tryConsume()).toBe(true);
    expect(budget.used()).toBe(1);
  });

  it('stops a windowed read mid-flight instead of returning a silently partial result',async()=>{
    const budget=createHistoryReadBudget({capacity:2,intervalMs:60_000});
    const read=vi.fn(async()=>[]);
    const day=86_400_000;
    await expect(readHistoryWindows(0,100*day,read,row=>String(row.id??''),200,budget)).rejects.toThrow('HISTORY_REQUEST_BUDGET_EXCEEDED');
    expect(read).toHaveBeenCalledTimes(2);
    expect(budget.rejected()).toBe(1);
  });

  it('bounds the cost of an 80-day proof and fails closed for the next symbol',async()=>{
    const day=86_400_000, calls:string[]=[];
    const transport:any={effectiveBaseUrl:()=>'https://demo-fapi.binance.com',environment:()=>'TESTNET',executionMode:()=>'TESTNET_ENABLED',assertTestnetExchangeWrite:()=>{},entryBlockReason:()=>null,json:vi.fn(async(url:string)=>{calls.push(url.split('?')[0]);if(url.startsWith('/fapi/v1/time'))return{serverTime:Date.now()};return[];})};
    const adapter=new ExternalTradeAdapter(transport,{apiKey:'k',apiSecret:'s'});
    const end=Date.now(),start=end-79*day;
    const first=await adapter.fetchSymbolRiskFacts('BTCUSDT',start,end);
    expect(first.coverageComplete).toBe(true);
    const afterFirst=calls.length;
    expect(afterFirst).toBeLessThanOrEqual(60);
    await expect(adapter.fetchSymbolRiskFacts('ETHUSDT',start,end)).rejects.toThrow('HISTORY_REQUEST_BUDGET_EXCEEDED');
    expect(adapter.historyBudgetMetrics().rejected).toBeGreaterThan(0);
    expect(calls.length-afterFirst).toBeLessThan(20);
  });

  it('declares coverage incomplete beyond the archived-history guard',async()=>{
    const day=86_400_000;
    const transport:any={effectiveBaseUrl:()=>'https://demo-fapi.binance.com',environment:()=>'TESTNET',executionMode:()=>'TESTNET_ENABLED',assertTestnetExchangeWrite:()=>{},entryBlockReason:()=>null,json:vi.fn(async(url:string)=>url.startsWith('/fapi/v1/time')?{serverTime:Date.now()}:[])};
    const adapter=new ExternalTradeAdapter(transport,{apiKey:'k',apiSecret:'s'});
    const end=Date.now();
    const stale=await adapter.fetchSymbolRiskFacts('BTCUSDT',end-120*day,end);
    expect(stale).toMatchObject({coverageComplete:false,coverageStart:end-120*day});
  });

  it('leaves the once-per-sweep account trade audit unbudgeted',async()=>{
    const transport:any={effectiveBaseUrl:()=>'https://demo-fapi.binance.com',environment:()=>'TESTNET',executionMode:()=>'TESTNET_ENABLED',assertTestnetExchangeWrite:()=>{},entryBlockReason:()=>null,json:vi.fn(async(url:string)=>url.startsWith('/fapi/v1/time')?{serverTime:Date.now()}:[])};
    const adapter=new ExternalTradeAdapter(transport,{apiKey:'k',apiSecret:'s'});
    const symbols=Array.from({length:40},(_,index)=>`S${String(index).padStart(2,'0')}USDT`);
    await adapter.fetchRecentTradeAudit(1,2,500,symbols);
    expect(adapter.historyBudgetMetrics()).toMatchObject({used:0,rejected:0});
  });
});
