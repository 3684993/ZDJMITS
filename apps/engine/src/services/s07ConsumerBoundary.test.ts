import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {describe,expect,it} from 'vitest';

const SRC=fileURLToPath(new URL('../',import.meta.url));
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const full=path.join(dir,entry.name);
  return entry.isDirectory()?walk(full):entry.isFile()&&entry.name.endsWith('.ts')&&!entry.name.endsWith('.test.ts')?[full]:[];
});
const rel=(file:string)=>path.relative(SRC,file).replace(/\\/g,'/');
const consumers=(moduleName:string)=>walk(SRC).filter(file=>new RegExp(`from\\s+['\"][^'\"]*${moduleName}\\.js['\"]`).test(readFileSync(file,'utf8'))).map(rel).sort();
const sourceOf=(file:string)=>readFileSync(path.join(SRC,file),'utf8');

/**
 * S07 boundary: every bounded-review, usage-ledger and memory module has exactly the consumers the
 * stage was graded on. A primitive with no consumer is how the previous audit found code that looked
 * finished and was not, so this list is the tripwire against reintroducing that shape.
 */
describe('S07 production consumer boundary',()=>{
  it('the review scheduler has one consumer, and it is the runner that spends the budget',()=>{
    expect(consumers('positionReviewScheduler')).toEqual(['runtime/appRuntime.ts','services/positionReviewRunner.ts']);
    // The runtime may only name the ticket type; owning a budget from two places is how a bound leaks.
    expect(sourceOf('runtime/appRuntime.ts')).toMatch(/import \{\s*PositionReviewScheduler,\s*type ReviewTicket\s*\} from '\.\.\/services\/positionReviewScheduler\.js'/);
    expect(sourceOf('runtime/appRuntime.ts')).not.toMatch(/\.reserve\(\{/);
  });

  it('the review runner is wired into the runtime and reaches the model through the review brain',()=>{
    expect(consumers('positionReviewRunner')).toEqual(['runtime/appRuntime.ts']);
    expect(sourceOf('runtime/appRuntime.ts')).toMatch(/new PositionReviewRunner\(/);
    expect(sourceOf('services/aiFabric.ts')).toMatch(/role:'REVIEW_BRAIN'/);
    expect(sourceOf('runtime/appRuntime.ts')).toMatch(/this\.ai\.review\(/);
  });

  it('the usage ledger is written by the runtime bridge and the scheduler, and by nothing else',()=>{
    expect(consumers('aiUsageLedger')).toEqual(['runtime/appRuntime.ts','services/positionReviewScheduler.ts']);
  });

  it('trade memory is read through one service, which the runtime uses',()=>{
    expect(consumers('tradeMemoryRetriever')).toEqual(['services/tradeMemoryService.ts']);
    expect(consumers('tradeMemoryService')).toEqual(['runtime/appRuntime.ts']);
  });

  it('entry, exit and settlement writers cannot reach the review or memory modules',()=>{
    const forbidden=/(positionReviewScheduler|positionReviewRunner|positionReviewPrompt|tradeMemoryRetriever|tradeMemoryService|aiUsageLedger)/;
    for(const file of ['services/entryCoordinator.ts','services/accountExecutor.ts','services/manualPositionService.ts',
      'services/tpGuardian.ts','services/reconciliationService.ts','services/v396AiExitRunner.ts','state/runtimeState.ts']){
      let source='';try{source=sourceOf(file);}catch{continue;}
      const imports=[...source.matchAll(/from\s+['"][^'"]*\.js['"]/g)].map(match=>match[0]);
      expect(imports.filter(entry=>forbidden.test(entry)),file).toEqual([]);
    }
  });

  it('a review answer cannot order anything: only evidence, and only an exit proposal moves the plan',()=>{
    const runner=sourceOf('services/positionReviewRunner.ts');
    expect(runner).not.toMatch(/placeManualOrder|placeTakeProfit|submitOrder|adapter\./);
    expect(runner).toMatch(/if\(verdict\.decision!=='EXIT_PROPOSAL'\)return\{\.\.\.planFacts,reviewDecision:verdict\.decision\}/);
    expect(sourceOf('services/positionReviewPrompt.ts')).toMatch(/no order permission, no sizing permission/);
  });

  it('the routine-call bound is enforced by the scheduler, not by a caller that means well',()=>{
    const scheduler=sourceOf('services/positionReviewScheduler.ts');
    expect(scheduler).toContain("if(owner.ownerState!=='AI_ACTIVE')return{granted:false,reason:`OWNER_NOT_AI:${owner.ownerState}`,zeroRoutineCall:true}");
    expect(scheduler).toContain("'REVIEW_BUDGET_EXHAUSTED'");
    expect(scheduler).toContain("'REVIEW_FAILURE_BUDGET_EXHAUSTED'");
    expect(scheduler).toContain("'REVIEW_FACTS_UNCHANGED'");
    // The budget is spent in the same step that grants it: the scheduler never yields, so two events
    // in one tick cannot both be granted. Usage that was not reported stays UNKNOWN rather than
    // becoming a convenient zero.
    const reserved=scheduler.split('reserve(input:{')[1]?.split('\n  }')[0]??'';
    expect(reserved.length).toBeGreaterThan(200);
    expect(reserved).not.toMatch(/\bawait\b|\basync\b/);
    expect(reserved).toContain('budget.used++');
    expect(reserved).toContain('this.ports.ledger.record(opened)');
    expect(sourceOf('services/aiUsageLedger.ts')).toContain("status:'RUNNING'");
    expect(sourceOf('services/aiUsageLedger.ts')).toMatch(/usageStatus:exact\?'EXACT':'UNKNOWN'/);
  });
});
