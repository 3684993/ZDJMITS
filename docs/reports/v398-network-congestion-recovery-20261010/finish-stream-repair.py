from pathlib import Path
p=Path('apps/engine/src/adapters/market/BinanceMarketStream.ts')
s=p.read_text().replace("stop(){this.stopped=true;", "stop(){this.stopped=true;this.recoveryGeneration++;this.recoveryQueue.clear();if(this.recoveryTimer)clearTimeout(this.recoveryTimer);this.recoveryTimer=null;")
s=s.replace('retainedSymbols:this.symbols.size,staleByField', 'retainedSymbols:this.symbols.size,staleByField').replace('...this.metricsValue,gapsByType:', '...this.metricsValue,recovery:{active:this.recoveryActive,queued:this.recoveryQueue.size,maxConcurrent:2,minStartIntervalMs:500},gapsByType:')
s=s.replace(".every(lane=>this.lanes[lane]!.subscribed.size===", ".every(lane=>this.lanes[lane]!.lastAckAt!==null&&!this.lanes[lane]!.pending&&!this.lanes[lane]!.controlQueue.length&&this.lanes[lane]!.subscribed.size===")
p.write_text(s)
p=Path('apps/engine/src/adapters/market/BinanceMarketStream.test.ts')
s=p.read_text()
start=s.index("it('paces split public/market")
end=s.index("\nit('isolates closed",start)
s=s[:start]+'''it('paces acknowledged split subscriptions independently below the per-connection message limit',async()=>{
 vi.useFakeTimers();const stream=new BinanceMarketStream({} as never,vi.fn()),sent:Record<string,number[]>={};
 try{stream.updateSymbols(Array.from({length:175},(_,i)=>`S${i}USDT`));for(const laneName of Object.keys((stream as any).lanes)){sent[laneName]=[];(stream as any).lanes[laneName].socket={readyState:1,send:(raw:string)=>{sent[laneName]!.push(Date.now());const command=JSON.parse(raw);(stream as any).onMessage(JSON.stringify({id:command.id,result:null}),laneName);},close:vi.fn()};}(stream as any).subscribeSymbols();await vi.advanceTimersByTimeAsync(4000);expect(sent.PUBLIC).toHaveLength(2);expect(sent.MARKET).toHaveLength(10);expect(sent.MARKET_1).toHaveLength(1);for(const lane of Object.values((stream as any).lanes) as any[])expect(lane.confirmed.size).toBeLessThanOrEqual(1024);for(const rows of Object.values(sent))for(const at of rows)expect(rows.filter(t=>t>=at&&t<at+1000).length).toBeLessThanOrEqual(3);}finally{stream.stop();vi.useRealTimers();}
});
'''+s[end:]
start=s.index(" it('keeps every retained symbol when")
end=s.index('\n});',start)
s=s[:start]+''' it.each([160,161,191,192,239,255,256,1024])('covers all %i retained symbols across bounded connections',count=>{
   const stream=new BinanceMarketStream({} as never,vi.fn());stream.updateSymbols(Array.from({length:count},(_,i)=>`S${i}USDT`));
   const market:string[]=[],publicStreams:string[]=[];
   for(const name of Object.keys((stream as any).lanes)){const desired=(stream as any).desired(name) as Set<string>;expect(desired.size).toBeLessThanOrEqual(1024);(name.startsWith('MARKET')?market:publicStreams).push(...desired);}
   expect(market).toHaveLength(count*6);expect(new Set(market).size).toBe(count*6);expect(market.some(x=>x.startsWith('!'))).toBe(false);expect(publicStreams).toHaveLength(count+1);
   for(let i=0;i<count;i++){expect(market).toContain(`s${i}usdt@ticker`);expect(market).toContain(`s${i}usdt@markPrice@1s`);expect(publicStreams).toContain(`s${i}usdt@depth20@500ms`);}
   stream.updateSymbols(['BTCUSDT']);expect(Object.keys((stream as any).lanes)).toEqual(['PUBLIC','MARKET']);stream.stop();
 });'''+s[end:]
p.write_text(s)
