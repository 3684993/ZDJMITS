/** Research/shadow only. No caller may turn missing portfolio/PIT facts into a live default. */
export type QuantityBounds = {
  cutoff: number; asset: string; stepSize: number; minimumQuantity: number;
  maximumByFunds: number | null; maximumByStress: number | null;
  maximumByTail: number | null; maximumByConcentration: number | null;
  maximumByLiquidity: number | null; observedAt: number;
  facts:Record<'funds'|'stress'|'tail'|'concentration'|'liquidity',{asset:string;observedAt:number}|null>;
};
export function shadowRiskQuantityBounds(input: QuantityBounds) {
  const values=[input.maximumByFunds,input.maximumByStress,input.maximumByTail,input.maximumByConcentration,input.maximumByLiquidity];
  const names=['funds','stress','tail','concentration','liquidity'] as const;
  const invalidFacts=names.filter(name=>{const fact=input.facts?.[name];return !fact||fact.asset!==input.asset||!Number.isSafeInteger(fact.observedAt)||fact.observedAt>input.cutoff||fact.observedAt>input.observedAt;});
  if(!input.asset || !Number.isSafeInteger(input.cutoff) || input.cutoff<=0 || !Number.isSafeInteger(input.observedAt) || input.observedAt<=0 || input.observedAt>input.cutoff ||
    !Number.isFinite(input.stepSize) || input.stepSize<=0 || !Number.isFinite(input.minimumQuantity) || input.minimumQuantity<0 ||
    invalidFacts.length>0 || values.some(value=>value===null || !Number.isFinite(value) || Number(value)<0))
    return {status:'UNKNOWN' as const,quantity:null,enforced:false as const};
  const ceiling=Math.min(...values as number[]),units=Math.floor(ceiling/input.stepSize);
  const quantity=Number((units*input.stepSize).toPrecision(15));
  // Rounding must never buy a unit above any measured bound. Missing/insufficient bounds do not upsize.
  if(quantity>ceiling || quantity<input.minimumQuantity || quantity<=0)
    return {status:'NO_FEASIBLE_QUANTITY' as const,quantity:null,enforced:false as const};
  return {status:'SHADOW_ONLY' as const,quantity,enforced:false as const};
}
