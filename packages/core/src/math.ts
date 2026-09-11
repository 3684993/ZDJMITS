export const clamp = (value:number, min:number, max:number) => Math.min(max, Math.max(min, value));
export const safeDiv = (a:number, b:number, fallback=0) => Math.abs(b) < 1e-12 ? fallback : a / b;
export const mean = (values:number[]) => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
export function stddev(values:number[]):number { if(values.length<2) return 0; const m=mean(values); return Math.sqrt(mean(values.map(v=>(v-m)**2))); }
export function percentileRank(value:number, values:number[]):number {
  if (!values.length) return 0;
  let below=0, equal=0;
  for (const v of values) { if(v<value) below++; else if(v===value) equal++; }
  return clamp(((below + 0.5*equal)/values.length)*100, 0, 100);
}
export function median(values:number[]):number { if(!values.length) return 0; const x=[...values].sort((a,b)=>a-b); const m=Math.floor(x.length/2); return x.length%2?x[m]!:((x[m-1]??0)+(x[m]??0))/2; }
export function roundToTick(value:number, tick:number, mode:'floor'|'ceil'|'round'='round'):number {
  if(tick<=0) return value; const units=value/tick,epsilon=Number.EPSILON*Math.max(1,Math.abs(units))*8; const n=mode==='floor'?Math.floor(units+epsilon):mode==='ceil'?Math.ceil(units-epsilon):Math.round(units); return Number((n*tick).toPrecision(15));
}
export const uid = (prefix:string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
