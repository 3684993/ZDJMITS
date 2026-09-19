import { describe, expect, it } from 'vitest';
import { projectHumanManaged } from './humanManagedProjection.js';

describe('HUMAN_MANAGED projection',()=>{
  it('shows only manual-handoff positions and never grants auto-exit authority',()=>{
    const state:any={
      account:{equityUsd:10_000},
      settings:{positionManagement:{humanManagedAdmissionCapsEnabled:true,maxHumanManagedPositions:2,maxHumanManagedNotionalPctEquity:.2}},
      positions:new Map([
        ['h',{id:'h',symbol:'BTCUSDT',side:'LONG',quantity:.1,entryPrice:100_000,markPrice:90_000,leverage:10,unrealizedPnl:-1000,unrealizedPnlPercent:-10,openedAt:1,humanManagedAt:2,managementStatus:'HUMAN_MANAGED',tpOrderId:'tp',tpStatus:'PROTECTED',tpCoverageSource:'BINANCE_OPEN_ORDER'}],
        ['a',{id:'a',symbol:'ETHUSDT',side:'LONG',quantity:1,entryPrice:1000,markPrice:1100,leverage:10,unrealizedPnl:100,unrealizedPnlPercent:10,openedAt:1,managementStatus:'AUTO_MANAGED',tpStatus:'PROTECTED'}],
      ]),
      tpOrders:new Map([['tp',{id:'tp',positionId:'h',status:'WORKING',price:105_000}]]),
      tradeRecords:new Map([['t',{positionId:'h',status:'OPEN',symbol:'BTCUSDT',direction:'LONG',funding:-5,fundingAttributionStatus:'EXACT'}]]),
    };
    const result=projectHumanManaged(state);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].symbol).toBe('BTCUSDT');
    expect(result.items[0].automationPermission).toBe(false);
    expect(result.items[0].allowedHumanActions).toContain('EMERGENCY_CLOSE');
    expect(result.policy.severityMayAutoExit).toBe(false);
  });
});
