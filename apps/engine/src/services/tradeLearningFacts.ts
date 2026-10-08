import {LearningFundingProofSchema} from '@zdj/contracts';
import type {TradeRecord} from '@zdj/contracts';
import {projectExitProvenance, type ExitProvenanceContext} from './exitProvenance.js';
import {projectEntryLineage, type EntryLineageContext} from './entryLineage.js';
import {projectFillLedgers, type attributeFunding} from './factLedgers.js';
export type TradeLearningContext=ExitProvenanceContext & EntryLineageContext & {settings?:{connections:{exchange:{environment:string;credentialRef:string}}}};
export function projectTradeLearningFacts(record:TradeRecord,context:TradeLearningContext,funding?:ReturnType<typeof attributeFunding>) {
  const parsed=LearningFundingProofSchema.safeParse(record.learningFundingProof),p=parsed.success?parsed.data:null;
  const exchange=context.settings?.connections?.exchange,scope=exchange?`${exchange.environment}|${exchange.credentialRef}`:null;
  const stored=p&&(!scope||scope===p.accountScope)&&p.cycleId===record.cycleId&&record.openedAt!=null&&record.closedAt!=null&&p.from<=record.openedAt&&p.to>=record.closedAt?{status:'EXACT' as const,amount:p.amount,asset:p.asset,reasons:[],allocations:p.allocations,coverageIds:p.coverageIds}:null;
  return {fillLedger:projectFillLedgers(record,context.executionFills),exit:projectExitProvenance(record,context),entry:projectEntryLineage(record,context),funding:funding??stored};
}
export type TradeLearningFacts=ReturnType<typeof projectTradeLearningFacts>;
