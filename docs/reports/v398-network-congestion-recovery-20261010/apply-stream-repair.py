"""Auditable one-time source transformation for the reviewed stream repair."""
from pathlib import Path
p=Path('apps/engine/src/adapters/market/BinanceMarketStream.ts')
s=p.read_text()
def replace(a,b):
    global s
    assert a in s, a[:100]
    s=s.replace(a,b)
replace('this.tradedPrices.retain(this.symbols);','this.tradedPrices.retain(this.symbols);this.ensureLanes();')
replace("this.connect('PUBLIC');this.connect('MARKET');","for(const name of this.laneNames())this.connect(name);")
replace("for(const laneName of ['PUBLIC','MARKET'] as const)","for(const laneName of this.laneNames())")
replace("(['PUBLIC','MARKET'] as const).map(name=>this.lanes[name].state)","this.laneNames().map(name=>this.lanes[name]!.state)")
replace("(['PUBLIC','MARKET'] as const).map(name=>this.lanes[name].connectedAt??0)","this.laneNames().map(name=>this.lanes[name]!.connectedAt??0)")
replace("(['PUBLIC','MARKET'] as const).map(name=>this.lanes[name].lastMessageAt||0)","this.laneNames().map(name=>this.lanes[name]!.lastMessageAt||0)")
replace("(['MARKET','PUBLIC'] as const).map(name=>this.lanes[name].lastError)","this.laneNames().map(name=>this.lanes[name]!.lastError)")
replace("const lane=this.lanes[laneName];","const lane=this.lanes[laneName]!;")
replace("laneName:'PUBLIC'|'MARKET'","laneName:LaneName")
replace('this.transport.effectiveWsUrl(laneName)','this.transport.effectiveWsUrl(this.laneKind(laneName))')
replace("if(laneName==='PUBLIC'){this.lastDepthUpdate.clear();this.backfillInFlight.clear();}","if(this.laneKind(laneName)==='PUBLIC')this.lastDepthUpdate.clear();")
replace("if(laneName==='MARKET')","if(this.laneKind(laneName)==='MARKET')")
replace("laneName==='MARKET'?","this.laneKind(laneName)==='MARKET'?")
replace('lane.subscribed.clear();','lane.subscribed.clear();lane.confirmed.clear();lane.lastAckAt=null;')
start=s.index('    const symbols=[...this.symbols].map',s.index('  private desired'))
end=s.index('\n  private subscribeSymbols()',start)
s=s[:start]+'''    const kind=this.laneKind(laneName),index=laneName===kind?0:Number(laneName.split('_')[1]),size=kind==='MARKET'?160:1023;
    const symbols=[...this.symbols].slice(index*size,(index+1)*size).map(symbol=>symbol.toLowerCase());
    if(kind==='PUBLIC')return new Set([...(index===0?['!bookTicker']:[]),...symbols.map(symbol=>`${symbol}@depth20@500ms`)]);
    return new Set(symbols.flatMap(symbol=>[`${symbol}@ticker`,`${symbol}@markPrice@1s`,`${symbol}@kline_1m`,`${symbol}@kline_5m`,`${symbol}@kline_15m`,`${symbol}@aggTrade`]));
  }
'''+s[end:]
replace("this.subscribeLane('PUBLIC');this.subscribeLane('MARKET');","for(const name of this.laneNames())this.subscribeLane(name);")
replace('lane.controlQueue=[];','lane.controlQueue=[];if(lane.ackTimer)clearTimeout(lane.ackTimer);lane.ackTimer=null;lane.pending=null;')
replace('if(lane.controlTimer||!lane.controlQueue.length','if(lane.pending||lane.controlTimer||!lane.controlQueue.length')
replace('lane.socket.send(JSON.stringify(command));lane.lastControlAt=Date.now();','''lane.pending=command;lane.lastControlAt=Date.now();lane.ackTimer=setTimeout(()=>{lane.ackTimer=null;if(lane.pending?.id===command.id){lane.lastError='WS_SUBSCRIPTION_ACK_TIMEOUT';this.metricsValue.gaps++;this.metricsValue.gapsByType.subscription++;this.updateAggregateState();lane.socket?.terminate();}},10_000);lane.socket.send(JSON.stringify(command));''')
replace("this.recordStreamPayload(laneName,raw,'INVALID_JSON')","this.recordStreamPayload(this.laneKind(laneName),raw,'INVALID_JSON')")
replace('this.recordStreamPayload(laneName,raw,this.payloadType(value))','this.recordStreamPayload(this.laneKind(laneName),raw,this.payloadType(value))')
# Keep traffic counters grouped by transport kind even for additional sockets.
replace('const traffic=this.streamTraffic[laneName]','const traffic=this.streamTraffic[this.laneKind(laneName)]')
replace('const data=value?.data??value;if(Array.isArray(data))','''if(value?.id===lane.pending?.id&&lane.pending&&value.result===null){const command=lane.pending;for(const item of command.params){if(command.method==='SUBSCRIBE')lane.confirmed.add(item);else lane.confirmed.delete(item);}lane.lastAckAt=Date.now();if(lane.ackTimer)clearTimeout(lane.ackTimer);lane.ackTimer=null;lane.pending=null;this.pumpControls(laneName);return;}const data=value?.data??value;if(Array.isArray(data))''')
replace("subscriptionEvidence:'LOCAL_REQUESTED_NOT_EXCHANGE_ACKED'","subscriptionEvidence:this.laneNames().filter(lane=>this.laneKind(lane)===name).every(lane=>this.lanes[lane]!.subscribed.size===this.lanes[lane]!.confirmed.size&&[...this.lanes[lane]!.subscribed].every(item=>this.lanes[lane]!.confirmed.has(item)))?'EXCHANGE_ACKED':'PENDING_EXCHANGE_ACK'")
replace("requestedGlobalStreams:[...this.lanes[name].subscribed].filter(item=>item.startsWith('!'))","requestedGlobalStreams:this.laneNames().filter(lane=>this.laneKind(lane)===name).flatMap(lane=>[...this.lanes[lane]!.subscribed].filter(item=>item.startsWith('!')))")
replace("lanes:Object.fromEntries((['PUBLIC','MARKET'] as const).map(name=>[name,{state:this.lanes[name].state,connectedAt:this.lanes[name].connectedAt,lastMessageAt:this.lanes[name].lastMessageAt||null,reconnects:this.lanes[name].reconnects,lastError:this.lanes[name].lastError,subscriptions:this.lanes[name].subscribed.size}]))","lanes:Object.fromEntries(this.laneNames().map(name=>{const lane=this.lanes[name]!;return[name,{state:lane.state,connectedAt:lane.connectedAt,lastMessageAt:lane.lastMessageAt||null,reconnects:lane.reconnects,lastError:lane.lastError,subscriptions:lane.subscribed.size,confirmedSubscriptions:lane.confirmed.size,pendingControls:lane.controlQueue.length+(lane.pending?1:0),lastAckAt:lane.lastAckAt}];}))")
replace('this.lanes.PUBLIC.subscribed.size+this.lanes.MARKET.subscribed.size','this.laneNames().reduce((sum,name)=>sum+this.lanes[name]!.subscribed.size,0)')
# Record index lookups are safe because all methods receive a registered lane.
replace('const lane=this.lanes[laneName]!;', 'const lane=this.lanes[laneName]!;')
p.write_text(s)
