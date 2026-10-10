from pathlib import Path
root = Path(__file__).resolve().parents[3]
def edit(name, replacements):
    p=root/name
    s=p.read_text(encoding='utf-8')
    for old,new in replacements:
        assert old in s, old
        s=s.replace(old,new)
    p.write_text(s,encoding='utf-8',newline='\n')
edit('apps/engine/src/adapters/binance/BinanceTransport.ts', [
    ("p.endsWith('/account')||p.endsWith('/balance')", "p.endsWith('/account')||p.endsWith('/accountConfig')||p.endsWith('/balance')"),
    ("reusedSocket:false,failurePhase:null as string|null", "reusedSocket:false,responseStatus:null as number|null,responseDecodedBytes:0,failurePhase:null as string|null"),
    ("timing.responseAt=Date.now();let body='';", "timing.responseAt=Date.now();timing.responseStatus=response.statusCode??null;let body='';"),
    ("body+=chunk;", "timing.responseDecodedBytes+=Buffer.byteLength(chunk,'utf8');body+=chunk;")
])
edit('apps/engine/src/adapters/binance/requestBudget.ts', [
    ('reusedSocket:boolean;failurePhase:string|null', 'reusedSocket:boolean;responseStatus?:number|null;responseDecodedBytes?:number;failurePhase:string|null')
])
edit('apps/engine/src/adapters/binance/BinanceTransport.test.ts', [
    ("['GET','/fapi/v2/account','PRIVATE_TRUTH']", "['GET','/fapi/v1/accountConfig','PRIVATE_TRUTH'],['GET','/fapi/v2/account','PRIVATE_TRUTH']"),
    ('completedAt:expect.any(Number),failurePhase:null', 'completedAt:expect.any(Number),responseStatus:200,responseDecodedBytes:2,failurePhase:null')
])
edit('apps/engine/src/adapters/market/BinanceMarketStream.ts', [
    ("kind==='MARKET'?160:1023", "kind==='MARKET'?160:512"),
    ("[...(index===0?['!bookTicker']:[]),...symbols.map(symbol=>`${symbol}@depth20@500ms`)]", "symbols.flatMap(symbol=>[`${symbol}@bookTicker`,`${symbol}@depth20@500ms`])"),
    ('this.lanes[lane]!.lastAckAt!==null', "this.lanes[lane]!.state==='LIVE'&&this.lanes[lane]!.socket?.readyState===WebSocket.OPEN&&this.lanes[lane]!.lastAckAt!==null"),
    ("lane.state='STOPPED';", "lane.state='STOPPED';lane.confirmed.clear();lane.lastAckAt=null;"),
    ("this.clearControls(laneName);if(reason.length)", "this.clearControls(laneName);lane.confirmed.clear();lane.lastAckAt=null;if(reason.length)"),
    ('ts:Number(d.E)||Date.now()', 'ts:Number(d.E)')
])
edit('apps/engine/src/adapters/market/BinanceMarketStream.test.ts', [
    ('expect(sent.PUBLIC).toHaveLength(2)', 'expect(sent.PUBLIC).toHaveLength(4)'),
    ('expect(publicStreams).toHaveLength(count+1)', 'expect(publicStreams).toHaveLength(count*2);expect(publicStreams.some(x=>x.startsWith(\'!\'))).toBe(false)'),
    ('expect(publicStreams).toContain(`s${i}usdt@depth20@500ms`)', 'expect(publicStreams).toContain(`s${i}usdt@depth20@500ms`);expect(publicStreams).toContain(`s${i}usdt@bookTicker`)')
])
