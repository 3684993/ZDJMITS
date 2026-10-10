// Built Dashboard only, fixtures only; does not launch Engine or access live ports.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.join(process.env.ZDJ_WORKSPACE_NODE_PACKAGES??'C:/Users/5700x/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules','package.json'));
const {chromium}=require('playwright');
const root=path.resolve('apps/dashboard/dist'),out=path.resolve('docs/reports/v398-performance-dashboard-20261010');
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1'),requested=path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!requested.startsWith(root+path.sep)&&requested!==root){res.writeHead(403).end();return;}
 const file=/\.[a-z0-9]+$/i.test(url.pathname)?requested:path.join(root,'index.html');
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(8786,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'msedge'});const results=[];
try{for(const viewport of [{width:1440,height:1050},{width:390,height:844}]){
 const page=await browser.newPage({viewport});let calls=0;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.WebSocket=class {constructor(){setTimeout(()=>this.onopen?.(),0)}close(){}};});
 await page.route('**/api/v3/**',async route=>{
  calls++;const url=new URL(route.request().url()),now=Date.now();let data={};
  const host={asOf:now,instanceId:'OFFLINE_FIXTURE',source:'NODE_OS_CPU_TIMES_AND_MEMORY',sampleSource:'NODE_OS_CPU_TIMES_AND_MEMORY',ttlMs:30000,cpu:{usagePct:42},memory:{totalBytes:64000000000,usedBytes:40000000000,freeBytes:24000000000},engine:{pid:123,rssBytes:300000000,heapUsedBytes:120000000},history:Array.from({length:30},(_,i)=>({asOf:now-(29-i)*15000,instanceId:'OFFLINE_FIXTURE',cpu:{usagePct:30+Math.sin(i)*8},memory:{usedBytes:40000000000+i*1000000}}))};
  if(url.pathname.endsWith('/snapshot'))data={ts:now,snapshotVersion:now,settings:{connections:{exchange:{environment:'TESTNET'},executionMode:'OFFLINE_FIXTURE'}},account:{status:'READY',asOf:now,assets:[{asset:'USDT',availableBalance:450,unrealizedPnl:-12},{asset:'USDC',availableBalance:1400,unrealizedPnl:32}]},positions:[],entryOrders:[],health:[],pool:[],universe:{generation:1},localAccounting:{byAsset:{USDT:{completeCycles:5,exFundingNet:-23,canonicalEligible:0,canonicalNetPnl:null},USDC:{completeCycles:3,exFundingNet:64,canonicalEligible:2,canonicalNetPnl:40}}}};
  else if(url.pathname.endsWith('/host'))data=host;
  else if(url.pathname.endsWith('/gpu'))data={asOf:now,instanceId:'OFFLINE_FIXTURE',measureStatus:'MEASURED',sampleSource:'WINDOWS_WDDM_PROCESS_COUNTERS',services:[8081,8083,8084].map((port,i)=>({port,pid:123+i,processStartedAt:1,measureStatus:'MEASURED',utilizationPct:i===2?72:0,dedicatedBytes:i?17348000000:5532000000,sharedBytes:1000000})),history:[]};
  else if(url.pathname.endsWith('/resources'))data=[{id:'QA Primary',role:'PRIMARY_BRAIN',active:1,queueDepth:0,connectionStatus:'ONLINE',healthCheckedAt:now}];
  else if(url.pathname.endsWith('/operational-incidents'))data={active:[],history:[]};
  else if(url.pathname.endsWith('/universe'))data={generation:1,candidates:[]};
  else if(url.pathname.endsWith('/binance-governance'))data={routes:[{rest:{throughProxy:true,failClosed:true}}],budgets:[]};
  else if(url.pathname.endsWith('/runs'))data={items:[]};
  await route.fulfill({json:data});
 });
 const start=performance.now();await page.goto('http://127.0.0.1:8786/performance');await page.getByText('资金可用与收益趋势',{exact:true}).waitFor();
 await page.waitForTimeout(600);
 await page.evaluate(()=>{const badge=document.createElement('div');badge.textContent='OFFLINE TEST FIXTURE · NOT LIVE / 离线测试样例';badge.style='position:fixed;top:0;right:0;background:#fee2e2;color:#991b1b;z-index:9999;padding:4px;font:12px sans-serif';document.body.append(badge);});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 const renderMs=performance.now()-start;
 await page.screenshot({path:path.join(out,`offline-fixture-${viewport.width===390?'mobile':'desktop'}.png`),fullPage:true});
 results.push({viewport,renderMs,overflow,calls,pageErrors:errors,canvasCount:await page.locator('canvas').count(),fixtureOnly:true});
 if(overflow||errors.length)throw new Error('OFFLINE_UI_LAYOUT_OR_RUNTIME_ERROR');await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
const {writeFile}=await import('node:fs/promises');await writeFile(path.join(out,'browser-qa.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
