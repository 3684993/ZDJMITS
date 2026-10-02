import { readFileSync } from 'node:fs';
import { MarketSymbolSnapshotSchema } from '@zdj/contracts';
import { describe,it,expect } from 'vitest';
import { DirectionPolicyService } from './directionPolicyService.js';
import { RuntimeState } from '../state/runtimeState.js';
import settings from '../../../../config/settings.default.json' with { type:'json' };
import { SystemSettingsSchema } from '@zdj/contracts';

const archived=JSON.parse(readFileSync(new URL('./fixtures/v363-entry.json',import.meta.url),'utf8'))[0].packet.market;
const snap=(symbol:string)=>MarketSymbolSnapshotSchema.parse({...archived,symbol,dataCompleteness:1,quote:{...archived.quote,symbol}});

describe('V3.9.7 direction policy',()=>{it('keeps legacy short preference as observation/tie-breaker instead of a LONG veto',()=>{const state=new RuntimeState(SystemSettingsSchema.parse({...settings,appearance:{...(settings as any).appearance,theme:'BINANCE_NOIR'}})),service=new DirectionPolicyService(state);expect(service.evaluate('BTCUSDT',snap('BTCUSDT')).preference).toBe('BALANCED');expect(service.evaluate('ALTUSDT',snap('ALTUSDT')).preference).toBe('INTELLIGENT_SHORT_BIAS');state.settings.portfolioIntelligence.symbolOverrides.ALTUSDT={riskTier:'SPECULATIVE'};const p=service.evaluate('ALTUSDT',snap('ALTUSDT'));expect(p.preference).toBe('STRICT_SHORT_BIAS');expect(p.allowedDirections).toEqual(['LONG','SHORT']);expect(p.longExceptionRequired).toBe(false);expect(p.reasonCodes).toContain('LEGACY_PREFERENCE_OBSERVATION_STRICT_SHORT_BIAS');expect(service.allows(p,{decision:'PLACE_LONG',direction:'LONG'} as any).ok).toBe(true);});});
