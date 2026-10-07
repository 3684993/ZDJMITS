import { AsyncLocalStorage } from 'node:async_hooks';

/** Scoped read cancellation/classification. Writes never inherit a read deadline. */
type ReadContext={signal?:AbortSignal;source?:string};
const context=new AsyncLocalStorage<ReadContext>();
export function binanceReadContext(){return context.getStore();}
export function withBinanceReadContext<T>(value:ReadContext,read:()=>T):T{return context.run({...context.getStore(),...value},read);}
