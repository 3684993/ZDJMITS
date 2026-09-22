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

describe('S05 production consumer boundary',()=>{
  it('only explicit production consumers may import the pure S05 modules',()=>{
    expect(consumers('portfolioRiskSnapshot')).toEqual([
      'services/humanCapacityPolicy.ts',
      'services/portfolioStress.ts',
      'state/runtimeState.ts',
    ]);
    expect(consumers('portfolioStress')).toEqual([]);
    expect(consumers('humanCapacityPolicy')).toEqual([]);
  });

  it('RuntimeState may consume only the stable hash helper, not portfolio admission authority',()=>{
    const source=readFileSync(path.join(SRC,'state/runtimeState.ts'),'utf8');
    const match=source.match(/import\s*\{([^}]*)\}\s*from\s*['\"]\.\.\/services\/portfolioRiskSnapshot\.js['\"]/);
    expect(match?.[1].split(',').map(x=>x.trim()).filter(Boolean)).toEqual(['stableRiskHash']);
    expect(source).not.toMatch(/evaluatePortfolioStress|evaluateHumanCapacity|buildPortfolioRiskSnapshot/);
  });

  it('entry and exit writers cannot directly import S05 pure modules',()=>{
    for(const file of ['services/entryCoordinator.ts','services/accountExecutor.ts','services/manualPositionService.ts','services/tpGuardian.ts','services/reconciliationService.ts']){
      const full=path.join(SRC,file);let source='';try{source=readFileSync(full,'utf8');}catch{continue;}
      expect(source,file).not.toMatch(/from\s+['\"][^'\"]*(portfolioRiskSnapshot|portfolioStress|humanCapacityPolicy)\.js['\"]/);
    }
  });
});
