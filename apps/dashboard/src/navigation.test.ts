import { describe,expect,it } from 'vitest';
import { isPrimaryMobileRoute,mobileMoreRouteNames,mobilePrimaryRouteNames,routePath } from './navigation';

describe('responsive navigation contract',()=>{
  it('keeps the four requested bottom-nav routes and routes more pages to the drawer',()=>{
    expect(mobilePrimaryRouteNames).toEqual(['overview','trade-records','positions','settings']);
    expect(mobileMoreRouteNames).toContain('universe');
    expect(mobileMoreRouteNames).toContain('operations');
    expect(isPrimaryMobileRoute('positions')).toBe(true);
    expect(isPrimaryMobileRoute('brain')).toBe(false);
  });
  it('uses actual router paths',()=>{
    expect(routePath('overview')).toBe('/');
    expect(routePath('trade-records')).toBe('/trade-records');
  });
});
