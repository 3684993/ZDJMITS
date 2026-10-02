import {describe,expect,it} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {exitFillProvenance,tradeCloseProvenance} from './tradeCloseProvenance.js';
const fill=(over:any={})=>({fillId:'fill',symbol:'BTCUSDT',direction:'LONG',side:'SELL',orderId:'exit',clientOrderId:'opaque',cycleId:'cycle',qty:1,maker:false,source:'USER_DATA_WS',attributionStatus:'SYSTEM_ATTRIBUTED',...over});
const record=(over:any={})=>({closedAt:100,symbol:'BTCUSDT',direction:'LONG',cycleId:'cycle',entryQty:1,exitQty:1,exitOrderIds:['exit'],linkedFillIds:['fill'],closeReason:'MANUAL',...over});
function setup(role?:string){const s=new RuntimeState({} as any);s.executionFills=[fill()];if(role)s.orderProvenance={resolve:()=>({status:'SYSTEM_PROVEN',rows:[{role,cycleId:'cycle'}],proof:[]})} as any;return s;}
describe('closure source follows exact owner evidence',()=>{
  it.each([true,false])('does not infer human ownership from maker=%s or old MANUAL labels',maker=>{
    const s=setup();s.executionFills=[fill({maker,clientOrderId:'manual_looks_like_a_prefix'})];expect(tradeCloseProvenance(record(),s)).toBe('UNKNOWN');
  });
  it.each([['TP','TP'],['EXIT','SYSTEM_EXIT'],['MANUAL','SYSTEM_MANUAL']])('maps proven %s to %s', (role,expected)=>expect(tradeCloseProvenance(record(),setup(role))).toBe(expected));
  it('reports externally observed exchange closing without claiming an actor',()=>{
    const s=setup();s.executionFills=[fill({attributionStatus:'EXTERNAL_OR_UNLINKED'})];expect(tradeCloseProvenance(record(),s)).toBe('EXCHANGE_CLOSE');
  });
  it('keeps missing, partial, wrong-cycle, and wrong-symbol exit facts UNKNOWN',()=>{
    for(const row of [fill({qty:.5}),fill({cycleId:'other'}),fill({symbol:'ETHUSDT'})]){const s=setup('TP');s.executionFills=[row];expect(tradeCloseProvenance(record(),s)).toBe('UNKNOWN');}
    expect(tradeCloseProvenance(record({exitOrderIds:['exit','missing']}),setup('TP'))).toBe('UNKNOWN');
  });
  it('distinguishes registry conflict from legitimate mixed exit sources',()=>{
    const s=setup();s.orderProvenance={resolve:({clientOrderId}:any)=>({status:'SYSTEM_PROVEN',rows:[{role:clientOrderId==='manual'?'MANUAL':'TP',cycleId:'cycle'}],proof:[]})} as any;
    expect(exitFillProvenance([fill(),fill({clientOrderId:'manual'})],s,'cycle')).toBe('MIXED');
    s.orderProvenance={resolve:()=>({status:'UNRESOLVED',rows:[],proof:['PROVENANCE_ROLE_CONFLICT:TP|EXIT']})} as any;
    expect(tradeCloseProvenance(record(),s)).toBe('CONFLICT');
  });
  it('readback leaves raw legacy records and fills intact',()=>{
    const s=setup(),r=record(),before=JSON.stringify([r,s.executionFills]);tradeCloseProvenance(r,s);expect(JSON.stringify([r,s.executionFills])).toBe(before);
    expect(tradeCloseProvenance(record({closedAt:null}),s)).toBe('OPEN');
  });
});
