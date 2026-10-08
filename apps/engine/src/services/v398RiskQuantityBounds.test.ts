import {expect,it} from 'vitest';
import {shadowRiskQuantityBounds} from './v398RiskQuantityBounds.js';
const facts={funds:{asset:'USDT',observedAt:999},stress:{asset:'USDT',observedAt:999},tail:{asset:'USDT',observedAt:999},concentration:{asset:'USDT',observedAt:999},liquidity:{asset:'USDT',observedAt:999}};
const complete={cutoff:1000,observedAt:999,asset:'USDT',stepSize:.1,minimumQuantity:1,maximumByFunds:8,maximumByStress:4.45,maximumByTail:6,maximumByConcentration:5,maximumByLiquidity:7,facts};
it('uses the strictest independently measured bound without enabling an Entry veto',()=>{
 expect(shadowRiskQuantityBounds(complete)).toEqual({status:'SHADOW_ONLY',quantity:4.4,enforced:false});
});
it('quote assets and independently timestamped bounds cannot be silently mixed',()=>{
 expect(shadowRiskQuantityBounds({...complete,facts:{...facts,tail:{asset:'USDC',observedAt:999}}}).status).toBe('UNKNOWN');
 expect(shadowRiskQuantityBounds({...complete,facts:{...facts,stress:{asset:'USDT',observedAt:1001}}}).status).toBe('UNKNOWN');
});
it('increasing same-direction exposure cannot enlarge the concentration-limited maximum quantity',()=>{
 let previous=Infinity;
 for(let exposure=0;exposure<=1000;exposure++){
  const result=shadowRiskQuantityBounds({...complete,minimumQuantity:0,maximumByConcentration:10-exposure*.01});
  const quantity=result.quantity??0;expect(quantity).toBeLessThanOrEqual(previous);
  if(result.quantity!==null)expect(quantity).toBeLessThanOrEqual(complete.maximumByStress);
  previous=quantity;
 }
});
it('never rounds up or forces a profit/margin minimum above the safe ceiling',()=>{
 expect(shadowRiskQuantityBounds({...complete,minimumQuantity:4.5})).toEqual({status:'NO_FEASIBLE_QUANTITY',quantity:null,enforced:false});
});
it('missing portfolio facts and look-ahead cannot produce invented defaults',()=>{
 for(const patch of [{maximumByTail:null},{observedAt:1001},{asset:''},{maximumByStress:NaN}])
  expect(shadowRiskQuantityBounds({...complete,...patch}).status).toBe('UNKNOWN');
});
