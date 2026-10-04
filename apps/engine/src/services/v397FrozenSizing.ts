import {estimateTradingCost} from '@zdj/core';

export function leverageChoices(policyMaximum:number,exchangeMaximum:number):number[]{
  const cap=Math.min(20,Math.floor(policyMaximum),Math.floor(exchangeMaximum));
  return Number.isFinite(cap)&&cap>=10?Array.from({length:cap-9},(_,index)=>index+10):[];
}

export type FrozenSizingInput={quoteAsset:'USDT'|'USDC';side:'LONG'|'SHORT';entryPrice:number;targetPrice:number;
  stepSize:number;minQty:number;exchangeMinimumNotional:number;businessMinimumNotional:number;
  minimumInitialMarginQuote:number;availableMarginQuote:number;leverage:number;
  takeProfit:{entryFeeRate:number;takerFeeRate:number;makerFeeRate:number;exitFeeAssumption:string;slippageBufferPct:number;
    feeSafetyBufferPct:number;minNetProfitUsd:number;minNetProfitRoiPct:number}};

/** The least whole-step quantity that can actually clear all floors at a fixed frozen target. */
export function minimumQuantityForTarget(input:FrozenSizingInput){
  const {entryPrice,targetPrice,stepSize,minQty,leverage}=input;
  if(!Number.isInteger(leverage)||leverage<10||leverage>20||
    ![entryPrice,targetPrice,stepSize,minQty,input.exchangeMinimumNotional,input.businessMinimumNotional,
      input.minimumInitialMarginQuote,input.availableMarginQuote].every(Number.isFinite)||
    entryPrice<=0||targetPrice<=0||stepSize<=0||minQty<=0||input.minimumInitialMarginQuote<100||
    input.availableMarginQuote<input.minimumInitialMarginQuote||
    (input.side==='LONG'?targetPrice<=entryPrice:targetPrice>=entryPrice))return null;
  const notionalFloor=Math.max(input.exchangeMinimumNotional,input.businessMinimumNotional,
    input.minimumInitialMarginQuote*leverage);
  const floorUnits=Math.max(1,Math.ceil(minQty/stepSize-1e-9),Math.ceil(notionalFloor/(entryPrice*stepSize)-1e-9));
  const ceilingUnits=Math.floor(input.availableMarginQuote*leverage/(entryPrice*stepSize)+1e-9);
  if(!Number.isSafeInteger(floorUnits)||!Number.isSafeInteger(ceilingUnits)||ceilingUnits<floorUnits)return null;
  const exitFeeRate=input.takeProfit.exitFeeAssumption==='MAKER'?input.takeProfit.makerFeeRate:input.takeProfit.takerFeeRate;
  const measure=(units:number)=>estimateTradingCost({entryPrice,qty:units*stepSize,direction:input.side,leverage,
    entryFeeRate:input.takeProfit.entryFeeRate,expectedExitFeeRate:exitFeeRate,
    expectedSlippagePct:input.takeProfit.slippageBufferPct,feeSafetyBufferPct:input.takeProfit.feeSafetyBufferPct,
    minNetProfitUsd:input.takeProfit.minNetProfitUsd,minNetProfitRoiPct:input.takeProfit.minNetProfitRoiPct},targetPrice);
  const profitable=(units:number)=>{const value=measure(units);return value.expectedNetProfit+1e-8>=value.requiredNetProfit;};
  if(!profitable(ceilingUnits))return null;
  let lo=floorUnits,hi=ceilingUnits;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(profitable(mid))hi=mid;else lo=mid+1;}
  // Floating arithmetic and step alignment are rechecked at the actual emitted size.
  const quantityUnits=lo,quantity=quantityUnits*stepSize,notionalQuote=quantity*entryPrice,
    initialMarginQuote=notionalQuote/leverage,economics=measure(quantityUnits);
  if(quantity+1e-10<minQty||notionalQuote+1e-8<notionalFloor||
    initialMarginQuote+1e-8<input.minimumInitialMarginQuote||
    initialMarginQuote>input.availableMarginQuote+1e-8||
    economics.expectedNetProfit+1e-8<economics.requiredNetProfit)return null;
  return{quantityUnits,quantity,notionalQuote,initialMarginQuote,
    expectedNetProfitQuote:economics.expectedNetProfit,requiredNetProfitQuote:economics.requiredNetProfit,
    fundingStatus:'UNPROVEN' as const,netProfitMeaning:'TARGET_CONDITIONAL_EX_FUNDING' as const};
}
