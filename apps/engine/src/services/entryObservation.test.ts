import {describe,it,expect} from 'vitest';import {entryObservation} from './entryObservation.js';
const run={id:'r',symbol:'ETHFIUSDC',role:'PRIMARY_BRAIN',status:'COMPLETED',decision:'PLACE_LONG'};
const intent={id:'i',symbol:run.symbol,brainRunId:'r'};
const order={id:'o',symbol:run.symbol,intentId:'i',exchangeOrderId:'x',quantity:2,createdAt:1};
const fill={symbol:run.symbol,orderId:'x',tradeId:'t',qty:1,price:10,executionTime:2,attributionStatus:'SYSTEM_ATTRIBUTED'};
const observe=(fills:any[])=>entryObservation({runs:[run],intents:[intent],orders:[order],fills}).chains[0];
describe('entry observation',()=>{
it('conserves unique runs and separates running and technical failures',()=>{const x=entryObservation({runs:[run,run,{...run,id:'b',status:'RUNNING'},{...run,id:'c',decision:'DATA_ERROR'},{...run,id:'d',decision:null,status:'FAILED'}],intents:[],orders:[],fills:[]});expect(x).toMatchObject({counts:{PLACE_LONG:1,DATA_TECHNICAL_BLOCK:1,AI_PROTOCOL_FAILURE:1},completed:3,running:1});});
it('requires symbol and exchange identity and does not fabricate fees',()=>{expect(observe([fill,{...fill,symbol:'OTHER',tradeId:'other',qty:50}])).toMatchObject({fillVwap:10,fee:'UNKNOWN',completeFillAt:null,firstFillAt:2});expect(observe([{...fill,orderId:''}]).firstFillAt).toBeNull();});
it('deduplicates fills and uses actual final fill timestamp',()=>{expect(observe([fill,fill,{...fill,tradeId:'t2',executionTime:5}])).toMatchObject({completeFillAt:5,firstFillAt:2,fillVwap:10});});
it('keeps external attribution explicit',()=>{expect(observe([{...fill,attributionStatus:'EXTERNAL_OR_UNLINKED'}])).toMatchObject({linkStatus:'EXTERNAL',marketAtFill:'UNKNOWN'});});
});
