import {expect,it} from 'vitest';
import {noSeparateAddBlock} from './noSeparateAdd.js';
const state=():any=>({settings:{connections:{executionMode:'TESTNET_ENABLED',exchange:{environment:'TESTNET'}}},positions:new Map(),lifecycles:new Map(),entryOrders:new Map(),entryIntents:new Map()});
const origin={intentId:'origin',clientOrderId:'client',quantity:10,createdAt:10};
it('blocks another authorization on an occupied physical side before Primary',()=>{
 const s=state();s.positions.set('legacy',{symbol:'ETHUSDT',side:'LONG',quantity:1,managementStatus:'AUTO_MANAGED'});
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG')).toBe('NO_SEPARATE_ADD_POSITION_EXISTS');
 expect(noSeparateAddBlock(s,'ETHUSDT','SHORT')).toBeNull();
 s.positions.clear();s.lifecycles.set('ETHUSDT:LONG',{currentQty:1});
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG')).toBe('NO_SEPARATE_ADD_CYCLE_EXISTS');
});
it('permits only the original immutable authorization within its cap, including partial fills',()=>{
 const s=state();s.noAddOriginReader=()=>origin;s.positions.set('partial',{symbol:'ETHUSDT',side:'LONG',quantity:3,managementStatus:'AUTO_MANAGED'});
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG','origin')).toBeNull();
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG','new')).toBe('NO_SEPARATE_ADD_ORIGIN_AUTHORIZATION_EXISTS');
 s.positions.get('partial').quantity=11;
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG','origin')).toBe('NO_ADD_ORIGIN_QUANTITY_EXCEEDED');
});
it('human handoff and unreadable durable authority never permit another wire',()=>{
 const s=state();s.noAddOriginReader=()=>origin;s.positions.set('human',{symbol:'ETHUSDT',side:'LONG',quantity:3,managementStatus:'HUMAN_MANAGED'});
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG','origin')).toBe('NO_ADD_ORIGIN_HUMAN_HANDOFF');
 s.noAddOriginReader=()=>{throw Error('disk');};
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG','origin')).toBe('NO_ADD_DURABLE_AUTHORITY_UNAVAILABLE');
});
it('blocks pending independent authorizations but leaves unrelated symbols free',()=>{
 const s=state();s.entryIntents.set('pending',{id:'pending',symbol:'ETHUSDT',side:'LONG',absoluteExpiresAt:200});
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG','new',100)).toBe('NO_SEPARATE_ADD_PENDING_AUTHORIZATION');
 expect(noSeparateAddBlock(s,'AVAXUSDT','LONG','new',100)).toBeNull();
});
it('invalid quantities and corrupt durable facts never create capacity',()=>{
 const s=state();s.positions.set('unknown',{symbol:'ETHUSDT',side:'LONG',quantity:NaN});
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG')).toBe('NO_ADD_POSITION_QUANTITY_UNPROVEN');
 s.positions.clear();s.noAddOriginReader=()=>({...origin,quantity:Infinity});
 expect(noSeparateAddBlock(s,'ETHUSDT','LONG','origin')).toBe('NO_ADD_ORIGIN_FACT_UNPROVEN');
});
