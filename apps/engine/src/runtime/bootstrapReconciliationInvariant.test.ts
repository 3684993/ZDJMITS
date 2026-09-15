import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('bootstrap reconciliation invariant',()=>{
  it('refreshes position market facts before exactly one startup reconciliation',()=>{
    const source=readFileSync(new URL('./appRuntime.ts',import.meta.url),'utf8'),bootstrap=source.slice(source.indexOf('async bootstrap()'),source.indexOf('async start()'));
    expect(bootstrap.match(/this\.reconciliation\.run\(\)/g)?.length??0).toBe(1);
    expect(bootstrap.indexOf('await this.refreshPositionMarkets()')).toBeLessThan(bootstrap.indexOf('await this.reconciliation.run()'));
  });
});