/** Exhaustive time-window reads. A full page is ambiguous: split, never infer completion.
 * All-orders returns most recent rows by default, so incrementing the last id can skip
 * older rows. Exhaustion and a saturated single millisecond remain UNKNOWN upstream.
 *
 * `budget` is a shared, rolling allowance across callers. A wide window over an old order
 * costs one request per sub-window, so without a shared cap a handful of UNKNOWN entries
 * re-audited every minute can multiply into a request storm that gets the account limited,
 * which would degrade TP maintenance and entry admission. Exhaustion is an error, never a
 * partial success: upstream keeps the fact UNKNOWN.
 */
export type HistoryReadBudget={tryConsume():boolean;used():number;capacity():number;rejected():number};

export function createHistoryReadBudget(options:{capacity:number,intervalMs?:number,now?:()=>number}):HistoryReadBudget{
  const capacity=Math.max(1,Math.floor(Number(options.capacity)));
  const intervalMs=Math.max(1_000,Math.floor(Number(options.intervalMs??60_000)));
  const now=options.now??(()=>Date.now());
  let windowStart=now(),used=0,rejected=0;
  return{
    tryConsume(){
      const at=now();
      if(at-windowStart>=intervalMs){windowStart=at;used=0;}
      if(used+1>capacity){rejected++;return false;}
      used++;return true;
    },
    used:()=>used,
    capacity:()=>capacity,
    rejected:()=>rejected,
  };
}

export async function readHistoryWindows<T>(start:number,end:number,read:(start:number,end:number)=>Promise<T[]>,identity:(row:T)=>string,maxRequests=200,budget?:HistoryReadBudget):Promise<T[]>{
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)throw new Error('INVALID_HISTORY_WINDOW');
  const width=6*86_400_000,stack:Array<[number,number]>=[],result=new Map<string,T[]>();
  if((end-start)/width>maxRequests)throw new Error('HISTORY_REQUEST_BUDGET_EXCEEDED');
  for(let a=start;a<=end;a+=width)stack.push([a,Math.min(end,a+width-1)]);
  let requests=0;
  while(stack.length){
    if(++requests>maxRequests)throw new Error('HISTORY_REQUEST_BUDGET_EXCEEDED');
    if(budget&&!budget.tryConsume())throw new Error('HISTORY_REQUEST_BUDGET_EXCEEDED');
    const [a,b]=stack.pop()!,rows=await read(a,b);
    if(!Array.isArray(rows)||rows.length>1000)throw new Error('INVALID_HISTORY_RESPONSE');
    if(rows.length===1000){
      if(a===b)throw new Error('HISTORY_SINGLE_TIMESTAMP_SATURATED');
      const middle=a+Math.floor((b-a)/2);stack.push([a,middle],[middle+1,b]);continue;
    }
    for(const row of rows){const id=identity(row);if(!id||id==='undefined'||id==='null')throw new Error('HISTORY_IDENTITY_MISSING');const previous=result.get(id);if(previous&&previous.some(old=>JSON.stringify(old)!==JSON.stringify(row)))throw new Error('HISTORY_FACT_CONFLICT');result.set(id,[...(previous??[]),row]);}
  }
  return [...result.values()].map(rows=>rows.at(-1)!).filter(Boolean);
}
