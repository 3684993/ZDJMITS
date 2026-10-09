/** Offline only: archived projections, no HTTP, adapter, SettingsStore or live SQLite. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EntryDecisionV370Schema} from '@zdj/contracts';
import {materializePrimaryChoice,PRIMARY_CHOICE_PROTOCOL} from '../apps/engine/src/services/primaryCandidateChoice.js';
import {primaryFailureClass} from '../apps/engine/src/services/effectivePrimaryCadence.js';

const fixture=JSON.parse(fs.readFileSync(new URL('../docs/reports/v398-primary-cadence-20261009/historical-projection.json',import.meta.url),'utf8'));
let rejected=false;
try{EntryDecisionV370Schema.parse(fixture.bnb.raw);}catch(error){rejected=String(error).includes('min <= idealPrice <= max required');}
assert(rejected,'The actual archived illegal price must still fail');
const old=fixture.bnb.candidate,tick=fixture.bnb.tickSize;
const range={min:Number((Math.ceil(old.sizingProof.executableEntryRange.min/tick-1e-9)*tick).toFixed(2)),max:Number((Math.floor(old.sizingProof.executableEntryRange.max/tick+1e-9)*tick).toFixed(2))};
const projected={...old,entryReferencePrice:range.min,sizingProof:{...old.sizingProof,executableEntryRange:range}};
projected.candidateId='projection_'+createHash('sha256').update(JSON.stringify(projected)).digest('hex').slice(0,24);
const hash=createHash('sha256').update(JSON.stringify(projected)).digest('hex'),at=fixture.bnb.completedAt;
const packet:any={symbol:'BNBUSDC',executionEnvelope:{symbol:'BNBUSDC',createdAt:at-1,expiresAt:at+180000,exchange:{tickSize:tick},SHORT:{executable:true,candidateSetHash:hash,planCandidates:[projected]}}};
const choice:any={...fixture.bnb.raw,executionSelection:PRIMARY_CHOICE_PROTOCOL,candidateSetHash:hash,selectedCandidateId:projected.candidateId};
for(const key of ['quantityUnits','idealPrice','acceptablePriceRange','horizonMinutes','profitTakePlan'])delete choice[key];
const decision=EntryDecisionV370Schema.parse(materializePrimaryChoice(choice,packet,at));
assert.equal(decision.idealPrice,743.01);assert.equal(decision.profitTakePlan?.targetPrice,old.targetPrice);
assert.throws(()=>materializePrimaryChoice({...choice,idealPrice:743},packet,at));
assert.throws(()=>materializePrimaryChoice({...choice,candidateSetHash:'wrong'},packet,at));
const classes=fixture.primaryRuns.reduce((counts:any,r:any)=>{const key=r.status==='COMPLETED'?'COMPLETED_PROTOCOL':primaryFailureClass(r.error??'');counts[key]=(counts[key]??0)+1;return counts;},{});
console.log(JSON.stringify({source:'ACTUAL_ARCHIVE_SANITIZED_PROJECTION',originalBnb:'REJECTED_UNCHANGED',newProtocolProjection:{idealPrice:decision.idealPrice,range:decision.acceptablePriceRange,targetPrice:decision.profitTakePlan?.targetPrice},archiveRunClasses:classes,originJournalDrift:fixture.originDrift.length,exchangeWrites:0,liveStateWrites:0,modelInvocations:0,cadenceAcceptance:'UNKNOWN_NOT_DEPLOYED'},null,2));
