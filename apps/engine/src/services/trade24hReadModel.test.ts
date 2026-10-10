import {describe,expect,it} from 'vitest';
import type {TradeRecord} from '@zdj/contracts';
import {projectTrade24hReadModel} from './trade24hReadModel.js';

const end=1_800_000_000_000;
const row=(id:string,asset='USDT',net=3,overrides:Partial<TradeRecord>={}):TradeRecord=>({
  tradeId:id,symbol:'BTC'+asset,direction:'LONG',openedAt:end-60_000,closedAt:end-1000,durationMs:59_000,
  entryQty:1,exitQty:1,remainingQty:0,entryAveragePrice:100,exitAveragePrice:104,
  entryFee:.4,exitFee:.6,totalFee:1,funding:null,entryGrossNotional:100,exitGrossNotional:104,
  marginUsed:10,netRoiOnMargin:null,netReturnOnNotional:null,
  entryFillCount:1,exitFillCount:1,feeBreakdown:[],grossRealizedPnl:4,tradingNetPnlExFunding:net,netPnl:null,
  closeReason:'TP',status:'CLOSED',entryRunId:'r',entryIntentId:'i',entryOrderIds:['o'],exitOrderIds:['x'],
  source:'SYSTEM',regime:null,feeCompleteness:'COMPLETE',recordCompleteness:'COMPLETE',classification:'COMPLETE',
  canonical:true,duplicateOf:null,cycleId:id,repairSource:null,linkedFillIds:['f1','f2'],
  missingFacts:[],integrityFlags:[],createdAt:end-60_000,updatedAt:end-1000,
  firstObservedAt:end-60_000,fundingAttributionStatus:'UNKNOWN',pnlBasis:'CANONICAL_NET_WITH_FUNDING_UNKNOWN',...overrides,
});
const project=(records:TradeRecord[],autoSync={status:'ACTIVE',lastSuccessAt:end-1000})=>
  projectTrade24hReadModel({records,asOf:end,autoSync});
describe('24h closed-cycle native-asset PnL',()=>{
  it('reports wins, losses, fees and flat trades separately per asset without requiring funding',()=>{
    const result=project([row('w','USDT',3),row('l','USDT',-2,{grossRealizedPnl:-1,totalFee:1}),row('f','USDT',0,{grossRealizedPnl:1})]);
    expect(result.byAsset.USDT).toMatchObject({cycles:3,winningCycles:1,losingCycles:1,flatCycles:1,
      grossProfit:3,grossLoss:-2,netExFunding:1,totalFees:3,allInConfirmedCycles:0,allInConfirmedNet:null,fundingUnknownCycles:3});
    expect(result.coverage).toMatchObject({eligibleClosedCycles:3,excludedClosedRows:0});
  });
  it('uses half-open [from,to) boundaries without double counting future timestamps',()=>{
    const result=project([row('inclusive','USDT',1,{closedAt:end-86_400_000}),
      row('exclusive','USDT',2,{closedAt:end})]);
    expect(result.byAsset.USDT.cycles).toBe(1);
    expect(result.byAsset.USDT.netExFunding).toBe(1);
  });
  it('does not mix USDT with USDC or convert them to USD',()=>{
    const result=project([row('u','USDT',4),row('c','USDC',-1)]);
    expect(result.aggregate).toMatchObject({status:'MULTIPLE_NATIVE_ASSETS_NO_FX',asset:null,netExFunding:null});
    expect(result.byAsset.USDT.netExFunding).toBe(4);
    expect(result.byAsset.USDC.netExFunding).toBe(-1);
  });
  it('attributes full cycle once by settled close time and quarantines duplicate cycle identity',()=>{
    const result=project([row('old','USDT',50,{closedAt:end-86_400_001}),
      row('dupe1','USDT',8,{cycleId:'shared'}),row('dupe2','USDT',8,{cycleId:'shared'}),
      row('valid','USDC',2),row('external','USDT',7,{source:'EXTERNAL'})]);
    expect(result.coverage).toMatchObject({eligibleClosedCycles:1,cycleCollisionRows:2,excludedClosedRows:3});
    expect(result.byAsset.USDC.cycles).toBe(1);
    expect(result.byAsset.USDT.cycles).toBe(0);
  });
  it('does not mistake observed flat, incomplete fee, missing source or pending sync for completed gains',()=>{
    const result=project([row('flat','USDT',4,{status:'PARTIALLY_CLOSED',closedAt:null,observedClosedAt:end-1000}),
      row('fee','USDT',4,{feeCompleteness:'UNKNOWN',totalFee:null}),
      row('source','USDT',4,{exitOrderIds:[]})],{status:'ERROR',lastSuccessAt:0});
    expect(result.coverage).toMatchObject({eligibleClosedCycles:0,closedObservedWithoutSettledAt:1,excludedClosedRows:2});
    expect(result.byAsset.USDT.netExFunding).toBeNull();
    expect(result.status).toBe('SYNC_COVERAGE_UNCONFIRMED');
  });
  it('retains UNKNOWN when no complete samples exist rather than manufacturing zero profitability',()=>{
    const result=project([]);
    expect(result.byAsset.USDT).toMatchObject({cycles:0,netExFunding:null,grossProfit:null,grossLoss:null});
    expect(result.aggregate.netExFunding).toBeNull();
  });
});
