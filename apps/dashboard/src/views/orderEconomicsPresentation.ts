/** An open-orders adapter may supply a placeholder 1x leverage. It is not a margin fact. */
export function orderEconomicsPresentation(order:any):{leverage:number|null;initialMarginQuote:number|null}{
  const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
  const local=order?.leverageVerified===true&&positive(order.leverage)?order.leverage:null;
  const mandate=order?.economicMandate?.sizing?.leverage;
  const leverage=local??(positive(mandate)?mandate:null);
  return {leverage,initialMarginQuote:leverage!==null&&positive(order?.quantity)&&positive(order?.price)?order.quantity*order.price/leverage:null};
}
