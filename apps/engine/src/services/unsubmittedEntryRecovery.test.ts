import {it,expect} from 'vitest';
import {recoverUnsubmittedEntry} from './unsubmittedEntryRecovery.js';
const order:any={id:'o',intentId:'i',status:'UNKNOWN',exchangeOrderId:null,filledQuantity:0};
const blocked:any={type:'ENTRY_ORDER_BLOCKED',payload:{intentId:'i',stage:'BINANCE_SUBMIT',reason:'RISK_MAX_POSITIONS'}};
it('recovers a proven pre-submit rejection without fabricating an exchange terminal',()=>{expect(recoverUnsubmittedEntry(order,new Set(),[blocked])).toMatchObject({status:'REJECTED',factSource:'LOCAL_NOT_SUBMITTED'});});
it('never releases a durable or attempted submission, missing evidence or partial fill',()=>{for(const [o,ids,events] of [[order,new Set(['i']),[blocked]],[order,new Set(),[blocked,{type:'ENTRY_SUBMIT_ATTEMPTED',payload:{intentId:'i'}}]],[order,new Set(),[]],[{...order,filledQuantity:1},new Set(),[blocked]],[{...order,exchangeOrderId:'remote'},new Set(),[blocked]]] as any[])expect(recoverUnsubmittedEntry(o,ids,events)).toBeNull();});
