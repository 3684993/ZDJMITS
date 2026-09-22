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

/**
 * J2 replaced "S05 has no production consumer" with a closed list. Exactly one module may turn the
 * pure snapshot, stress and capacity functions into an admission decision, and it is the only module
 * allowed to import them. Adding a second one has to be a deliberate edit here.
 */
const ADMISSION='services/portfolioRiskLedger.ts';

describe('S05 production consumer boundary',()=>{
  it('the pure S05 modules have exactly one admission consumer plus their own siblings',()=>{
    expect(consumers('portfolioRiskSnapshot')).toEqual([
      'services/humanCapacityPolicy.ts',
      ADMISSION,
      'services/portfolioStress.ts',
    ].sort());
    expect(consumers('portfolioStress')).toEqual([ADMISSION]);
    expect(consumers('humanCapacityPolicy')).toEqual([ADMISSION]);
  });

  it('RuntimeState no longer imports the S05 modules at all; the gate is injected',()=>{
    const source=readFileSync(path.join(SRC,'state/runtimeState.ts'),'utf8');
    expect(source).not.toMatch(/portfolioRiskSnapshot|portfolioStress|humanCapacityPolicy/);
    // The reservation transaction still refuses a binding it cannot verify, and it has no default.
    expect(source).toMatch(/RISK_ADMISSION_UNPROVEN/);
    expect(source).toMatch(/typeof this\.entryRiskGate!=='function'/);
  });

  it('the admission is the installed producer of the reservation binding',()=>{
    const ledger=readFileSync(path.join(SRC,ADMISSION),'utf8');
    for(const symbol of ['buildPortfolioRiskSnapshot','evaluatePortfolioStress','evaluateHumanCapacity'])expect(ledger,symbol).toContain(symbol);
    const runtime=readFileSync(path.join(SRC,'runtime/appRuntime.ts'),'utf8');
    expect(runtime).toMatch(/state\.entryRiskGate\s*=\s*\(input:\s*any\)\s*=>\s*\{[\s\S]*?portfolioRisk!\.gate\(input\)/);
    // Writers never reach for the S05 modules themselves.
    for(const file of ['services/entryCoordinator.ts','services/accountExecutor.ts','services/manualPositionService.ts','services/tpGuardian.ts','services/reconciliationService.ts','state/runtimeState.ts']){
      const full=path.join(SRC,file);let source='';try{source=readFileSync(full,'utf8');}catch{continue;}
      expect(source,file).not.toMatch(/from\s+['\"][^'\"]*(portfolioRiskSnapshot|portfolioStress|humanCapacityPolicy|portfolioRiskLedger)\.js['\"]/);
    }
  });

  it('entry admission is unavailable rather than permissive when the gate is missing',()=>{
    const coordinator=readFileSync(path.join(SRC,'services/entryCoordinator.ts'),'utf8');
    expect(coordinator).toContain('RISK_ADMISSION_UNPROVEN');
    expect(coordinator).toContain('PORTFOLIO_RISK_ADMISSION');
    // The retired impersonation must not come back: no selection generation standing in for risk.
    expect(coordinator).not.toMatch(/riskGeneration:Number\(candidate\?\.selectionGeneration\)/);
  });
});
