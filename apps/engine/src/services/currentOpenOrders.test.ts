import {describe,expect,it,vi} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {ReconciliationService} from './reconciliationService.js';
import {projectCurrentOpenOrders,exchangeOrderIdentityMatch} from './currentOpenOrders.js';

const order=(over:any={})=>({id:'local',symbol:'BTCUSDT',clientOrderId:'client',exchangeOrderId:'remote',side:'LONG',status:'WORKING',quantity:1,price:100,filledQuantity:0,updatedAt:10,...over});
const state=()=>new RuntimeState({takeProfit:{enabled:true}} as any);
describe('complete exchange open-order projection',()=>{
  it('separates historical UNKNOWN from remote-confirmed orders without mutation',()=>{
    const s=state(),unknown=order({id:'old',clientOrderId:'old',exchangeOrderId:null,status:'UNKNOWN'}),local=order({intentId:'intent',cycleId:'cycle',reservationId:'claim',leverage:20,absoluteExpiresAt:9999,decisionCompletedAt:100,decisionExecutionExpiresAt:60100,selectedCandidateId:'candidate',candidateSetHash:'hash',opportunityAuthorization:{opportunityId:'opp',eventExpiresAt:90000}});
    s.entryOrders.set('old',unknown);s.entryOrders.set('local',local);
    const before=JSON.stringify(s.serialize());
    const read=projectCurrentOpenOrders(s,[order({id:'client',leverage:1,decisionCompletedAt:0,decisionExecutionExpiresAt:0,selectedCandidateId:'old',candidateSetHash:'old',opportunityAuthorization:undefined})],100,300,101);
    expect(read.entry).toMatchObject({status:'READY',verifiedAt:100,validUntil:400,items:[{id:'local',intentId:'intent',leverage:20,decisionCompletedAt:100,decisionExecutionExpiresAt:60100,selectedCandidateId:'candidate',candidateSetHash:'hash',opportunityAuthorization:{opportunityId:'opp',eventExpiresAt:90000}}]});
    expect(JSON.stringify(s.serialize())).toBe(before);
  });
  it('preserves main intent economics and local leverage instead of the remote 1x placeholder',()=>{
    const s=state(),mandate={mandateId:'main-mandate',sizing:{leverage:20},economics:{expectedNetQuote:4,minimumNetProfitQuote:1}};
    s.entryOrders.set('local',order({intentId:'intent',leverage:20}));s.entryIntents.set('intent',{id:'intent',economicMandate:mandate} as any);
    expect(projectCurrentOpenOrders(s,[order({leverage:1})],100,300,101).entry.items[0]).toMatchObject({leverage:20,leverageVerified:true,economicMandate:mandate});
    expect(projectCurrentOpenOrders(s,[order({id:'external',clientOrderId:'external',exchangeOrderId:'unknown-remote',leverage:1})],100,300,101).entry.items[0]).toMatchObject({leverageVerified:false});
  });
  it('cannot claim a zero or current order count from an unavailable/stale snapshot',()=>{
    const s=state();expect(projectCurrentOpenOrders(s,[],0,300,100).entry.status).toBe('UNAVAILABLE');
    expect(projectCurrentOpenOrders(s,[order()],100,300,401).entry).toMatchObject({status:'STALE',items:[{id:'local'}]});
    expect(projectCurrentOpenOrders(s,[],100,300,101,'private sync failed').entry.status).toBe('STALE');
  });
  it('keeps manually-created orders in their own projection with BUY/SELL intact',()=>{
    const s=state();s.manualOrders.set('manual',order({id:'manual',positionId:'p',side:'BUY',type:'LIMIT'}));
    const read=projectCurrentOpenOrders(s,[order({id:'client'})],100,300,101);
    expect(read.entry.items).toEqual([]);expect(read.manual.items).toMatchObject([{id:'manual',positionId:'p',side:'BUY'}]);
  });
  it.each(['TP','EXIT','MANUAL'])('does not expose registered %s as cancellable Entry despite legacy adapter shape',role=>{
    const s=state();s.orderProvenance={resolve:()=>({status:'SYSTEM_PROVEN',rows:[{role}]})} as any;
    expect(projectCurrentOpenOrders(s,[order({clientOrderId:'v396xopaque'})],100,300,101).entry.items).toEqual([]);
  });
  it('keeps a locally proven TP out even without a registry',()=>{
    const s=state();s.tpOrders.set('tp',order({side:'SELL'}));
    expect(projectCurrentOpenOrders(s,[order()],100,300,101).entry.items).toEqual([]);
  });
  it('FILLED and later cancellation facts suppress an older open snapshot',()=>{
    for(const status of ['FILLED','CANCELED']){const s=state();s.entryOrders.set('local',order({status,updatedAt:200}));
      expect(projectCurrentOpenOrders(s,[order()],100,300,201).entry.items).toEqual([]);}
  });
  it('never matches empty identities, mismatched symbol or conflicting secondary identity',()=>{
    expect(exchangeOrderIdentityMatch({symbol:'BTCUSDT'},{symbol:'BTCUSDT'})).toBe(false);
    expect(exchangeOrderIdentityMatch(order(),order({symbol:'ETHUSDT'}))).toBe(false);
    expect(exchangeOrderIdentityMatch(order(),order({exchangeOrderId:'wrong'}))).toBe(false);
  });
  it('deduplicates the same remote row and excludes unknown remote status',()=>{
    const s=state(),remote=order();expect(projectCurrentOpenOrders(s,[remote,remote,order({status:'UNKNOWN'})],100,300,101).entry.items).toHaveLength(1);
  });
  it('reconciliation readers cause no adapter requests',()=>{
    const s=state(),adapter={fetchPositions:vi.fn(),fetchOpenOrders:vi.fn()},service=new ReconciliationService(adapter as any,s,new EventBus(),{} as any);
    expect(service.currentOpenEntryOrders().status).toBe('UNAVAILABLE');expect(service.currentOpenManualOrders().items).toEqual([]);
    expect(adapter.fetchPositions).not.toHaveBeenCalled();expect(adapter.fetchOpenOrders).not.toHaveBeenCalled();
  });
});
