import {describe,it,expect} from 'vitest';
import {takeProfitTarget} from './tp.js';
const now=1800000020000,close=Math.floor(now/900000)*900000-1;
const cfg:any={takeProfit:{mode:'STRUCTURE_15M',targetPriceMovePercent:.45,structureBufferPercent:.05,structureMinMovePercent:.45,structureMaxMovePercent:3}};
const market:any={quote:{bid:99.99,ask:100.01,mark:100},technical:{'15m':{isClosed:true,barCloseTime:close,lastClosedBar:{closeTime:close},recentSwingHigh:102,recentSwingLow:98}}};
describe('structure TP opt-in',()=>{
 it('places long before resistance and short before support symmetrically',()=>{expect(takeProfitTarget({side:'LONG',entryPrice:100} as any,.01,cfg,market,now)).toMatchObject({source:'STRUCTURE_15M',price:101.94});expect(takeProfitTarget({side:'SHORT',entryPrice:100} as any,.01,cfg,market,now)).toMatchObject({source:'STRUCTURE_15M',price:98.05});});
 it('falls back for old, crossed, absent or excessive targets',()=>{for(const card of [undefined,{...market.technical['15m'],barCloseTime:close-900000},{...market.technical['15m'],recentSwingHigh:99},{...market.technical['15m'],recentSwingHigh:110}])expect(takeProfitTarget({side:'LONG',entryPrice:100} as any,.01,cfg,{...market,technical:{'15m':card}},now).source).toBe('PRICE_MOVE_PERCENT');});
 it('preserves the configured fixed mode',()=>{expect(takeProfitTarget({side:'LONG',entryPrice:100} as any,.01,{takeProfit:{...cfg.takeProfit,mode:'PRICE_MOVE_PERCENT'}} as any,market,now).source).toBe('PRICE_MOVE_PERCENT');});
});
