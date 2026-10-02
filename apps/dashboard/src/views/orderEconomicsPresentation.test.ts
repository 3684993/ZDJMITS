import {describe,expect,it} from 'vitest';
import {orderEconomicsPresentation} from './orderEconomicsPresentation.js';
describe('current order economics display',()=>{
  it('does not treat the remote placeholder leverage as known margin',()=>expect(orderEconomicsPresentation({quantity:2,price:100,leverage:1,leverageVerified:false})).toEqual({leverage:null,initialMarginQuote:null}));
  it('uses a verified local leverage including real 1x',()=>expect(orderEconomicsPresentation({quantity:2,price:100,leverage:1,leverageVerified:true})).toEqual({leverage:1,initialMarginQuote:200}));
  it('preserves the main economic mandate when remote leverage is a placeholder',()=>expect(orderEconomicsPresentation({quantity:2,price:100,leverage:1,economicMandate:{sizing:{leverage:20}}})).toEqual({leverage:20,initialMarginQuote:10}));
  it('does not invent price or quantity when only a mandate exists',()=>expect(orderEconomicsPresentation({economicMandate:{sizing:{leverage:20}}})).toEqual({leverage:20,initialMarginQuote:null}));
});
