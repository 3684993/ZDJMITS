import {expect,it,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {ExternalTradeAdapter} from './ExternalTradeAdapter.js';

// In-memory transport only; no socket, live database, account or order fixtures persisted.
function fixture(window?:number,failure?:string){
 const json=vi.fn(async(url:string)=>{if(url==='/fapi/v1/time')return{serverTime:Date.now()+250};if(failure)throw Error(failure);return{};});
 const guard=vi.fn(),transport={json,environment:()=> 'TESTNET',assertTestnetExchangeWrite:guard};
 return{adapter:new ExternalTradeAdapter(transport as never,{apiKey:'synthetic-key',apiSecret:'synthetic-secret'},window),json,guard};
}
it.each([[undefined,5000],[1000,1000],[5000,5000],[12000,12000],[60000,60000]])('signs configured recvWindow %s as %s with clock offset',async(window,expected)=>{
 vi.useFakeTimers();vi.setSystemTime(10000);const h=fixture(window);try{
  await (h.adapter as any).signed('GET','/fapi/v2/account');
  const url=h.json.mock.calls.find(([url])=>url.startsWith('/fapi/v2/account'))![0],query=new URL('https://example.invalid'+url).searchParams,signature=query.get('signature');
  expect(query.get('recvWindow')).toBe(String(expected));expect(query.get('timestamp')).toBe('10250');query.delete('signature');
  expect(signature).toBe(createHmac('sha256','synthetic-secret').update(query.toString()).digest('hex'));expect(h.guard).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it.each([NaN,Infinity,0,-1,1500.5,60001])('rejects invalid recvWindow %s before clock/network/write boundary',async window=>{
 const h=fixture(window);await expect((h.adapter as any).signed('POST','/fapi/v1/order')).rejects.toThrow('BINANCE_RECV_WINDOW_INVALID');expect(h.json).not.toHaveBeenCalled();expect(h.guard).not.toHaveBeenCalled();
});
it.each(['Binance HTTP 451: restricted location','Binance HTTP 429: rate limit','Binance HTTP 418: banned','Binance HTTP 502: bad gateway','Binance HTTP 503: Unknown error, please check your request or try again later.','SOCKS_CONNECT_REPLY timeout after 8000ms'])('does not blindly retry a simulated signed POST on %s',async failure=>{
 const h=fixture(5000,failure);await expect((h.adapter as any).signed('POST','/fapi/v1/order',{newClientOrderId:'synthetic-origin'})).rejects.toThrow(failure);
 expect(h.json.mock.calls.filter(([url])=>url.startsWith('/fapi/v1/order'))).toHaveLength(1);expect(h.json.mock.calls.every(([url])=>url.startsWith('/'))).toBe(true);
});
