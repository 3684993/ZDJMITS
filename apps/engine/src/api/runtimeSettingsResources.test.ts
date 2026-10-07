import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceTransport } from '../adapters/binance/BinanceTransport.js';
import { createRuntimeSettingsResourcesRouter } from './runtimeSettingsResources.js';

const servers:any[]=[];afterEach(async()=>{for(const server of servers.splice(0))await new Promise<void>(resolve=>server.close(()=>resolve()));});
function settings(legacy=false){return{settingsVersion:1,connections:{proxy:{enabled:true,protocol:'SOCKS5H',url:'socks5h://127.0.0.1:20081',forceBinanceRest:!legacy,forceBinanceWs:!legacy,proxyDns:!legacy,binanceRestRoute:legacy?'DIRECT':'CONFIGURED',bypassLocalhost:true,failClosed:!legacy},exchange:{provider:'BINANCE_USDM',environment:'TESTNET',productionBaseUrl:'https://fapi.binance.com',testnetBaseUrl:'https://demo-fapi.binance.com',testnetRestBaseUrl:'https://demo-fapi.binance.com',testnetWsBaseUrl:'wss://stream.binancefuture.com/ws',productionRestBaseUrl:'https://fapi.binance.com',productionWsBaseUrl:'wss://fstream.binance.com/ws',credentialRef:'binance-primary',recvWindowMs:5000,autoTimeSync:true},marketDataMode:'BINANCE',executionMode:'READ_ONLY',aiMode:'OPENAI_COMPATIBLE'},aiResources:[{id:'primary',role:'PRIMARY_BRAIN',enabled:true,baseUrl:'http://127.0.0.1:8084/v1',model:'qwen',maxConcurrency:1,gpu:'gpu'}]};}
async function fixture(legacy=false){const state:any={settings:settings(legacy),aiResources:[]},load=new Map([['primary',{active:0,totalRuns:0,failures:0,lastLatencyMs:null,currentSymbol:null,currentRunId:null,currentStartedAt:null,lastCompletedAt:null,lastDirection:null,lastDecision:null,idleReason:'WAITING_CANDIDATE',nextStep:'wait',queueDepth:0}]]),market={retentionSymbols:vi.fn(()=>new Set(['BTCUSDT'])),stop:vi.fn(),setRetentionSymbols:vi.fn()},runtime:any={state,market,ai:{load,probeResources:vi.fn().mockResolvedValue(undefined)},events:{publish:vi.fn()},settingsStore:{resourceSave:vi.fn().mockResolvedValue(undefined),resourceDelete:vi.fn().mockResolvedValue(undefined)},updateSettings:vi.fn(async(input:any)=>{state.settings={...input,settingsVersion:Number(input.settingsVersion??0)+1};return state.settings;}),updateSettingsIfVersion:vi.fn(async(input:any,expected:number)=>{if(state.settings.settingsVersion!==expected)throw new Error('SETTINGS_VERSION_CONFLICT');state.settings={...input,settingsVersion:expected+1};return state.settings;}),updateResourceSettings:vi.fn(async(input:any,expected:number,mutation:any)=>{if(state.settings.settingsVersion!==expected)throw new Error('SETTINGS_VERSION_CONFLICT');state.settings={...input,settingsVersion:expected+1};if(mutation.operation==='SAVE')runtime.settingsStore.resourceSave(mutation.kind,mutation.value);else runtime.settingsStore.resourceDelete(mutation.kind,mutation.id);return state.settings;}),commitPortfolioRiskAuthority:vi.fn(async(input:any)=>{if(state.settings.settingsVersion!==input.expectedSettingsVersion)throw new Error('SETTINGS_VERSION_CONFLICT');state.settings={...state.settings,settingsVersion:input.expectedSettingsVersion+1};return {settingsVersion:state.settings.settingsVersion,authority:{environment:'TESTNET',margin:{version:'TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_a',contentHash:'a',coverageSymbols:['BTCUSDT'],maintenanceMarginRatePct:0.005,derivation:'ALL_COVERED_TIERS'},correlation:{version:'c'},scenarios:{version:'s',scenarios:[]}},readback:{status:'READY',authority:{marginTierVersion:'TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_a'}}};}),portfolioRiskAuthorityReadback:vi.fn(()=>({status:'PROFILE_NOT_CONFIGURED',authority:{authorityStatus:'NOT_COMMITTED',coverageSymbols:[]},blockers:['MARGIN_AUTHORITY_MISSING']}))};state.aiResources=[];const app=express();app.use(express.json());app.use(createRuntimeSettingsResourcesRouter(runtime));const server=app.listen(0);servers.push(server);await new Promise(resolve=>server.once('listening',resolve));const address=server.address() as any;return{runtime,url:`http://127.0.0.1:${address.port}`};}

describe('runtime settings resource CRUD',()=>{
  it('migrates legacy DIRECT proxy settings to persisted proxy-only truth',async()=>{const{runtime}=await fixture(true);await vi.waitFor(()=>expect(runtime.updateSettingsIfVersion).toHaveBeenCalled());expect(runtime.state.settings.connections.proxy).toMatchObject({binanceRestRoute:'CONFIGURED',forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,failClosed:true});expect(runtime.market.stop).toHaveBeenCalled();expect(runtime.market.setRetentionSymbols).toHaveBeenCalledWith(new Set(['BTCUSDT']));});
  it('persists AI CRUD and keeps enabled Scout in runtime resources',async()=>{const{runtime,url}=await fixture();const item={id:'scout2',role:'SCOUT',baseUrl:'http://127.0.0.1:8081/v1',model:'qwen-scout',maxConcurrency:1,gpu:'B580',enabled:true,status:'READY'};const saved=await fetch(`${url}/settings/resources/ai`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...item,expectedSettingsVersion:1})});expect(saved.status).toBe(200);expect(runtime.updateResourceSettings).toHaveBeenCalledTimes(1);expect(runtime.state.settings.aiResources.map((x:any)=>x.id)).toContain('scout2');expect(runtime.state.settings.aiResources.find((x:any)=>x.id==='scout2')?.enabled).toBe(true);expect(runtime.state.aiResources.map((x:any)=>x.id)).toContain('scout2');expect(runtime.ai.load.has('scout2')).toBe(true);const removed=await fetch(`${url}/settings/resources/ai/scout2`,{method:'DELETE',headers:{'if-match':'2'}});expect(removed.status).toBe(204);expect(runtime.state.settings.aiResources.map((x:any)=>x.id)).not.toContain('scout2');expect(runtime.ai.load.has('scout2')).toBe(false);});
  it('supports multiple proxy resources and changes the live route only on explicit activation',async()=>{const{runtime,url}=await fixture(),transport=new BinanceTransport(runtime.state.settings.connections);const saved=await fetch(`${url}/settings/resources/proxy`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'new-proxy',name:'Singapore',url:'socks5h://127.0.0.1:29999',enabled:true,binanceRestRoute:'DIRECT',forceBinanceRest:false,expectedSettingsVersion:1})});expect(saved.status).toBe(200);expect(runtime.state.settings.connections.proxy).toMatchObject({url:'socks5h://127.0.0.1:20081',activeResourceId:'binance-proxy',binanceRestRoute:'CONFIGURED',forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,failClosed:true});expect((runtime.state.settings.connections.proxy as any).resources.map((x:any)=>x.id)).toEqual(expect.arrayContaining(['binance-proxy','new-proxy']));expect(transport.restRoute().proxyUrl).toBe('socks5h://127.0.0.1:20081');expect(runtime.market.stop).toHaveBeenCalledTimes(0);
    const activeDelete=await fetch(`${url}/settings/resources/proxy/binance-proxy`,{method:'DELETE',headers:{'if-match':'2'}});expect(activeDelete.status).toBe(409);expect(await activeDelete.json()).toMatchObject({error:{code:'ACTIVE_PROXY_DELETE_FORBIDDEN'}});expect(runtime.state.settings.settingsVersion).toBe(2);
    const activated=await fetch(`${url}/settings/resources/proxy/new-proxy/activate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedSettingsVersion:2})});expect(activated.status).toBe(200);expect(runtime.state.settings.connections.proxy).toMatchObject({url:'socks5h://127.0.0.1:29999',activeResourceId:'new-proxy',enabled:true});expect(transport.restRoute().proxyUrl).toBe('socks5h://127.0.0.1:29999');expect(runtime.market.stop).toHaveBeenCalledTimes(1);
    const removed=await fetch(`${url}/settings/resources/proxy/binance-proxy`,{method:'DELETE',headers:{'if-match':'3'}});expect(removed.status).toBe(204);expect((runtime.state.settings.connections.proxy as any).resources.map((x:any)=>x.id)).toEqual(['new-proxy']);expect(runtime.state.settings.connections.proxy.enabled).toBe(true);expect(transport.restRoute().proxyUrl).toBe('socks5h://127.0.0.1:29999');
    const last=await fetch(`${url}/settings/resources/proxy/new-proxy`,{method:'DELETE',headers:{'if-match':'4'}});expect(last.status).toBe(409);expect(await last.json()).toMatchObject({error:{code:'LAST_PROXY_RESOURCE_DELETE_FORBIDDEN'}});
  });
  it('rejects stale resource edits with optimistic concurrency instead of overwriting newer settings',async()=>{const{url}=await fixture();const first=await fetch(`${url}/settings/resources/proxy`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'p1',name:'P1',url:'socks5h://127.0.0.1:29998',expectedSettingsVersion:1})});expect(first.status).toBe(200);const stale=await fetch(`${url}/settings/resources/proxy`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'p2',name:'P2',url:'socks5h://127.0.0.1:29997',expectedSettingsVersion:1})});expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({error:{message:'SETTINGS_VERSION_CONFLICT'},currentSettingsVersion:2});});
  it('applies Binance Demo exchange REST and keeps WS independently configurable',async()=>{const{runtime,url}=await fixture();const saved=await fetch(`${url}/settings/resources/exchange`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({environment:'TESTNET',restBaseUrl:'https://demo-fapi.binance.com',wsBaseUrl:'wss://stream.binancefuture.com/ws',expectedSettingsVersion:1})});expect(saved.status).toBe(200);expect(runtime.state.settings.connections.exchange).toMatchObject({testnetRestBaseUrl:'https://demo-fapi.binance.com',testnetWsBaseUrl:'wss://stream.binancefuture.com/ws'});});

  it('guards active exchange deletion and rejects secret material in resource payloads',async()=>{const{url}=await fixture();const del=await fetch(`${url}/settings/resources/exchange/binance-usdm`,{method:'DELETE',headers:{'if-match':'1'}});expect(del.status).toBe(409);expect(await del.json()).toMatchObject({error:{message:'ACTIVE_EXCHANGE_DELETE_REQUIRES_REPLACEMENT'}});const secret=await fetch(`${url}/settings/resources/exchange/binance-usdm`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({environment:'TESTNET',apiKey:'must-not-persist',expectedSettingsVersion:1})});expect(secret.status).toBeGreaterThanOrEqual(400);});
  it('keeps Exchange Proxy and AI under Resource Manager when generic settings are saved',async()=>{const{runtime,url}=await fixture();const requested=structuredClone(runtime.state.settings);requested.portfolio={...requested.portfolio,maxPositions:9};requested.connections.exchange={...requested.connections.exchange,testnetRestBaseUrl:'https://evil.example'};requested.connections.proxy={...requested.connections.proxy,url:'socks5h://127.0.0.1:29999'};requested.aiResources=[];const response=await fetch(`${url}/settings`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(requested)});expect(response.status).toBe(200);expect(runtime.state.settings.connections.exchange.testnetRestBaseUrl).toBe('https://demo-fapi.binance.com');expect(runtime.state.settings.connections.proxy.url).toBe('socks5h://127.0.0.1:20081');expect(runtime.state.settings.aiResources).toHaveLength(1);});
  it('ignores deprecated static egress input while saving a proxy route',async()=>{const{runtime,url}=await fixture();const saved=await fetch(`${url}/settings/resources/proxy/binance-proxy`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({url:'socks5h://127.0.0.1:20081',expectedStaticEgressIp:'not-an-ip',expectedSettingsVersion:1})});expect(saved.status).toBe(200);expect(runtime.state.settings.connections.proxy.expectedStaticEgressIp).toBeUndefined();});
});

/**
 * The dedicated PortfolioRisk authority channel. It exists because the dataset fields must not be
 * writable as adjectives, and it must stay the only way in: a request that tries to hand the server a
 * version, a rate or a bracket table is refused rather than re-derived from the caller's claim.
 */
const limitsBody={limits:{configured:true,maxCapitalAtRiskUsd:600,maxStressLossUsd:300,maxGrossNotionalUsd:6000,maxDirectionNotionalUsd:4000,maxClusterNotionalUsd:6000,maxHumanNotionalUsd:6000,
  maxDrawdownPct:1,minMarginBufferPct:0,minLiquidationBufferPct:0,maxHumanPositions:8,maxPendingHandoffs:8,maxAckAgeMs:86400000,snapshotTtlMs:20000,cashFlowWindowMs:86400000,cashFlowMaxAgeMs:900000},
  acks:['PORTFOLIO_RISK_PROFILE_ENABLED'],correlation:{clusters:{}},
  scenarios:[{id:'DOWN_10_LIQUIDITY',priceShockPct:-0.1,spreadWidenPct:0.01,fundingShockPct:0.005,markBasisShockPct:-0.01,depthPenaltyPct:0.02,exchangeUnavailable:false,unavailablePenaltyPct:0,clusterConvergencePct:0.5}]};
describe('portfolio risk authority commit channel',()=>{
  it('commits through the dedicated channel and returns the server readback, never the caller values',async()=>{
    const{runtime,url}=await fixture();
    const saved=await fetch(`${url}/settings/portfolio-risk-authority`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...limitsBody,expectedSettingsVersion:1})});
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({settingsVersion:2,profileStatus:'READY',authority:{marginTierVersion:'TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_a'}});
    expect(runtime.commitPortfolioRiskAuthority).toHaveBeenCalledTimes(1);
    expect(runtime.commitPortfolioRiskAuthority.mock.calls[0][0]).toMatchObject({expectedSettingsVersion:1,clusters:{},acks:['PORTFOLIO_RISK_PROFILE_ENABLED']});
    expect(runtime.commitPortfolioRiskAuthority.mock.calls[0][0].limits.marginTierVersion).toBeUndefined();
  });
  it('H2/H7 refuses a request that carries a version, a rate or a bracket table',async()=>{
    const{runtime,url}=await fixture();
    for(const forged of [{marginTierVersion:'TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_'+'0'.repeat(64)},{maintenanceMarginRatePct:0.0001},{brackets:[{symbol:'BTCUSDT'}]},{credentialRef:'other'}]){
      const call=await fetch(`${url}/settings/portfolio-risk-authority`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...limitsBody,...forged,expectedSettingsVersion:1})});
      expect(call.status,JSON.stringify(forged)).toBe(400);
      expect((await call.json()).error.code).toBe('PORTFOLIO_RISK_AUTHORITY_FIELD_IS_SERVER_DERIVED');
    }
    const nested=await fetch(`${url}/settings/portfolio-risk-authority`,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({...limitsBody,marginTier:{version:'anything'},expectedSettingsVersion:1})});
    expect(nested.status).toBe(400);expect((await nested.json()).error.fields).toContain('marginTier');
    expect(runtime.commitPortfolioRiskAuthority).not.toHaveBeenCalled();
    expect(runtime.state.settings.settingsVersion).toBe(1);
  });
  it('H1 fails closed with the real blockers and writes nothing when the facts cannot be proven',async()=>{
    const{runtime,url}=await fixture();
    runtime.commitPortfolioRiskAuthority.mockRejectedValueOnce(Object.assign(new Error('PORTFOLIO_RISK_AUTHORITY_UNPROVEN:MARGIN_BRACKET_MISSING:SOLUSDT'),{blockers:['MARGIN_BRACKET_MISSING:SOLUSDT','MARGIN_BRACKET_SET_EMPTY:DOGEUSDT']}));
    const refused=await fetch(`${url}/settings/portfolio-risk-authority`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...limitsBody,expectedSettingsVersion:1})});
    expect(refused.status).toBe(423);
    expect(await refused.json()).toMatchObject({error:{code:'PORTFOLIO_RISK_AUTHORITY_UNPROVEN',blockers:['MARGIN_BRACKET_MISSING:SOLUSDT','MARGIN_BRACKET_SET_EMPTY:DOGEUSDT']}});
    expect(runtime.state.settings.settingsVersion).toBe(1);
    const stale=await fetch(`${url}/settings/portfolio-risk-authority`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...limitsBody,expectedSettingsVersion:9})});
    expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({error:{message:'SETTINGS_VERSION_CONFLICT'}});
  });
  it('reports the durable authority state on readback instead of an inferred READY',async()=>{
    const{runtime,url}=await fixture();
    const read=await fetch(`${url}/settings/portfolio-risk-authority`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({settingsVersion:1,profileStatus:'PROFILE_NOT_CONFIGURED',authority:{authorityStatus:'NOT_COMMITTED'}});
    expect(runtime.portfolioRiskAuthorityReadback).toHaveBeenCalled();
  });
  it('previews a collection without persisting anything, and still refuses forged fields',async()=>{
    const{runtime,url}=await fixture();
    runtime.collectPortfolioRiskAuthorityPreview=vi.fn(async()=>({persisted:true,ok:false,blockers:['MAINTENANCE_RATE_EXCEEDS_PROFILE_BOUND:0.2:ZECUSDT'],perSymbol:[],wouldCommit:null}));
    const call=await fetch(`${url}/settings/portfolio-risk-authority/preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({limits:limitsBody.limits,correlation:limitsBody.correlation,scenarios:limitsBody.scenarios})});
    expect(call.status).toBe(200);
    // The route owns the "nothing was written" claim; whatever the service reports cannot overwrite it.
    const body=await call.json();
    expect(body).toMatchObject({persisted:false,blockers:['MAINTENANCE_RATE_EXCEEDS_PROFILE_BOUND:0.2:ZECUSDT']});
    expect(runtime.commitPortfolioRiskAuthority).not.toHaveBeenCalled();
    expect(runtime.state.settings.settingsVersion).toBe(1);
    const forged=await fetch(`${url}/settings/portfolio-risk-authority/preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({limits:{...limitsBody.limits,contentHash:'x'},correlation:limitsBody.correlation,scenarios:limitsBody.scenarios})});
    expect(forged.status).toBe(400);expect((await forged.json()).error.code).toBe('PORTFOLIO_RISK_AUTHORITY_FIELD_IS_SERVER_DERIVED');
    expect(runtime.collectPortfolioRiskAuthorityPreview).toHaveBeenCalledTimes(1);
  });
  it('H10 keeps refusing a whole-settings PUT that tries to name a dataset version',async()=>{
    const{runtime,url}=await fixture();
    const requested=structuredClone(runtime.state.settings);
    requested.riskGovernance={...(requested.riskGovernance??{}),portfolioRisk:{configured:true,marginTierVersion:'forged-by-put',maintenanceMarginRatePct:0.0001,correlationVersion:'forged',scenarioVersion:'forged'}};
    const call=await fetch(`${url}/settings`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...requested,expectedSettingsVersion:1})});
    expect(call.status).toBe(400);
    const blocked=(await call.json()).error.blockedPaths;
    expect(blocked).toEqual(expect.arrayContaining(['riskGovernance.portfolioRisk.marginTierVersion','riskGovernance.portfolioRisk.maintenanceMarginRatePct','riskGovernance.portfolioRisk.correlationVersion','riskGovernance.portfolioRisk.scenarioVersion']));
    expect(runtime.updateSettingsIfVersion).not.toHaveBeenCalled();
  });
});
