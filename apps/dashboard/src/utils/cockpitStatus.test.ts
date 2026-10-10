import {describe,it,expect} from 'vitest';
import {cockpitSignals,environmentSignal,effectiveProxySignal} from './cockpitStatus';
const now=100000,account={status:'READY',asOf:99000,source:'BINANCE_TESTNET_PRIVATE'};
const route=[{rest:{throughProxy:true,failClosed:true}}];
const snapshot={ts:99000,settings:{connections:{exchange:{environment:'TESTNET'},executionMode:'TESTNET_ENABLED'}},account,
  executionTruth:{takeProfitCoverage:{status:'HEALTHY',missing:0,protected:2,unresolved:0}}};
describe('cockpit evidence-led compact status strip',()=>{
 it('uses TESTNET amber, PRODUCTION green, invalid/stale red and no text color prefixes',()=>{
  expect(environmentSignal(snapshot,now)).toMatchObject({tone:'warn',text:'测试盘'});
  expect(environmentSignal({...snapshot,settings:{connections:{exchange:{environment:'PRODUCTION'}}}},now)).toMatchObject({tone:'good',text:'实盘'});
  expect(environmentSignal({...snapshot,ts:1},now)).toMatchObject({tone:'bad',text:'环境未确认'});
  expect(environmentSignal({...snapshot,settings:{connections:{exchange:{environment:'LIVE?'}}}},now)).toMatchObject({tone:'bad',text:'环境异常'});
 });
 it('recognizes functional signed exchange access via configured fail-closed SOCKS without claiming SSH wire proof',()=>{
  const result=effectiveProxySignal(route,snapshot,now);
  expect(result).toMatchObject({tone:'good',text:'交易通路可用'});
  expect(result.detail).toContain('不代表SSH');
  expect(effectiveProxySignal(route,{...snapshot,account:{...account,asOf:1}},now).tone).toBe('warn');
  expect(effectiveProxySignal([{rest:{throughProxy:false,failClosed:true}}],snapshot,now).tone).toBe('bad');
 });
 it('refuses to turn a fresh account into a green light over active HTTP 451 or missing TP',()=>{
  const signals=cockpitSignals({snapshot,routes:route,resources:[],incidents:[{active:true,category:'EXCHANGE',httpStatus:451}],now});
  expect(signals.find(s=>s.id==='exchange')).toMatchObject({tone:'bad',text:'HTTP 451'});
  expect(signals.find(s=>s.id==='tp')?.tone).toBe('good');
  const broken=cockpitSignals({snapshot:{...snapshot,executionTruth:{takeProfitCoverage:{missing:1,status:'DEGRADED'}}},routes:route,resources:[],now});
  expect(broken.find(s=>s.id==='tp')?.tone).toBe('bad');
 });
});
