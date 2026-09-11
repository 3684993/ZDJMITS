import type { Position, SystemSettings, MarketSymbolSnapshot } from '@zdj/contracts';
import { roundToTick } from './math.js';
export function takeProfitPrice(position:Position, tickSize:number, settings:SystemSettings):number {
  const move=settings.takeProfit.targetPriceMovePercent/100; const raw=position.side==='LONG'?position.entryPrice*(1+move):position.entryPrice*(1-move); return roundToTick(raw,tickSize,position.side==='LONG'?'ceil':'floor');
}

/** Observed closed 15m swing level; never a prediction or an order amendment. */
export function takeProfitTarget(position:Position,tickSize:number,settings:SystemSettings,market:MarketSymbolSnapshot,now=Date.now()) {
  const cfg=settings.takeProfit,fixed=takeProfitPrice(position,tickSize,settings);
  const fallback=(reason:string)=>({price:fixed,source:'PRICE_MOVE_PERCENT',reason});
  if(cfg.mode!=='STRUCTURE_15M')return fallback('CONFIGURED_FIXED');
  const card=market.technical?.['15m'],period=900000,boundary=Math.floor(now/period)*period,expected=(now-boundary<=10000?boundary-period:boundary)-1;
  if(!card||card.isClosed!==true||card.barCloseTime!==expected||!card.lastClosedBar||card.lastClosedBar.closeTime!==expected)return fallback('STRUCTURE_NOT_FRESH_CLOSED');
  const level=position.side==='LONG'?card.recentSwingHigh:card.recentSwingLow,buffer=(cfg.structureBufferPercent??0.05)/100;
  const raw=level*(position.side==='LONG'?1-buffer:1+buffer),price=roundToTick(raw,tickSize,position.side==='LONG'?'floor':'ceil');
  const move=(position.side==='LONG'?price/position.entryPrice-1:1-price/position.entryPrice)*100;
  if(!Number.isFinite(price)||price<=0||move<(cfg.structureMinMovePercent??0.45)||move>(cfg.structureMaxMovePercent??3))return fallback('STRUCTURE_OUTSIDE_CONFIGURED_DISTANCE');
  if(position.side==='LONG'?price<=Math.max(market.quote.ask,market.quote.mark):price>=Math.min(market.quote.bid,market.quote.mark))return fallback('STRUCTURE_ALREADY_CROSSED');
  return {price,source:'STRUCTURE_15M',reason:position.side==='LONG'?'BEFORE_OBSERVED_RESISTANCE':'BEFORE_OBSERVED_SUPPORT'};
}
