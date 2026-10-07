import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {appendProcessLifecycleFact,processErrorFact} from './processLifecycleTelemetry.js';

const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});

describe('process lifecycle telemetry',()=>{
  it('writes a bounded append-only lifecycle fact before runtime services exist',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-process-life-'));dirs.push(dir);
    expect(appendProcessLifecycleFact(dir,'BOOTSTRAP_STARTED',{head:'abc'})).toBe(true);
    const rows=(await readFile(path.join(dir,'runtime-logs','engine-process-lifecycle.jsonl'),'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line));
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({event:'BOOTSTRAP_STARTED',pid:process.pid,payload:{head:'abc'}});
  });
  it('does not persist high-frequency scheduler begin/end unless explicitly enabled',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-process-life-scheduler-'));dirs.push(dir);
    appendProcessLifecycleFact(dir,'BOOTSTRAP_STARTED',{});
    appendProcessLifecycleFact(dir,'SCHEDULED_TASK_BEGIN',{task:'T'});
    appendProcessLifecycleFact(dir,'SCHEDULED_TASK_END',{task:'T'});
    const rows=(await readFile(path.join(dir,'runtime-logs','engine-process-lifecycle.jsonl'),'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line));
    expect(rows.map(row=>row.event)).toEqual(['BOOTSTRAP_STARTED']);
  });
  it('bounds stack text and redacts common credential forms',()=>{
    const fact=processErrorFact(new Error('token=super-secret authorization: Bearer abcdef'));
    expect(fact.message).not.toContain('super-secret');expect(fact.message).not.toContain('abcdef');expect(fact.name).toBe('Error');
  });
});
