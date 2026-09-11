import assert from 'node:assert/strict';

const nullMetrics=Object.freeze({quoteFresh:null,orderbookFresh:null,klineFresh:null,gaps:null,backfills:null,reconnects:null,recoverySuccess:null,recoveryFailure:null});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
const numberOrNull=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function parseMarketHealth(value){
  const health=Array.isArray(value)?value.find(x=>object(x)?.id==='market'):object(value)?.id==='market'?value:null;
  const detail=object(health)?.detail;
  let stream=null;
  if(object(detail))stream=detail.stream??detail;
  else if(typeof detail==='string'){
    const match=detail.match(/(?:^|\s)stream=(\{[\s\S]*\})\s*$/);
    if(match)try{stream=JSON.parse(match[1]);}catch{}
    else try{stream=JSON.parse(detail);}catch{}
  }
  stream=object(stream);
  const pick=(...names)=>{for(const name of names){const v=stream?.[name];const n=numberOrNull(v);if(n!==null)return n;}return null;};
  const state=typeof stream?.state==='string'?stream.state:null;
  return {...nullMetrics,state,quoteFresh:pick('quoteFresh','quotesFresh'),orderbookFresh:pick('orderbookFresh','bookFresh','orderBookFresh'),klineFresh:pick('klineFresh','klinesFresh'),gaps:pick('gaps','sequenceGaps'),backfills:pick('backfills'),reconnects:pick('reconnects'),recoverySuccess:pick('recoverySuccess'),recoveryFailure:pick('recoveryFailure'),available:stream!==null,rawDetail:typeof detail==='string'?detail:null};
}
if(process.argv[1]&&new URL(`file:${process.argv[1]}`).href===import.meta.url){const current={id:'market',detail:'8 snapshots; stream={"state":"LIVE","connectedAt":1,"reconnects":0,"gaps":0,"backfills":0,"recoverySuccess":0,"recoveryFailure":0}'};const parsed=parseMarketHealth([current]);assert.equal(parsed.available,true);assert.equal(parsed.gaps,0);assert.equal(parsed.reconnects,0);assert.equal(parsed.quoteFresh,null);assert.equal(parseMarketHealth([{id:'market',detail:'unparseable'}]).available,false);assert.equal(parseMarketHealth(null).backfills,null);console.log(JSON.stringify({ok:true,parsed}));}
