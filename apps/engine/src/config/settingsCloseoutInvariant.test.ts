import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('V3.9.2 settings closeout defaults',()=>{
  it('keeps Burgundy Editorial as the default without overriding explicit runtime choices',()=>{
    const defaults=JSON.parse(readFileSync(new URL('../../../../config/settings.default.json',import.meta.url),'utf8'));
    expect(defaults.appearance.theme).toBe('BURGUNDY_EDITORIAL');
    const dashboardMain=readFileSync(new URL('../../../dashboard/src/main.ts',import.meta.url),'utf8');
    expect(dashboardMain).toContain("localStorage.getItem('zdj-theme')??'BURGUNDY_EDITORIAL'");
    expect(dashboardMain).toContain("localStorage.getItem('zdj-theme')");
  });
});