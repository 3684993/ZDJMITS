import {describe,expect,it,vi} from 'vitest';
import {ExternalTradeAdapter} from './ExternalTradeAdapter.js';

/**
 * P6 funding income read. /fapi/v1/income answers for the whole account, so one paged read can prove a
 * funding window for every symbol at once. Reading it per held symbol was 3 requests x 40 symbols every
 * ten minutes, which is exactly the kind of background fan-out the private request budget exists to keep
 * from starving the orders that need it.
 */

function harness(pages:Array<Array<Record<string,unknown>>>,environment:'TESTNET'|'PRODUCTION'='TESTNET'){
  const calls:Array<{url:string;method?:string}>=[];
  let page=0;
  const transport={
    effectiveBaseUrl:()=>'https://testnet.binancefuture.com',environment:()=>environment,executionMode:()=>'TESTNET_ENABLED',
    assertTestnetExchangeWrite:()=>{if(environment!=='TESTNET')throw new Error('TESTNET_ONLY_WRITE_LOCK');},
    json:vi.fn(async(url:string,init?:{method?:string})=>{
      calls.push({url,method:init?.method});
      if(url==='/fapi/v1/time'||url.startsWith('/fapi/v1/time'))return{serverTime:1};
      if(url.startsWith('/fapi/v1/income'))return pages[Math.min(page++,pages.length-1)]??[];
      return{};
    }),
  };
  return{adapter:new ExternalTradeAdapter(transport as never,{apiKey:'key',apiSecret:'secret'},5000),calls};
}

const fee=(symbol:string,time:number,income:number,asset='USDT',incomeType='FUNDING_FEE')=>({symbol,incomeType,income,asset,time,tranId:`t_${symbol}_${time}`});
// The exchange only answers for the last 80 days, so a proof window has to be recent to be complete.
const windowEnd=Date.now()-60_000,windowStart=windowEnd-3600_000;
const at=(offset:number)=>windowStart+offset;
const fillPage=(count:number)=>Array.from({length:count},(_,index)=>fee(`SYM${index}USDT`,at(index),-.001));

describe('P6 account-level funding income read',()=>{
  it('reads once for the whole account with no symbol parameter',async()=>{
    const h=harness([[fee('BTCUSDT',at(500),-.05),fee('ETHUSDT',at(600),.02)]]);
    const result=await h.adapter.fetchFundingIncome(windowStart,windowEnd);
    const incomeCall=h.calls.find(call=>call.url.startsWith('/fapi/v1/income'))!;
    expect(incomeCall.url).toContain('incomeType=FUNDING_FEE');
    expect(incomeCall.url).not.toContain('symbol=');
    expect(incomeCall.method).toBe('GET');
    expect(result).toMatchObject({complete:true,pages:1,coverageStart:windowStart,coverageEnd:windowEnd});
    expect(result.rows.map(row=>row.symbol)).toEqual(['BTCUSDT','ETHUSDT']);
  });

  it('keeps only funding rows inside the window',async()=>{
    const h=harness([[fee('BTCUSDT',at(500),-.05),{...fee('BTCUSDT',at(600),0),incomeType:'COMMISSION'},
      fee('BTCUSDT',windowStart-1,-.01),fee('BTCUSDT',windowEnd+1,-.01)]]);
    const result=await h.adapter.fetchFundingIncome(windowStart,windowEnd);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({symbol:'BTCUSDT',incomeType:'FUNDING_FEE',income:-.05,transactionId:`t_BTCUSDT_${at(500)}`});
  });

  it('pages until a short page and reports the pages it read',async()=>{
    const h=harness([fillPage(1000),[fee('BTCUSDT',at(999),-.01)]]);
    const result=await h.adapter.fetchFundingIncome(windowStart,windowEnd);
    expect(result).toMatchObject({pages:2,complete:true});
    expect(result.rows).toHaveLength(1001);
  });

  it('calls a truncated read incomplete instead of claiming coverage',async()=>{
    const h=harness(Array.from({length:20},()=>fillPage(1000)));
    const result=await h.adapter.fetchFundingIncome(windowStart,windowEnd,20);
    expect(result.complete).toBe(false);
    expect(result.pages).toBe(20);
  });

  it('refuses to prove a window older than the exchange income history',async()=>{
    const h=harness([[fee('BTCUSDT',at(500),-.05)]]);
    const staleEnd=Date.now()-110*86_400_000,staleStart=staleEnd-3600_000;
    const result=await h.adapter.fetchFundingIncome(staleStart,staleEnd);
    expect(result.complete).toBe(false);
    expect(result.rows).toHaveLength(0);
  });

  it('fails closed on a production private read and records no write',async()=>{
    const h=harness([[fee('BTCUSDT',at(500),-.05)]],'PRODUCTION');
    await expect(h.adapter.fetchFundingIncome(windowStart,windowEnd)).rejects.toThrow(/TESTNET_ONLY_WRITE_LOCK|PRODUCTION/);
    expect(h.adapter.writeBoundaryMetrics()).toMatchObject({environment:'PRODUCTION',testnetWrites:0,productionWrites:0});
  });
});
