import {expect,it} from 'vitest';
import {tradeCloseProvenance} from './router.js';

const fill={fillId:'f',tradeId:'t',qty:1,price:100,side:'SELL',executionTime:1,cycleId:'cy',symbol:'BTCUSDT',orderId:'12345',clientOrderId:'manual-client',attributionStatus:'SYSTEM_ATTRIBUTED',source:'EXCHANGE_AUDIT'};
const record={direction:'LONG',cycleId:'cy',exitQty:1,exitFillCount:1,linkedFillIds:['f'],closedAt:1,symbol:'BTCUSDT',exitOrderIds:['12345']};

it('recovers a historical Dashboard manual close from exact durable manual order identity',()=>{
  const runtime:any={state:{
    executionFills:[fill],
    manualOrders:new Map([['manual-1',{id:'manual-1',symbol:'BTCUSDT',exchangeOrderId:'12345',clientOrderId:'manual-client',reduceOnly:true}]]),
    tpOrders:new Map(),
    orderProvenance:{resolve:()=>({status:'UNRESOLVED',rows:[],proof:['NO_MATCH']})},
  }};
  expect(tradeCloseProvenance(record,runtime)).toBe('SYSTEM_MANUAL');
});

it('does not guess manual provenance from an unrelated durable order',()=>{
  const runtime:any={state:{
    executionFills:[fill],
    manualOrders:new Map([['manual-1',{id:'manual-1',symbol:'BTCUSDT',exchangeOrderId:'99999',clientOrderId:'other',reduceOnly:true}]]),
    tpOrders:new Map(),
    orderProvenance:{resolve:()=>({status:'UNRESOLVED',rows:[],proof:['NO_MATCH']})},
  }};
  expect(tradeCloseProvenance(record,runtime)).toBe('UNKNOWN');
});
