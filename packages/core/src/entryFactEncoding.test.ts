import {describe,expect,it} from 'vitest';
import {decodeEntryFacts,encodeEntryFacts,ENTRY_FACT_ENCODING_INSTRUCTIONS} from './entryFactEncoding.js';
import {expandTableValues} from './entryTableDedup.js';

const normalize=(value:unknown)=>JSON.parse(JSON.stringify(value));
const now=1790700202899;
const decisionFrames=['1m','5m','15m','1h','4h','1d','1w'];
const referenceFrames=['15m','1h','4h','1d','1w'];
function card(prefix:string,frame:string,index:number):any {
  return {
    factId:`${prefix}.${frame}.confirmed`,role:['1m','5m'].includes(frame)?'TIMING':'MARKET_STRUCTURE',
    observedAt:now,asOf:now-1000-index,receivedAt:now-900-index,isClosed:true,source:'BINANCE_WS',
    trend:'UP',trendStrength:.812345,ema8:101.123,ema21:99.1234,ema55:98.4567,emaSlope21:-.0000123456,
    macdLine:.0123456,macdSignal:.000123456,macdHistogram:-1.23456e-100,macdHistogramSlope:0,
    macdCrossDirection:'BULLISH',macdCrossAgeBars:0,bbPosition:.712345,bbBandwidth:.00123456,
    bbUpper:103.123,bbMiddle:100.123,bbLower:97.123,atr14:.512345,atrPercent:.412345,volumeZScore:-.712345,
    swingLow:97.123456789123,swingHigh:105.987654321987,higherHighs:2,higherLows:1,lowerHighs:0,lowerLows:0,
    lastClosedBar:{openTime:now-61000-index,closeTime:now-1000-index,open:100.123456789123,
      high:102.123456789123,low:99.123456789123,close:101.123456789123,volume:123456.789123456},
    inProgressBar:{openTime:now-999-index,closeTime:now+59000-index,receivedAt:now-100,elapsedRatio:.123456789123,
      lastPrice:101.123456789123,volume:98765.432198765,source:'BINANCE_WS'},
  };
}
function facts():any {
  const technical=(prefix:string,frames:string[])=>Object.fromEntries(frames.map((frame,index)=>[frame,card(prefix,frame,index)]));
  return {
    contract:'V3.9.3-AUTONOMOUS-DIRECTION-SIZING',
    MARKET_FACTS:{
      symbol:{identity:{symbol:'SUIUSDT',packetId:'exact-original-packet',observedAt:now,expiresAt:now+90000},
        quote:{factId:'quote.top',bid:.987654321987,ask:.987754321987,last:.987704321987,mark:.987703321987,receivedAt:now-5},
        technical:technical('technical',decisionFrames),
        derivatives:{fundingRate:-.00000123456789,openInterest:null,ts:now-500},
        orderBook:{bids:[[.987654321987,123.123456789]],asks:[[.987754321987,124.987654321]],receivedAt:now-7},
        recentTrades:{recentTradedPrices:[{price:.987704321987,lastSeenAt:now-10}],missingRecentTradeEvidence:false}},
      BTC:{symbol:'BTCUSDT',quote:{last:84660.5,mark:84661.123456789,ts:now-10},technical:technical('btc',referenceFrames)},
      ETH:{symbol:'ETHUSDT',quote:{last:1234.123456789123,mark:1234.123456789123,ts:now-20},technical:technical('eth',referenceFrames)},
      economics:{makerFeeBps:2,takerFeeBps:4,minimumEconomicEdgeBps:10},
      portfolio:{activePositions:0,pendingEntries:0},experience:{sampleSize:0,sameSymbolWinRate:null,recentLessons:[]},externalContext:[],
    },
    EXECUTION_ENVELOPE:{createdAt:now,expiresAt:now+90000,leaseId:'lease-kept',leaseExpiresAt:now+195000,
      exchange:{tickSize:.00000001,stepSize:.00000001,minQty:.00000001,minNotional:5.123456789},
      LONG:{executable:true,maxNotionalUsd:497.5123456789,maxQuantityUnits:123456789,minQuantityUnits:2,riskHeadroom:{remaining:123.123456789}},
      SHORT:{executable:false,maxNotionalUsd:0,maxQuantityUnits:0,minQuantityUnits:2,riskHeadroom:{reason:'EXACT_BLOCKER'}},
      notice:'EXECUTION FACTS ARE NOT MARKET SIGNALS.'},
    validFactIds:['quote.top',...decisionFrames.map(tf=>`technical.${tf}.confirmed`),...['btc','eth'].flatMap(prefix=>referenceFrames.map(tf=>`${prefix}.${tf}.confirmed`))],
  };
}
function freeze<T>(value:T):T {
  if(value!==null&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}
  return value;
}
const wireRoundtrip=(value:unknown)=>decodeEntryFacts(normalize(encodeEntryFacts(value)));
function duplicatedBtcFacts():any {
  const original=facts();original.MARKET_FACTS.symbol.identity.symbol='BTCUSDT';
  original.MARKET_FACTS.BTC.technical=Object.fromEntries(referenceFrames.map(frame=>[frame,{
    ...structuredClone(original.MARKET_FACTS.symbol.technical[frame]),factId:`btc.${frame}.confirmed`,
  }]));
  return original;
}

describe('lossless entry fact table encoding',()=>{
  it('round-trips every JSON field, all 17 cards, exact prices, IDs and original times',()=>{
    const original=facts(),encoded=encodeEntryFacts(original),decoded=decodeEntryFacts(normalize(encoded));
    expect(decoded).toEqual(normalize(original));
    expect(encoded.technicalTables.flatMap(table=>table.rows)).toHaveLength(17);
    expect(Object.keys((decoded as any).MARKET_FACTS.symbol.technical)).toEqual(decisionFrames);
    for(const market of ['BTC','ETH'])expect(Object.keys((decoded as any).MARKET_FACTS[market].technical)).toEqual(referenceFrames);
    expect((decoded as any).EXECUTION_ENVELOPE).toEqual(original.EXECUTION_ENVELOPE);
    expect((decoded as any).validFactIds).toEqual(original.validFactIds);
  });

  it('combines equal-schema symbol and reference cards into one global table',()=>{
    const encoded=encodeEntryFacts(facts()),table=encoded.technicalTables[0];
    expect(encoded.technicalTables).toHaveLength(1);
    expect(table.rows.map(row=>row.slice(0,2))).toContainEqual(['symbol','1m']);
    expect(table.rows.map(row=>row.slice(0,2))).toContainEqual(['BTC','1w']);
    expect(table.rows.map(row=>row.slice(0,2))).toContainEqual(['ETH','1w']);
    expect(table.common).toMatchObject({observedAt:now,source:'BINANCE_WS',isClosed:true});
    expect(table.columns).toContain('factId');
    expect(expandTableValues(table,2).columns).toContainEqual(['lastClosedBar','closeTime']);
    for(const row of table.rows)expect(row).toHaveLength(table.columns.length+2);
  });

  it('distinguishes absent, undefined-as-absent, null, false, zero and an empty string',()=>{
    const original=facts(),t=original.MARKET_FACTS.symbol.technical;
    delete t['1m'].trendStrength;t['5m'].trendStrength=undefined;t['15m'].trendStrength=null;
    t['1h'].trendStrength=false;t['4h'].trendStrength=0;t['1d'].trendStrength='';
    const encoded=encodeEntryFacts(original),decoded=wireRoundtrip(original) as any;
    expect(decoded).toEqual(normalize(original));
    expect(decoded.MARKET_FACTS.symbol.technical['1m']).not.toHaveProperty('trendStrength');
    expect(decoded.MARKET_FACTS.symbol.technical['5m']).not.toHaveProperty('trendStrength');
    expect(decoded.MARKET_FACTS.symbol.technical['15m'].trendStrength).toBeNull();
    expect(decoded.MARKET_FACTS.symbol.technical['1h'].trendStrength).toBe(false);
    expect(decoded.MARKET_FACTS.symbol.technical['4h'].trendStrength).toBe(0);
    expect(encoded.technicalTables).toHaveLength(2);
  });

  it('preserves conflicting timestamps, open bars and missing-anchor evidence without inference',()=>{
    const original=facts(),t=original.MARKET_FACTS.symbol.technical;
    Object.assign(t['1m'],{barCloseTime:now-5,observedAt:now+1,receivedAt:now+2,isClosed:false,source:'OTHER_SOURCE'});
    delete t['5m'].lastClosedBar;t['5m'].missingClosedBarAnchor=true;
    t['15m'].lastClosedBar=null;t['1h'].lastClosedBar={};
    t['4h'].inProgressBar.receivedAt=now+333;
    const decoded=wireRoundtrip(original) as any;
    expect(decoded).toEqual(normalize(original));
    expect(decoded.MARKET_FACTS.symbol.technical['1m'].barCloseTime).not.toEqual(decoded.MARKET_FACTS.symbol.technical['1m'].lastClosedBar.closeTime);
    expect(decoded.MARKET_FACTS.symbol.technical['5m']).not.toHaveProperty('lastClosedBar');
    expect(decoded.MARKET_FACTS.symbol.technical['1m'].observedAt).toBe(now+1);
  });

  it('keeps different schema groups separate and scopes common fields to each group',()=>{
    const original={MARKET_FACTS:{symbol:{technical:{
      '1m':{observedAt:1,source:'WS',a:0},'5m':{observedAt:1,source:'WS',a:false},
      '15m':{observedAt:2,source:'REST',b:0},'1h':{observedAt:2,source:'REST',b:null},
    }}}};
    const encoded=encodeEntryFacts(original);
    expect(encoded.technicalTables).toHaveLength(2);
    expect(encoded.technicalTables.map(t=>t.common)).toEqual([{observedAt:1,source:'WS'},{observedAt:2,source:'REST'}]);
    expect(decodeEntryFacts(encoded)).toEqual(original);
  });

  it('preserves nested paths, literal dots, arrays, empty objects and future fields',()=>{
    const original=facts(),t=original.MARKET_FACTS.symbol.technical;
    for(const frame of ['1m','5m'])Object.assign(t[frame],{
      'literal.dot':{a:1},literal:{dot:{a:2}},'':0,future:{zero:0,flag:false,unknown:null,empty:{},array:[0,null,false,{},['x']]},
    });
    t['5m'].future.array[0]=1;
    expect(wireRoundtrip(original)).toEqual(normalize(original));
  });

  it('handles arbitrary own keys without prototype setters changing fact semantics',()=>{
    const original={MARKET_FACTS:{symbol:{technical:{
      '1m':JSON.parse('{"__proto__":{"x":1},"constructor":{"prototype":{"x":2}}}'),
      '5m':JSON.parse('{"__proto__":{"x":1},"constructor":{"prototype":{"x":3}}}'),
    }}}};
    expect(wireRoundtrip(original)).toEqual(original);
    expect(({} as any).x).toBeUndefined();
  });

  it('preserves the original JSON behavior for nonfinite numbers and array holes',()=>{
    const original=facts(),t=original.MARKET_FACTS.symbol.technical['1m'];
    t.trendStrength=NaN;t.ema8=Infinity;t.ema21=-Infinity;t.ema55=-0;t.futureArray=[undefined,,NaN,false,0];
    expect(wireRoundtrip(original)).toEqual(normalize(original));
    expect((wireRoundtrip(original) as any).MARKET_FACTS.symbol.technical['1m'].ema8).toBeNull();
  });

  it('does not modify or retain writable aliases into frozen originals or encoded records',()=>{
    const original=facts(),before=structuredClone(original);freeze(original);
    const encoded=encodeEntryFacts(original);expect(original).toEqual(before);
    const encodedBefore=structuredClone(encoded);freeze(encoded);
    const decoded=decodeEntryFacts(encoded) as any;
    decoded.MARKET_FACTS.symbol.technical['1m'].lastClosedBar.close=999;
    decoded.EXECUTION_ENVELOPE.LONG.maxNotionalUsd=0;
    expect(original).toEqual(before);expect(encoded).toEqual(encodedBefore);
  });

  it('retains empty/missing reference sections and non-object technical entries',()=>{
    for(const original of [
      {MARKET_FACTS:{symbol:{technical:{}},BTC:{missing:true},ETH:{technical:null}}},
      {MARKET_FACTS:{symbol:{technical:{'1m':{},'5m':null,'15m':false,'1h':0}},BTC:{technical:[]}}},
      {MARKET_FACTS:{symbol:{technical:{'1m':{}}}},technicalTables:'original-root-field',encoding:'original-root-field'},
      {MARKET_FACTS:null,other:[1,2,3]},
    ])expect(wireRoundtrip(original)).toEqual(original);
  });

  it('rejects malformed row lengths, duplicate columns and duplicate target cards',()=>{
    const original=encodeEntryFacts(facts());
    // Exercise the original table validation independently of V3 factoring.
    original.technicalTables=original.technicalTables.map(table=>expandTableValues(table,2));
    const truncated=structuredClone(original);truncated.technicalTables[0].rows[0].pop();
    expect(()=>decodeEntryFacts(truncated)).toThrow('ENTRY_FACT_TABLE_ROW_INVALID');
    const duplicateColumn=structuredClone(original);duplicateColumn.technicalTables[0].columns.push(duplicateColumn.technicalTables[0].columns[0]);
    expect(()=>decodeEntryFacts(duplicateColumn)).toThrow('ENTRY_FACT_TABLE_COLUMN_DUPLICATE');
    const duplicateCard=structuredClone(original);duplicateCard.technicalTables[0].rows.push(duplicateCard.technicalTables[0].rows[0]);
    expect(()=>decodeEntryFacts(duplicateCard)).toThrow('ENTRY_FACT_TABLE_TARGET_INVALID');
  });

  it('reduces representative technical payload without removing any facts',()=>{
    const original=facts(),encoded=encodeEntryFacts(original);
    expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(original).length*.6);
    expect(decodeEntryFacts(encoded)).toEqual(normalize(original));
    expect(ENTRY_FACT_ENCODING_INSTRUCTIONS).toContain('[market, timeframe, ...values]');
    expect(ENTRY_FACT_ENCODING_INSTRUCTIONS).toContain('absent field remains absent');
  });

  it('aliases only exactly equal same-instrument/same-frame reference cards, keeping all fact IDs',()=>{
    const original=duplicatedBtcFacts(),encoded=encodeEntryFacts(original);
    expect(encoded.aliases).toEqual(referenceFrames.map(frame=>({market:'BTC',frame,sourceMarket:'symbol',sourceFrame:frame,factId:`btc.${frame}.confirmed`})));
    expect(encoded.technicalTables.flatMap(table=>table.rows)).toHaveLength(12);
    expect(wireRoundtrip(original)).toEqual(normalize(original));
    const decoded=decodeEntryFacts(encoded) as any;
    for(const frame of referenceFrames){
      expect(decoded.MARKET_FACTS.BTC.technical[frame].factId).toBe(`btc.${frame}.confirmed`);
      expect(decoded.MARKET_FACTS.symbol.technical[frame].factId).toBe(`technical.${frame}.confirmed`);
    }
  });

  it.each(['observedAt','receivedAt','isClosed','source','role','missing','nestedPrice','nestedTime'])('does not alias a one-field conflict: %s',(conflict)=>{
    const original=duplicatedBtcFacts(),card=original.MARKET_FACTS.BTC.technical['15m'];
    if(conflict==='observedAt'||conflict==='receivedAt')card[conflict]+=1;
    else if(conflict==='isClosed')card.isClosed=false;
    else if(conflict==='source')card.source='DIFFERENT';
    else if(conflict==='role')card.role='TIMING';
    else if(conflict==='missing')delete card.asOf;
    else if(conflict==='nestedPrice')card.lastClosedBar.close+=.00000001;
    else card.lastClosedBar.closeTime+=1;
    const encoded=encodeEntryFacts(original);
    expect(encoded.aliases).toHaveLength(4);
    expect(encoded.aliases.some(alias=>alias.market==='BTC'&&alias.frame==='15m')).toBe(false);
    expect(wireRoundtrip(original)).toEqual(normalize(original));
  });

  it('does not alias equal cards belonging to different or unknown instruments',()=>{
    for(const symbol of ['SUIUSDT','BTCUSDC',undefined]){
      const original=duplicatedBtcFacts();original.MARKET_FACTS.symbol.identity.symbol=symbol;
      const encoded=encodeEntryFacts(original);
      expect(encoded.aliases).toBeUndefined();
      expect(wireRoundtrip(original)).toEqual(normalize(original));
    }
  });

  it('copies alias values without sharing mutable state or changing source cards',()=>{
    const original=duplicatedBtcFacts(),before=structuredClone(original);freeze(original);
    const encoded=encodeEntryFacts(original);freeze(encoded);
    const decoded=decodeEntryFacts(encoded) as any;
    decoded.MARKET_FACTS.BTC.technical['15m'].lastClosedBar.close=999;
    expect(decoded.MARKET_FACTS.symbol.technical['15m'].lastClosedBar.close).toBe(before.MARKET_FACTS.symbol.technical['15m'].lastClosedBar.close);
    expect(original).toEqual(before);
    expect(decodeEntryFacts(encoded)).toEqual(normalize(before));
  });

  it('rejects cross-frame, absent-source, different-instrument and chained aliases',()=>{
    const original=encodeEntryFacts(duplicatedBtcFacts());
    const crossFrame=structuredClone(original);crossFrame.aliases[0].sourceFrame='1w';
    expect(()=>decodeEntryFacts(crossFrame)).toThrow('ENTRY_FACT_ALIAS_INVALID');
    const missingSource=structuredClone(original);missingSource.aliases[0].sourceFrame=missingSource.aliases[0].frame='missing';
    expect(()=>decodeEntryFacts(missingSource)).toThrow('ENTRY_FACT_ALIAS_TARGET_INVALID');
    const otherInstrument=structuredClone(original);(otherInstrument.facts.MARKET_FACTS as any).BTC.symbol='OTHER';
    expect(()=>decodeEntryFacts(otherInstrument)).toThrow('ENTRY_FACT_ALIAS_TARGET_INVALID');
    const chained=structuredClone(original);(chained.aliases[0] as any).sourceMarket='ETH';
    expect(()=>decodeEntryFacts(chained)).toThrow('ENTRY_FACT_ALIAS_INVALID');
    const duplicate=structuredClone(original);duplicate.aliases.push(duplicate.aliases[0]);
    expect(()=>decodeEntryFacts(duplicate)).toThrow('ENTRY_FACT_ALIAS_TARGET_INVALID');
  });
});
