/** Symbols with an actual order creation or execution inside an audit window.
 * Reconciliation may refresh updatedAt on an old terminal order without any trade. */
export function tradeAuditProvenanceSymbols(
  orders:Iterable<{symbol:string;createdAt:number}>,
  fills:Iterable<{symbol:string;executionTime:number}>,start:number,end:number,
):string[]{
  const valid=(symbol:string)=>/^[A-Z0-9]{3,20}(USDT|USDC|BUSD)$/.test(symbol);
  const symbols=new Set<string>();
  for(const order of orders)if(order.createdAt>=start&&order.createdAt<=end){
    const symbol=String(order.symbol).toUpperCase();if(valid(symbol))symbols.add(symbol);
  }
  for(const fill of fills)if(fill.executionTime>=start&&fill.executionTime<=end){
    const symbol=String(fill.symbol).toUpperCase();if(valid(symbol))symbols.add(symbol);
  }
  return [...symbols];
}
