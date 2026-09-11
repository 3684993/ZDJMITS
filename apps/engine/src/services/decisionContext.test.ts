import {describe,expect,it} from 'vitest';
import {decisionContextKey,nextClosedFiveMinute} from './decisionContext.js';

const market=(asOf:number)=>({quote:{last:100,bid:99.9,ask:100.1},technical:{'1m':{asOf,trend:'UP'},'5m':{asOf,trend:'UP'},'15m':{asOf,trend:'UP'}}}) as any;
describe('decision context gate',()=>{
  it('ignores tick timestamps and small price changes in the same effective context',()=>{const a=market(300_001),b=market(300_002);b.quote={last:100.01,bid:99.91,ask:100.11};expect(decisionContextKey({market:a,settingsContext:'same',longExecutable:true})).toBe(decisionContextKey({market:b,settingsContext:'same',longExecutable:true}));});
  it('changes on a new closed 5m fact or explicit wait trigger',()=>{const a=market(300_001),b=market(600_001);expect(decisionContextKey({market:a,settingsContext:'same'})).not.toBe(decisionContextKey({market:b,settingsContext:'same'}));expect(decisionContextKey({market:a,settingsContext:'same'})).not.toBe(decisionContextKey({market:a,settingsContext:'same',confirmation:{trigger:'PRICE'}}));});
  it('returns the next 5m boundary',()=>{expect(nextClosedFiveMinute(300_001)).toBe(600_001);});
});
