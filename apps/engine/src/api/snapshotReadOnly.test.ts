import {afterEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {EngineRuntime} from '../runtime/appRuntime.js';
import {createApiRouter} from './router.js';
let runtime:EngineRuntime|null=null,server:any=null,dataDir:string|null=null;
afterEach(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));runtime?.stop();if(dataDir)await rm(dataDir,{recursive:true,force:true});server=null;runtime=null;dataDir=null;});
describe('published dashboard snapshot',()=>{
  it('serves a bounded immutable summary without reconciliation waits or SQLite writes',async()=>{dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-snapshot-'));runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir});const wait=vi.spyOn(runtime.reconciliation,'whenSettled'),write=vi.spyOn(runtime.settingsStore,'upsertTradeRecord');const app=express();app.use('/api/v3',createApiRouter(runtime));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const port=server.address().port,response=await fetch(`http://127.0.0.1:${port}/api/v3/snapshot`),body=await response.text();expect(response.status).toBe(200);expect(Buffer.byteLength(body)).toBeLessThan(150_000);expect(wait).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(JSON.parse(body)).toMatchObject({snapshotVersion:1});});
});
