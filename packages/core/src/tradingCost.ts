export type CostDirection='LONG'|'SHORT';
export type FeeAssumption='MAKER'|'TAKER';
export interface TradingCostInput {
  entryPrice:number; qty:number; direction:CostDirection; leverage:number;
  entryFeeRate:number; expectedExitFeeRate:number; expectedSlippagePct:number; feeSafetyBufferPct:number;
  minNetProfitUsd:number; minNetProfitRoiPct:number;
}
export interface TradingCostEstimate {
  entryNotional:number; marginUsed:number; estimatedEntryFee:number; estimatedExitFee:number; estimatedTotalFee:number;
  slippageBuffer:number; feeSafetyBuffer:number; breakEvenPrice:number; minProfitableExitPrice:number;
  requiredNetProfit:number; expectedGrossProfit:number; expectedNetProfit:number; expectedExitPrice:number;
}

const finite=(value:number)=>Number.isFinite(value)&&value>=0;
const gross=(input:TradingCostInput,exitPrice:number)=>input.direction==='LONG'?(exitPrice-input.entryPrice)*input.qty:(input.entryPrice-exitPrice)*input.qty;
const costs=(input:TradingCostInput,exitPrice:number)=>{
  const entryNotional=input.entryPrice*input.qty,exitNotional=exitPrice*input.qty;
  const entryFee=entryNotional*input.entryFeeRate,exitFee=exitNotional*input.expectedExitFeeRate,total=entryFee+exitFee;
  const slippage=exitNotional*(input.expectedSlippagePct/100),feeBuffer=total*(input.feeSafetyBufferPct/100);
  return{entryFee,exitFee,total,slippage,feeBuffer};
};
export function requiredNetProfit(input:Pick<TradingCostInput,'minNetProfitUsd'|'minNetProfitRoiPct'|'entryPrice'|'qty'|'leverage'>){
  const margin=input.entryPrice*input.qty/Math.max(1,input.leverage);return Math.max(input.minNetProfitUsd,margin*input.minNetProfitRoiPct/100);
}
function solveExit(input:TradingCostInput,required:number){
  const direction=input.direction==='LONG'?1:-1;let lo=input.entryPrice*(direction>0?1:0.000001),hi=input.entryPrice*(direction>0?3:1);
  for(let i=0;i<90;i++){const mid=(lo+hi)/2,net=gross(input,mid)-costs(input,mid).total-costs(input,mid).slippage-costs(input,mid).feeBuffer;if(direction>0?(net<required):(net<required))lo=direction>0?mid:lo,hi=direction>0?hi:mid;else direction>0?hi=mid:lo=mid;}
  return direction>0?hi:lo;
}
export function estimateTradingCost(input:TradingCostInput,exitPrice:number):TradingCostEstimate{
  if(!finite(input.entryPrice)||input.entryPrice<=0||!finite(input.qty)||input.qty<=0||!finite(exitPrice)||exitPrice<=0)throw new Error('TRADING_COST_INVALID_INPUT');
  const entryNotional=input.entryPrice*input.qty,marginUsed=entryNotional/Math.max(1,input.leverage),c=costs(input,exitPrice),required=requiredNetProfit(input),expectedGrossProfit=gross(input,exitPrice),expectedNetProfit=expectedGrossProfit-c.total-c.slippage-c.feeBuffer;
  return{entryNotional,marginUsed,estimatedEntryFee:c.entryFee,estimatedExitFee:c.exitFee,estimatedTotalFee:c.total,slippageBuffer:c.slippage,feeSafetyBuffer:c.feeBuffer,breakEvenPrice:solveExit(input,0),minProfitableExitPrice:solveExit(input,required),requiredNetProfit:required,expectedGrossProfit,expectedNetProfit,expectedExitPrice:exitPrice};
}
