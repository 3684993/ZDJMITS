export type FinancialClass='financial-profit'|'financial-loss'|'financial-neutral';
export function financialClass(value:unknown):FinancialClass{if(typeof value!=='number'||!Number.isFinite(value)||value===0)return'financial-neutral';return value>0?'financial-profit':'financial-loss';}
export function toggleExpanded(current:string|null,next:string):string|null{return current===next?null:next;}
export function pageItems<T>(items:T[],page:number,pageSize:number):T[]{const size=Math.max(1,pageSize),start=Math.max(0,page-1)*size;return items.slice(start,start+size);}
