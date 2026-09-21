import type { RuntimeState } from '../state/runtimeState.js';
import type { ExperienceSummary } from '@zdj/core';
export class ExperienceService {
  constructor(private state:RuntimeState){}
  summarize(symbol:string,regime:string):ExperienceSummary{
    const closedComplete=[...this.state.tradeRecords.values()].filter(x=>x.status==='CLOSED'&&x.recordCompleteness==='COMPLETE');
    const all=closedComplete.filter(x=>x.netPnl!=null&&x.fundingAttributionStatus==='EXACT'),sym=all.filter(x=>x.symbol===symbol),reg=all.filter(x=>x.regime===regime);
    const win=(x:typeof all)=>x.length?x.filter(t=>t.netPnl!>0).length/x.length:null;
    const fills=sym.length?sym.reduce((a,b)=>a+(b.openedAt==null?0:Math.max(0,b.openedAt-b.createdAt)),0)/sym.length/60_000:null;
    const lessons:string[]=[]; if(sym.length)lessons.push(`${symbol} 本地完整净收益样本 ${sym.length} 条，胜率 ${(win(sym)!*100).toFixed(0)}%`); if(reg.length)lessons.push(`${regime} 本地完整净收益样本 ${reg.length} 条，胜率 ${(win(reg)!*100).toFixed(0)}%`);
    return{sampleSize:sym.length,sameSymbolWinRate:win(sym),sameRegimeWinRate:win(reg),averageFillMinutes:fills,recentLessons:lessons.slice(0,8),coverage:{eligible:all.length,closedComplete:closedComplete.length,excludedNetUnknown:closedComplete.filter(x=>x.netPnl==null||x.fundingAttributionStatus!=='EXACT').length,excludedOther:0}};
  }
}
