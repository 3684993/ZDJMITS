/** Bounded evidence of actual trades, never inferred from OHLC ranges or quotes. */
export class RecentTradePrices {
  private rows=new Map<string,Map<number,number>>();
  record(symbol:string,price:number,at:number,now=Date.now()) {
    if(!Number.isFinite(price)||price<=0||!Number.isFinite(at)||at>now+1000||now-at>300000)return;
    const rows=this.rows.get(symbol)??new Map<number,number>();
    const previous=rows.get(price);if(previous!==undefined&&previous>at)return;
    rows.delete(price);rows.set(price,at);
    while(rows.size>4096)rows.delete(rows.keys().next().value!);
    this.rows.set(symbol,rows);
  }
  near(symbol:string,bid:number,ask:number,tick:number,now=Date.now()) {
    const rows=this.rows.get(symbol);if(!rows)return [];
    for(const [price,at] of rows)if(now-at>300000||at>now+1000)rows.delete(price);
    return [...rows].filter(([price])=>price>=bid-2*tick-tick*1e-8&&price<=ask+2*tick+tick*1e-8)
      .sort((a,b)=>b[1]-a[1]).slice(0,16).map(([price,lastSeenAt])=>({price,lastSeenAt}));
  }
  retain(symbols:Set<string>){for(const symbol of this.rows.keys())if(!symbols.has(symbol))this.rows.delete(symbol);}
}
