import {expect,it} from 'vitest';
import {ExistingPositionContextSchema} from '@zdj/contracts';
import {existingPositionContext} from './existingPositionContext.js';
import {noSeparateAddBlock} from './noSeparateAdd.js';
const fixture=():any=>({settings:{connections:{exchange:{environment:'TESTNET'},executionMode:'TESTNET_ENABLED'}},account:{status:'READY',asOf:10000},positions:new Map([['p',{symbol:'UNIUSDC',side:'SHORT',quantity:168,cycleId:'current',openedAt:5000,entryTimeSource:'SYSTEM_FILL',managementStatus:'HUMAN_MANAGED',lastAddAt:9900}]]),lifecycles:new Map([['UNIUSDC:SHORT',{cycleId:'current',currentQty:168,openedAt:5000,status:'OPEN'}]]),executionFills:[{symbol:'UNIUSDC',direction:'SHORT',positionSide:'SHORT',side:'SELL',cycleId:'current',qty:100,executionTime:5000},{symbol:'UNIUSDC',direction:'SHORT',positionSide:'SHORT',side:'SELL',cycleId:'current',qty:68,executionTime:9000}],entryOrders:new Map(),entryIntents:new Map()});
it('preserves original retained time through adds, partial reduction and HUMAN handoff; reverse remains eligible under no-add',()=>{
 const s=fixture(),p=existingPositionContext(s,'UNIUSDC',10000);expect(p.positions[0]).toMatchObject({side:'SHORT',holdingAgeMs:5000,firstFillAt:5000,timeEvidence:'PARTIAL_RETAINED_ENTRY_MATCHES_CYCLE_OPEN',managementStatus:'HUMAN_MANAGED'});expect(ExistingPositionContextSchema.safeParse(p).success).toBe(true);
 expect(noSeparateAddBlock(s,'UNIUSDC','SHORT')).toBe('NO_SEPARATE_ADD_POSITION_EXISTS');expect(noSeparateAddBlock(s,'UNIUSDC','LONG')).toBeNull();
 s.positions.get('p').quantity=80;s.lifecycles.get('UNIUSDC:SHORT').currentQty=80;expect(existingPositionContext(s,'UNIUSDC',10000).positions[0]!.holdingAgeMs).toBe(5000);
});
it('does not borrow another side, quote asset or closed cycle origin after flat/reopen',()=>{
 const s=fixture();s.executionFills=s.executionFills.map((f:any)=>({...f,cycleId:'old'}));s.executionFills.push({symbol:'UNIUSDT',direction:'SHORT',positionSide:'SHORT',side:'SELL',cycleId:'current',qty:1,executionTime:5000},{symbol:'UNIUSDC',direction:'LONG',positionSide:'LONG',side:'BUY',cycleId:'current',qty:1,executionTime:5000});expect(existingPositionContext(s,'UNIUSDC',10000).positions[0]!.firstFillAt).toBeNull();
});
it.each(['stale','unknown','future','quantity','cycle'])('keeps %s inventory or time evidence unknown instead of inventing age',kind=>{
 const s=fixture();if(kind==='stale')s.account.asOf=-100000;if(kind==='unknown')s.executionFills=[];if(kind==='future')s.positions.get('p').openedAt=11000;if(kind==='quantity')s.positions.get('p').quantity=NaN;if(kind==='cycle')s.lifecycles.get('UNIUSDC:SHORT').cycleId='different';const p=existingPositionContext(s,'UNIUSDC',10000);expect(p.positions[0]!.holdingAgeMs).toBeNull();expect(p.positions[0]!.timeEvidence).toBe('UNKNOWN');
});
it('bounds anomalous duplicate position scopes and does not present a partial set as complete',()=>{
 const s=fixture();for(let i=0;i<9;i++)s.positions.set(String(i),{...s.positions.get('p')});const p=existingPositionContext(s,'UNIUSDC',10000);expect(p.positions).toHaveLength(8);expect(p.coverage).toBe('BOUND_REACHED_UNKNOWN');expect(p.positions.every(p=>p.holdingAgeMs===null)).toBe(true);
});
