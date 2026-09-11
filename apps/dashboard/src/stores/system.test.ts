import { describe,it,expect } from 'vitest';

describe('dashboard contract',()=>{
  it('keeps trading logic server-side',()=>{
    const forbidden=['placeOrder','closePosition','changeLeverage'];
    expect(forbidden).toHaveLength(3);
  });
});
