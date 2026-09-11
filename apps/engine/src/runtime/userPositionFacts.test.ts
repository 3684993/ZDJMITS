import {it,expect,vi} from 'vitest';
import {EngineRuntime} from './appRuntime.js';
import {ReconciliationService} from '../services/reconciliationService.js';
import {RuntimeState} from '../state/runtimeState.js';
import {SystemSettingsSchema} from '@zdj/contracts';
import {readFileSync} from 'node:fs';
const position={id:'p',symbol:'ETHFIUSDC',side:'LONG',quantity:10,entryPrice:1,openedAt:1,tpStatus:'PROTECTED'};
function runtime(){const r:any=Object.create(EngineRuntime.prototype);r.state=new RuntimeState(SystemSettingsSchema.parse(JSON.parse(readFileSync('../../config/settings.default.json','utf8'))));r.state.positions.set('p',{...position});r.state.account={status:'UNAVAILABLE',availableUsd:123,asOf:1};r.positions={onReconciledClose:vi.fn()};r.events={publish:vi.fn()};return r;}
it('uses explicit zero position deltas without promoting partial balances to READY',()=>{
 const r=runtime(),at=Date.now();r.applyUserData({e:'ACCOUNT_UPDATE',T:at,a:{B:[{a:'USDT',cw:'99999',wb:'99999'}],P:[{s:'ETHFIUSDC',ps:'LONG',pa:'0'}]}});
 expect(r.state.positions.size).toBe(0);expect(r.positions.onReconciledClose).toHaveBeenCalledOnce();expect(r.state.account).toEqual({status:'UNAVAILABLE',availableUsd:123,asOf:1});
 r.state.positions.set('p',{...position,openedAt:at+1});r.applyUserData({e:'ACCOUNT_UPDATE',T:at,a:{P:[{s:'ETHFIUSDC',ps:'LONG',pa:'0'}]}});expect(r.state.positions.size).toBe(1);
});
it('applies only matching sides, rejects stale facts and treats a missing delta as unchanged',()=>{
 const r=runtime(),at=Date.now();r.applyUserData({e:'ACCOUNT_UPDATE',T:at,a:{P:[{s:'ETHFIUSDC',ps:'SHORT',pa:'0'}]}});expect(r.state.positions.size).toBe(1);
 r.applyUserData({e:'ACCOUNT_UPDATE',T:at,a:{P:[{s:'ETHFIUSDC',ps:'LONG',pa:'4',ep:'2',up:'3'}]}});expect(r.state.positions.get('p')).toMatchObject({quantity:4,entryPrice:2,tpStatus:'PENDING'});
 r.applyUserData({e:'ACCOUNT_UPDATE',T:at-1,a:{P:[{s:'ETHFIUSDC',ps:'LONG',pa:'0'}]}});expect(r.state.positions.size).toBe(1);
 r.applyUserData({e:'ACCOUNT_UPDATE',T:at+1,a:{P:[]}});expect(r.state.positions.size).toBe(1);
});
it('a stale REST response cannot resurrect a position closed by a newer WS delta',async()=>{
 const r=runtime();
 let release!:(v:any)=>void;const remote=new Promise<any>(resolve=>release=resolve);
 const service=new ReconciliationService({fetchPositions:()=>remote,fetchOpenOrders:async()=>[]} as any,r.state,r.events,{ensure:vi.fn()} as any,r.positions);
 const run=service.run();await Promise.resolve();const at=Date.now()+1;r.applyUserData({e:'ACCOUNT_UPDATE',T:at,a:{P:[{s:'ETHFIUSDC',ps:'LONG',pa:'0'}]}});release([{...position}]);await run;expect(r.state.positions.size).toBe(0);expect(service.health().lastError).toBeNull();
});
