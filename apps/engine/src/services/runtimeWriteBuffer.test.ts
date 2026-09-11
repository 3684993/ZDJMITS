import {describe,it,expect} from 'vitest';import {DatabaseSync} from 'node:sqlite';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {RuntimeWriteBuffer} from './runtimeWriteBuffer.js';
describe('runtime storage lock containment',()=>{
 it('survives a real SQLite writer lock and flushes the latest checkpoint after release',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'mits-lock-test-')),file=path.join(dir,'test.sqlite'),a=new DatabaseSync(file);a.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=1;CREATE TABLE checkpoint(id INTEGER PRIMARY KEY,value TEXT)');const b=new DatabaseSync(file),buffer=new RuntimeWriteBuffer();
  try{b.exec('BEGIN IMMEDIATE');let value='before';const save=()=>a.prepare('INSERT OR REPLACE INTO checkpoint VALUES(1,?)').run(value);expect(()=>buffer.apply('checkpoint',save)).not.toThrow();expect(buffer.health()).toMatchObject({status:'DEGRADED',pendingWrites:1,overflow:0});value='latest';b.exec('ROLLBACK');buffer.flush();expect(buffer.health()).toMatchObject({status:'READY',pendingWrites:0});expect(a.prepare('SELECT value FROM checkpoint').get()).toMatchObject({value:'latest'});}finally{a.close();b.close();await rm(dir,{recursive:true,force:true});}
 });
});
