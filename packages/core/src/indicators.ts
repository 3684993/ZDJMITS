import type { Candle, TechnicalCard, Timeframe } from '@zdj/contracts';
import { clamp, mean, safeDiv, stddev } from './math.js';

function ema(values:number[], period:number):number[] {
  if (!values.length) return [];
  const k=2/(period+1); const out=[values[0]!];
  for(let i=1;i<values.length;i++) out.push(values[i]!*k + out[i-1]!*(1-k));
  return out;
}
function sma(values:number[], period:number):number[] {
  return values.map((_,i)=>{ const s=Math.max(0,i-period+1); return mean(values.slice(s,i+1)); });
}
function trueRanges(candles:Candle[]):number[] {
  return candles.map((c,i)=> i===0 ? c.high-c.low : Math.max(c.high-c.low, Math.abs(c.high-candles[i-1]!.close), Math.abs(c.low-candles[i-1]!.close)));
}
function atr(candles:Candle[], period=14):number[] { return ema(trueRanges(candles), period); }
function lastCrossAge(macd:number[], signal:number[]):{direction:'BULLISH'|'BEARISH'|'NONE';age:number} {
  for(let i=macd.length-1;i>=1;i--){ const prev=macd[i-1]!-signal[i-1]!; const cur=macd[i]!-signal[i]!; if(prev<=0&&cur>0)return{direction:'BULLISH',age:macd.length-1-i}; if(prev>=0&&cur<0)return{direction:'BEARISH',age:macd.length-1-i}; }
  return {direction:'NONE',age:macd.length};
}
function swingCounts(c:Candle[]){
  let hh=0,hl=0,lh=0,ll=0; const highs:number[]=[], lows:number[]=[];
  for(let i=2;i<c.length-2;i++){ const x=c[i]!; if(x.high>c[i-1]!.high&&x.high>c[i-2]!.high&&x.high>=c[i+1]!.high&&x.high>=c[i+2]!.high) highs.push(x.high); if(x.low<c[i-1]!.low&&x.low<c[i-2]!.low&&x.low<=c[i+1]!.low&&x.low<=c[i+2]!.low) lows.push(x.low); }
  for(let i=1;i<highs.length;i++) highs[i]!>highs[i-1]!?hh++:lh++;
  for(let i=1;i<lows.length;i++) lows[i]!>lows[i-1]!?hl++:ll++;
  return {hh,hl,lh,ll, swingHigh: highs.at(-1)??Math.max(...c.slice(-12).map(x=>x.high)), swingLow:lows.at(-1)??Math.min(...c.slice(-12).map(x=>x.low))};
}
export const CANDLE_PERIOD_MS: Record<string, number> = {"1m":60_000,"5m":300_000,"15m":900_000,"1h":3_600_000,"4h":14_400_000,"1d":86_400_000,"1w":604_800_000};

/** Closed bars only: a provider `isClosed` flag is never sufficient on its own. */
export function closedCandles(candles:Candle[], now=Date.now()):Candle[] {
  return candles
    .filter(c=>(c.isClosed===true||(c.isClosed===undefined&&c.closeTime<=now))&&Number.isFinite(c.closeTime)&&c.closeTime<=now)
    .sort((a,b)=>a.openTime-b.openTime);
}

export type CandleContinuity={ok:boolean;closedCount:number;missing:number;firstMissingOpenTime:number|null;duplicates:number;boundaryInvalid:boolean;latestClosedOpenTime:number|null;latestClosedAtBoundary:boolean};

/**
 * Single source of truth for "this closed series may be trusted".
 * `closed` must already be filtered by closedCandles(); count and a current latest
 * bar say nothing about a hole in the middle, which is what a short WebSocket
 * disconnect leaves behind.
 */
export function continuityOfClosed(closed:Candle[], timeframe:string, now=Date.now()):CandleContinuity {
  const period=CANDLE_PERIOD_MS[timeframe]??0,seen=new Set<number>();
  let duplicates=0,boundaryInvalid=false;
  for(const candle of closed){
    if(seen.has(candle.openTime)) duplicates++;
    else seen.add(candle.openTime);
    if(period&&candle.closeTime-candle.openTime+1<period) boundaryInvalid=true;
  }
  const ordered=[...seen].sort((a,b)=>a-b);
  let missing=0,firstMissingOpenTime:number|null=null;
  for(let i=1;i<ordered.length;i++){
    const step=ordered[i]!-ordered[i-1]!;
    if(period&&step>period){ missing+=Math.round(step/period)-1; firstMissingOpenTime??=ordered[i-1]!+period; }
  }
  const latestClosedOpenTime=ordered.length?ordered[ordered.length-1]! : null;
  const latestClosedAtBoundary=period>0&&latestClosedOpenTime!==null&&latestClosedOpenTime===Math.floor(now/period)*period-period;
  return {ok:duplicates===0&&!boundaryInvalid&&missing===0,closedCount:closed.length,missing,firstMissingOpenTime,duplicates,boundaryInvalid,latestClosedOpenTime,latestClosedAtBoundary};
}

/** Continuity facts for a raw provider series, applying the closed-bar filter first. */
export function closedCandleGap(candles:Candle[], timeframe:string, now=Date.now()):CandleContinuity {
  return continuityOfClosed(closedCandles(candles, now), timeframe, now);
}

export function buildTechnicalCard(timeframe:Timeframe, candles:Candle[], now=Date.now()):TechnicalCard {
  // A closed flag from a provider is not sufficient: future bars, duplicate
  // boundaries, and gaps must never become Primary facts.  15m EMA55 uses a
  // fixed 240-bar warmup; other display frames retain the existing 20-bar
  // minimum so management data can remain observable while warming.
  const closed=closedCandles(candles, now), continuity=continuityOfClosed(closed, timeframe, now);
  if(continuity.duplicates>0) throw new Error(`${timeframe} duplicate closed candle`);
  if(continuity.boundaryInvalid) throw new Error(`${timeframe} invalid closed boundary`);
  // Warmup is enforced by the Entry readiness contract (where a 15m card can
  // actually authorize Primary). Keeping the calculator usable at 20 bars
  // preserves read-only management and deterministic unit fixtures.
  const required=20;
  if(closed.length<required) throw new Error(`${timeframe} WARMING requires >=${required} closed candles`);
  if(continuity.missing>0) throw new Error(`${timeframe} closed candle gap`);
  const current=[...candles].reverse().find(c=>!closed.includes(c))??null;
  const closes=closed.map(x=>x.close), vols=closed.map(x=>x.volume);
  const e8=ema(closes,8), e21=ema(closes,21), e55=ema(closes,55);
  const fast=ema(closes,12), slow=ema(closes,26), macd=closes.map((_,i)=>(fast[i]??0)-(slow[i]??0)), signal=ema(macd,9), hist=macd.map((v,i)=>v-(signal[i]??0));
  const mid=sma(closes,20); const middle=mid.at(-1)!; const recent=closes.slice(-20); const sd=stddev(recent); const upper=middle+2*sd, lower=middle-2*sd;
  const a=atr(closed,14).at(-1)??0; const price=closes.at(-1)!; const slopeWindow=e21.slice(-5); const slope=safeDiv((slopeWindow.at(-1)??price)-(slopeWindow[0]??price), price,0);
  const sc=swingCounts(closed);
  const absoluteTolerance=Math.max(price*1e-8,a*.005,Number.EPSILON);
  const slopeTolerance=safeDiv(absoluteTolerance,price,0);
  const signed=(delta:number,tolerance:number)=>delta>tolerance?1:delta<-tolerance?-1:0;
  // Trend is structural only. MACD is kept as independent momentum evidence;
  // it must not mechanically reverse direction or manufacture a trade side.
  const emaOrder=signed(e8.at(-1)!-e21.at(-1)!,absoluteTolerance)+signed(e21.at(-1)!-e55.at(-1)!,absoluteTolerance);
  const swingBias=(sc.hh+sc.hl)-(sc.lh+sc.ll);
  const trendRaw=emaOrder+signed(slope,slopeTolerance)+(swingBias>0?1:swingBias<0?-1:0);
  const trend=trendRaw>=2?'UP':trendRaw<=-2?'DOWN':'RANGE';
  const strength=trendRaw===0?0:clamp(Math.abs(trendRaw)/4*Math.min(1,Math.abs(slope)*250+.35),0,1);
  const volMean=mean(vols.slice(-30)); const volSd=stddev(vols.slice(-30)); const z=volSd?safeDiv((vols.at(-1)??0)-volMean,volSd,0):0;
  const cross=lastCrossAge(macd,signal);
  return {
    timeframe, asOf:closed.at(-1)!.closeTime,barOpenTime:closed.at(-1)!.openTime,barCloseTime:closed.at(-1)!.closeTime,
    receivedAt:closed.at(-1)!.receivedAt??now,isClosed:true,source:closed.at(-1)!.source??'UNKNOWN',
    lastClosedBar:(({openTime,closeTime,open,high,low,close,volume})=>({openTime,closeTime,open,high,low,close,volume}))(closed.at(-1)!),
    inProgressBar:current?{openTime:current.openTime,closeTime:current.closeTime,receivedAt:current.receivedAt??now,elapsedRatio:clamp(safeDiv(now-current.openTime,current.closeTime-current.openTime,0),0,1),lastPrice:current.close,volume:current.volume,source:current.source??'UNKNOWN'}:null,
    sampleSize:closed.length, lastPrice:price, trend, trendStrength:strength,
    ema8:e8.at(-1)!, ema21:e21.at(-1)!, ema55:e55.at(-1)!, emaSlope21:slope,
    macdLine:macd.at(-1)!, macdSignal:signal.at(-1)!, macdHistogram:hist.at(-1)!, macdHistogramSlope:(hist.at(-1)??0)-(hist.at(-2)??0), macdCrossDirection:cross.direction, macdCrossAgeBars:cross.age,
    bbUpper:upper, bbMiddle:middle, bbLower:lower, bbPosition:safeDiv(price-lower,upper-lower,0.5), bbBandwidth:safeDiv(upper-lower,middle,0),
    atr14:a, atrPercent:safeDiv(a,price,0)*100, volumeZScore:z,
    recentSwingHigh:sc.swingHigh, recentSwingLow:sc.swingLow, higherHighs:sc.hh, higherLows:sc.hl, lowerHighs:sc.lh, lowerLows:sc.ll,
    freshnessMs:Math.max(0,now-closed.at(-1)!.closeTime),
  };
}
