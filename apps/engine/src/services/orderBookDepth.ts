/**
 * P6: executable depth from the order book the Engine actually holds.
 *
 * The AI-exit cost facts asked for `quote.depthNotionalUsd`, a field no production path ever filled,
 * so every real exit attempt reported `EXIT_DEPTH_INSUFFICIENT` (R7: 11 124 AI_EXIT_FACTS_INCOMPLETE
 * in the retained window) while unit tests that hand-set the field passed. Depth is therefore
 * computed here from the book, against the direction, the price bound and the quantity of the order
 * being considered - a top-of-book number is not a claim that a whole position can be filled.
 */

export type BookSide={bids:Array<[number,number]|{price:number;quantity:number}>;asks:Array<[number,number]|{price:number;quantity:number}>;ts:number;sequence?:number|null;lastUpdateId?:number|string|null};

const level=(row:[number,number]|{price:number;quantity:number})=>{
  if(Array.isArray(row))return{price:Number(row[0]),quantity:Number(row[1])};
  return{price:Number(row?.price),quantity:Number(row?.quantity)};
};

export type ExecutableDepth={
  /** Notional inside the bound that this side of the book can absorb, in the contract's quote asset. */
  executableNotionalUsd:number|null;
  /** Quantity absorbable inside the bound, same unit as the position quantity. */
  executableQuantity:number|null;
  levelsUsed:number;
  /** The furthest price actually consumed; null when nothing was walkable. */
  worstPriceUsed:number|null;
  walkedWholeBook:boolean;
  bookAgeMs:number;
  source:'ORDER_BOOK';
  sequence:number|null;
  /** Why there is no number. A refusal must be attributable, never defaulted to zero. */
  reason:string|null;
};

/**
 * Walks the book from the inside out and stops at the caller's price bound.
 *
 * `boundPrice` is the limit the exit would post at: for a LONG being closed with a SELL, the bids; for
 * a SHORT closed with a BUY, the asks. A missing or stale book returns a null with a reason - the
 * caller then keeps the fact UNKNOWN instead of passing a fabricated depth through the gate.
 */
export function executableDepth(input:{side:'LONG'|'SHORT';quantity:number;boundPrice:number|null;book:BookSide|null|undefined;now:number;maxAgeMs:number}):ExecutableDepth{
  const empty=(reason:string):ExecutableDepth=>({executableNotionalUsd:null,executableQuantity:null,levelsUsed:0,worstPriceUsed:null,walkedWholeBook:false,
    bookAgeMs:input.book?Math.max(0,input.now-Number(input.book.ts??0)):Number.NaN,source:'ORDER_BOOK',sequence:null,reason});
  if(!input.book)return empty('ORDER_BOOK_ABSENT');
  if(input.book.ts==null||!Number.isFinite(Number(input.book.ts)))return empty('ORDER_BOOK_UNSTAMPED');
  const age=input.now-Number(input.book.ts);
  if(!(age>=0&&age<=Math.max(1_000,input.maxAgeMs)))return {...empty('ORDER_BOOK_STALE'),bookAgeMs:Math.max(0,age)};
  if(!Number.isFinite(input.quantity)||input.quantity<=0)return empty('QUANTITY_UNPROVEN');
  if(!(Number.isFinite(Number(input.boundPrice))&&Number(input.boundPrice)>0))return empty('PRICE_BOUND_UNPROVEN');
  // Closing a LONG sells into the bids, and only at or above the bound; closing a SHORT buys the asks
  // at or below it. Reading the wrong side would overstate how much of the position can leave.
  const raw=input.side==='LONG'?input.book.bids:input.book.asks;
  if(!Array.isArray(raw)||!raw.length)return empty(input.side==='LONG'?'BIDS_EMPTY':'ASKS_EMPTY');
  const bound=Number(input.boundPrice);
  const levels=raw.map(level).filter(row=>Number.isFinite(row.price)&&row.price>0&&Number.isFinite(row.quantity)&&row.quantity>0);
  if(levels.length!==raw.length)return empty('BOOK_LEVEL_UNPARSEABLE');
  const usable=levels.filter(row=>input.side==='LONG'?row.price>=bound:row.price<=bound);
  if(!usable.length)return{...empty(input.side==='LONG'?'NO_BID_AT_OR_ABOVE_BOUND':'NO_ASK_AT_OR_BELOW_BOUND'),levelsUsed:0,
    worstPriceUsed:null,bookAgeMs:Math.max(0,age),sequence:Number.isFinite(Number(input.book.sequence))?Number(input.book.sequence):null};
  const ordered=input.side==='LONG'?[...usable].sort((a,b)=>b.price-a.price):[...usable].sort((a,b)=>a.price-b.price);
  let quantity=0,notional=0,used=0,worst: number|null=null;
  for(const row of ordered){
    const take=Math.min(row.quantity,Math.max(0,input.quantity-quantity));
    quantity+=take;notional+=take*row.price;used++;worst=row.price;
    if(quantity>=input.quantity-1e-12)break;
  }
  return{executableNotionalUsd:notional,executableQuantity:quantity,levelsUsed:used,worstPriceUsed:worst,
    walkedWholeBook:used>=ordered.length,bookAgeMs:Math.max(0,age),source:'ORDER_BOOK',
    sequence:Number.isFinite(Number(input.book.sequence))?Number(input.book.sequence):null,reason:null};
}

/** True when the whole position can leave inside the bound; a null depth never counts as enough. */
export function depthCoversQuantity(depth:ExecutableDepth,quantity:number){
  return depth.executableQuantity!=null&&depth.executableQuantity+1e-12>=Math.max(0,quantity);
}
