export function privateAccountFresh(account:{status:string;asOf:number|null},now=Date.now()){
 return account.status==='READY'&&typeof account.asOf==='number'&&Number.isFinite(account.asOf)&&now-account.asOf<=60_000&&account.asOf-now<=5000;
}
