import {expect,it,vi} from 'vitest';
import {EntryLeverageFactRecovery,entryLeverageTiers} from './entryLeverageFacts.js';
import {harness} from './tradingQualityTestHarness.js';
const identity={environment:'TESTNET',credentialFingerprint:'a'.repeat(64),credentialGeneration:1};
const adapter=(read:any)=>({fetchMaintenanceMarginBrackets:read,accountScopeIdentity:()=>identity});
const bracket={bracket:1,initialLeverage:20,notionalCap:500000,notionalFloor:0,maintMarginRatio:.005,cum:0};
const setup=()=>{const h=harness();h.state.marginTierCoverage={symbols:[],tiersBySymbol:{}} as any;return h;};
it('collects bounded signed-read facts for missing executable symbols without changing Settings or risk authority',async()=>{
  const h=setup(),before=JSON.stringify(h.state.settings),read=vi.fn(async(symbols:string[],options:any)=>({environment:'TESTNET',credentialRef:options.credentialRef,observedAt:Date.now(),accountIdentity:{...identity,proof:'SIGNED_TESTNET_GET'},symbols:symbols.map(symbol=>({symbol,brackets:[bracket]})),failures:[]}));
  const recovery=new EntryLeverageFactRecovery(h.state,adapter(read) as any,h.bus);
  await recovery.refreshMissing();expect(read).toHaveBeenCalledOnce();expect(read.mock.calls[0]![0]).toEqual([h.packet.symbol]);expect(read.mock.calls[0]![1].maxInFlight).toBe(1);
  expect(entryLeverageTiers(h.state,h.packet.symbol,Date.now())[0]?.initialLeverage).toBe(20);expect(JSON.stringify(h.state.settings)).toBe(before);expect(h.state.marginTierCoverage?.symbols).toEqual([]);
  await recovery.refreshMissing();expect(read).toHaveBeenCalledOnce();expect(entryLeverageTiers(h.state,h.packet.symbol,Date.now()+600001)).toEqual([]);
});
it.each(['PRODUCTION','wrong-account','invalid-ladder','missing-symbol'])('fails closed on %s instead of inventing leverage',async(kind)=>{
  const h=setup(),read=vi.fn(async(_symbols:string[],options:any)=>({environment:kind==='PRODUCTION'?'PRODUCTION':'TESTNET',credentialRef:kind==='wrong-account'?'other':options.credentialRef,observedAt:Date.now(),accountIdentity:{...identity,proof:'SIGNED_TESTNET_GET'},symbols:kind==='missing-symbol'?[]:[{symbol:h.packet.symbol,brackets:[kind==='invalid-ladder'?{...bracket,initialLeverage:0}:bracket]}],failures:[]}));
  await new EntryLeverageFactRecovery(h.state,adapter(read) as any,h.bus).refreshMissing();expect(entryLeverageTiers(h.state,h.packet.symbol,Date.now())).toEqual([]);expect(h.events.some(x=>x.type==='ENTRY_LEVERAGE_FACT_UNAVAILABLE')).toBe(true);
});
it('has one in-flight batch, per-minute backoff, and never reads for both-side no-add occupancy',async()=>{
  const h=setup();let reject!:(e:Error)=>void;const read=vi.fn(()=>new Promise<any>((_,r)=>{reject=r;})),recovery=new EntryLeverageFactRecovery(h.state,adapter(read) as any,h.bus);
  const a=recovery.refreshMissing();await recovery.refreshMissing();expect(read).toHaveBeenCalledOnce();reject(Error('network'));await a;await recovery.refreshMissing();expect(read).toHaveBeenCalledOnce();
  (h.state as any).noAddOriginReader=()=>({intentId:'origin',clientOrderId:'c',quantity:1,createdAt:1});await recovery.refreshMissing(Date.now()+60001);expect(read).toHaveBeenCalledOnce();
});

it.each(['same-ref-other-key','credential-generation','missing-proof'])('rejects authenticated identity mismatch %s',async(kind)=>{
 const h=setup(),read=vi.fn(async()=>({environment:'TESTNET',credentialRef:h.state.settings.connections.exchange.credentialRef,observedAt:Date.now(),accountIdentity:kind==='missing-proof'?undefined:{...identity,proof:'SIGNED_TESTNET_GET',credentialFingerprint:kind==='same-ref-other-key'?'b'.repeat(64):identity.credentialFingerprint,credentialGeneration:kind==='credential-generation'?2:1},symbols:[{symbol:h.packet.symbol,brackets:[bracket]}],failures:[]}));
 await new EntryLeverageFactRecovery(h.state,adapter(read) as any,h.bus).refreshMissing();expect(entryLeverageTiers(h.state,h.packet.symbol,Date.now())).toEqual([]);
});
it('invalidates cached facts on credential rotation with unchanged credentialRef',async()=>{
 const h=setup();let current={...identity};const read=vi.fn(async()=>({environment:'TESTNET',credentialRef:h.state.settings.connections.exchange.credentialRef,observedAt:Date.now(),accountIdentity:{...current,proof:'SIGNED_TESTNET_GET'},symbols:[{symbol:h.packet.symbol,brackets:[bracket]}],failures:[]}));
 await new EntryLeverageFactRecovery(h.state,{fetchMaintenanceMarginBrackets:read,accountScopeIdentity:()=>current} as any,h.bus).refreshMissing();expect(entryLeverageTiers(h.state,h.packet.symbol,Date.now())).toHaveLength(1);
 current={...current,credentialGeneration:2};expect(entryLeverageTiers(h.state,h.packet.symbol,Date.now())).toEqual([]);
});
