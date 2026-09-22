import {describe,it,expect} from 'vitest';
import {buildPortfolioRiskSnapshot,type PortfolioPositionFact,type PortfolioPendingRiskFact} from './portfolioRiskSnapshot.js';
import {evaluateHumanCapacity} from './humanCapacityPolicy.js';
const position=(over:Partial<PortfolioPositionFact>={}):PortfolioPositionFact=>({scope:'["TESTNET","a","BTCUSDT","LONG"]',cycleId:'c',symbol:'BTCUSDT',side:'LONG',quantity:1,markPrice:100,leverage:10,quoteAsset:'USDT',marginAsset:'USDT',ownerState:'AI_ACTIVE',factStatus:'VERIFIED',maintenanceMarginUsd:1,liquidationBufferPct:.5,...over});
const pending=(over:Partial<PortfolioPendingRiskFact>={}):PortfolioPendingRiskFact=>({id:'r',dedupeKey:'r',symbol:'BTCUSDT',side:'LONG',notionalUsd:100,marginUsd:10,quoteAsset:'USDT',source:'RESERVATION',factStatus:'VERIFIED',...over});
const snap=(positions:PortfolioPositionFact[]=[],pending:PortfolioPendingRiskFact[]=[])=>buildPortfolioRiskSnapshot({riskGeneration:1,now:1000,peakEquityUsd:1000,assets:[{asset:'USDT',equityUsd:1000,availableMarginUsd:1000,factStatus:'VERIFIED'}],cashFlows:[],positions,pending});
describe('C1 hostile completion regressions',()=>{
  it('missing handoff timestamp blocks new risk, never protection',()=>{
    const snapshot=snap([position({ownerState:'HANDOFF_PENDING',handoffAt:null})]);
    const result=evaluateHumanCapacity({snapshot,profile:{maxHumanPositions:10,maxHumanNotionalUsd:10000,maxPendingHandoffs:10,maxAckAgeMs:50},now:1000});
    expect(result.executable).toBe(false);expect(result.protectionAllowed).toBe(true);
  });
  it('missing dedupe key retains visible risk while blocking admission',()=>{
    const snapshot=snap([],[pending({dedupeKey:''})]);expect(snapshot.complete).toBe(false);expect(snapshot.grossNotionalUsd).toBe(100);expect(snapshot.capitalAtRiskUsd).toBe(10);
  });
  it('same pending lineage cannot silently move asset or side',()=>{
    const snapshot=snap([],[pending(),pending({id:'o',symbol:'ETHUSDT',side:'SHORT'})]);expect(snapshot.complete).toBe(false);
  });
  it('duplicate maintenance or acknowledgement disagreement is a fact conflict',()=>{
    expect(snap([position(),position({maintenanceMarginUsd:2})]).complete).toBe(false);
    expect(snap([position({handoffAt:10}),position({handoffAt:20})]).complete).toBe(false);
  });
  it('invalid owner and fact status never disappear from risk governance',()=>{
    expect(snap([position({ownerState:'INVALID' as never})]).complete).toBe(false);
    expect(snap([position({factStatus:'INVALID' as never})]).complete).toBe(false);
  });
  it('noncanonical scope cannot split authoritative position identities',()=>expect(snap([position({scope:'BTCUSDT:LONG'})]).complete).toBe(false));
  it('snapshot uses a full canonical cryptographic digest',()=>expect(snap([position()]).snapshotHash).toMatch(/^v396r[a-f0-9]{64}$/));
  it('opposite input order yields identical conservative conflicting facts',()=>{
    const a=position(),b=position({ownerState:'HANDOFF_PENDING',handoffAt:900});
    expect(snap([a,b]).snapshotHash).toBe(snap([b,a]).snapshotHash);
  });
});
