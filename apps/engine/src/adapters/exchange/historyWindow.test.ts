import {describe,it,expect} from 'vitest';
import {readHistoryWindows} from './historyWindow.js';
describe('complete bounded history pagination',()=>{
  it('covers more than seven days without a gap or an oversized query',async()=>{
    const calls:Array<[number,number]>=[],end=20*86_400_000;
    await readHistoryWindows(0,end,async(a,b)=>{calls.push([a,b]);return [];},()=> '');
    calls.sort((a,b)=>a[0]-b[0]);expect(calls[0]![0]).toBe(0);expect(calls.at(-1)![1]).toBe(end);
    for(let i=0;i<calls.length;i++){expect(calls[i]![1]-calls[i]![0]).toBeLessThan(7*86_400_000);if(i)expect(calls[i]![0]).toBe(calls[i-1]![1]+1);}
  });
  it('finds old records omitted by the most recent 1000-row page',async()=>{
    const rows=Array.from({length:1500},(_,id)=>({id,time:id}));
    const result=await readHistoryWindows(0,1499,async(a,b)=>rows.filter(r=>r.time>=a&&r.time<=b).slice(-1000),r=>String(r.id));
    expect(result).toHaveLength(1500);expect(result.some(r=>r.id===0)).toBe(true);
  });
  it('never returns truncated success when request budget is exhausted',async()=>{
    await expect(readHistoryWindows(0,99,async()=>Array.from({length:1000},(_,id)=>({id})),r=>String(r.id),2)).rejects.toThrow('HISTORY_REQUEST_BUDGET_EXCEEDED');
  });
  it('fails closed at a saturated millisecond',async()=>{
    await expect(readHistoryWindows(1,1,async()=>Array.from({length:1000},(_,id)=>({id})),r=>String(r.id))).rejects.toThrow('HISTORY_SINGLE_TIMESTAMP_SATURATED');
  });
  it('rejects missing row identities and invalid windows',async()=>{
    await expect(readHistoryWindows(0,1,async()=>[{}],()=> '')).rejects.toThrow('HISTORY_IDENTITY_MISSING');
    await expect(readHistoryWindows(NaN,1,async()=>[],()=> '')).rejects.toThrow('INVALID_HISTORY_WINDOW');
  });
});
