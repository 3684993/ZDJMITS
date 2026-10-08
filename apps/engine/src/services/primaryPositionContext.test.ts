import {expect,it} from 'vitest';
import {compactEntryFacts,buildCompactBrainPrompt} from '@zdj/core';
import {EntryIntelligencePacketSchema} from '@zdj/contracts';
import {harness} from './tradingQualityTestHarness.js';
import {buildPreAiExecutionEnvelope} from './preAiExecutionEnvelope.js';
import {existingPositionContext} from './existingPositionContext.js';
it('presents opposite inventory and origin age in the actual Primary prompt without reopening the occupied side',()=>{
 const h=harness(),s=h.state,now=Date.now(),symbol=h.packet.symbol;
 s.positions.set('held',{symbol,side:'SHORT',quantity:1,openedAt:now-5000,cycleId:'origin',entryTimeSource:'SYSTEM_FILL',managementStatus:'HUMAN_MANAGED'} as any);s.lifecycles.set(`${symbol}:SHORT`,{symbol,side:'SHORT',cycleId:'origin',currentQty:1,openedAt:now-5000,status:'OPEN'} as any);s.executionFills.push({symbol,direction:'SHORT',positionSide:'SHORT',side:'SELL',cycleId:'origin',qty:1,executionTime:now-5000} as any);
 const envelope=buildPreAiExecutionEnvelope(s,symbol,now),packet={...h.packet,executionEnvelope:envelope,existingPositionContext:existingPositionContext(s,symbol,now)};
 expect(envelope.SHORT.executable).toBe(false);expect(envelope.LONG.executable).toBe(true);expect(EntryIntelligencePacketSchema.parse(packet).existingPositionContext?.positions[0]?.holdingAgeMs).toBe(5000);
 const facts=compactEntryFacts(packet);expect(facts.CURRENT_POSITION_CONTEXT.positions[0]).toMatchObject({side:'SHORT',holdingAgeMs:5000,managementStatus:'HUMAN_MANAGED'});expect(facts.EXECUTION_ENVELOPE.entryAuthorizationPolicy).toBe('NO_SEPARATE_ADD_V398');
 const prompt=buildCompactBrainPrompt(packet);const received=JSON.parse(prompt.split('INPUT:')[1]!);expect(received.CURRENT_POSITION_CONTEXT.positions[0].side).toBe('SHORT');expect(received.EXECUTION_ENVELOPE.SHORT.executable).toBe(false);expect(received.EXECUTION_ENVELOPE.LONG.executable).toBe(true);expect(prompt).toContain('Primary alone');expect(prompt).toContain('UNKNOWN age is not zero');expect(h.exchange.placeEntry).not.toHaveBeenCalled();
});
