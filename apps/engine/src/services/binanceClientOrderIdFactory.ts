import { createHash, randomBytes } from 'node:crypto';

/** Binance's client id is an exchange transport identifier, never an internal UUID. */
export class BinanceClientOrderIdFactory {
  private sequence=0;
  create(action:'MR'|'MA'|'ML'|'MC'|'EC1'|'EC2'|'EC3'|'TP'|'CX', internalId?:string){
    const prefix=action.toLowerCase(), stamp=Date.now().toString(36), seq=(this.sequence++%46656).toString(36).padStart(3,'0'), entropy=randomBytes(2).toString('hex');
    const id=`${prefix}_${stamp}_${seq}${entropy}`.replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,35);
    if(id.length>35||!/^[.A-Za-z0-9_:-]{1,35}$/.test(id))throw new Error('BINANCE_CLIENT_ORDER_ID_INVALID');
    return id;
  }
  stable(action:'ML', internalId:string){
    const digest=createHash('sha256').update(`${action}:${internalId}`).digest('hex').slice(0,28);
    return this.assert(`${action.toLowerCase()}_${digest}`);
  }
  assert(value:string){if(!/^[.A-Za-z0-9_:-]{1,35}$/.test(value))throw new Error(`BINANCE_CLIENT_ORDER_ID_INVALID:${value.length}`);return value;}
}
export const binanceClientOrderIdFactory=new BinanceClientOrderIdFactory();
