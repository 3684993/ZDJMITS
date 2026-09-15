import {describe,expect,it} from 'vitest';
import {binanceBudgetFailureMessage} from './BinanceTransport.js';

describe('Binance budget failure telemetry',()=>{
  it('attaches request endpoint purpose source method and route identity without query secrets',()=>{
    const message=binanceBudgetFailureMessage('BINANCE_REQUEST_QUEUE_TIMEOUT',{requestId:'req-123',endpoint:'/fapi/v1/order',method:'GET',source:'ORDER_VERIFICATION',purpose:'TP_EXACT_VERIFY',routeIdentity:'proxy-abc'});
    expect(message).toBe('BINANCE_REQUEST_QUEUE_TIMEOUT|requestId=req-123|endpoint=/fapi/v1/order|method=GET|source=ORDER_VERIFICATION|purpose=TP_EXACT_VERIFY|routeIdentity=proxy-abc');
    expect(message).not.toContain('signature=');expect(message).not.toContain('apiKey');
  });
});
