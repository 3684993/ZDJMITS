import {createHash} from 'node:crypto';
import {z} from 'zod';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finitePositive=z.number().finite().positive();
// This envelope is made by a deterministic, signed fact provider, never by the model.
export const TpTargetShadowFactsSchema=z.object({
 scopeHash:z.string().regex(/^[a-f0-9]{64}$/),cycleId:z.string().min(1),planId:z.string().min(1),planVersion:z.number().int().positive(),ownerVersion:z.number().int().positive(),
 owner:z.enum(['AI_MANAGED','HUMAN_MANAGED']),side:z.enum(['LONG','SHORT']),positionQuantity:finitePositive,entryPrice:finitePositive,
 signedAt:z.number().int().positive(),expiresAt:z.number().int().positive(),factsVersion:z.string().min(1),
 tpIdentityHash:z.string().regex(/^[a-f0-9]{64}$/),tpProtected:z.literal(true),tpRemainingQuantity:finitePositive,currentTarget:finitePositive,
 authorizedRange:z.object({min:finitePositive,max:finitePositive}).strict(),
 // Candidate legality is deterministic and tied to the same frozen plan, not model confidence.
 candidates:z.array(z.object({id:z.string().min(1).max(120),price:finitePositive,planId:z.string().min(1),planVersion:z.number().int().positive(),
  tickAligned:z.literal(true),netAfterCosts:z.number().finite(),requiredNet:z.number().finite().nonnegative(),evidenceRefs:z.array(z.string().min(1).max(160)).min(1).max(12)}).strict()).max(12),
}).strict();
export type TpTargetShadowFacts=z.infer<typeof TpTargetShadowFactsSchema>;
export const TpTargetShadowDecisionSchema=z.object({decision:z.enum(['KEEP','SELECT_CANDIDATE','HANDOFF']),candidateId:z.string().min(1).max(120).nullable(),evidenceRefs:z.array(z.string().min(1).max(160)).max(12),summary:z.string().max(500)}).strict();
export type TpTargetShadowDecision=z.infer<typeof TpTargetShadowDecisionSchema>;
export type TpTargetShadowResult={mode:'SHADOW';kind:'TP_TARGET_REVIEW_DRY_RUN';usable:boolean;reason:string;decision:TpTargetShadowDecision|null;candidateId:string|null;targetDelta:number|null;exchangeWrites:0;entryPermission:false;protectionChanged:false};
function validateFacts(input:unknown,now:number){
 const f=TpTargetShadowFactsSchema.parse(input);
 if(f.signedAt>now||now-f.signedAt>60000||f.expiresAt<=now)throw new Error('TP_SHADOW_SIGNED_FACTS_STALE');
 if(f.authorizedRange.min>f.authorizedRange.max||f.tpRemainingQuantity<f.positionQuantity)throw new Error('TP_SHADOW_PROTECTION_INCOMPLETE');
 const ids=new Set<string>();
 for(const c of f.candidates){
  if(ids.has(c.id)||c.planId!==f.planId||c.planVersion!==f.planVersion||c.price<f.authorizedRange.min||c.price>f.authorizedRange.max||c.netAfterCosts<c.requiredNet||!(f.side==='LONG'?c.price>f.entryPrice:c.price<f.entryPrice))throw new Error('TP_SHADOW_CANDIDATE_ILLEGAL');
  ids.add(c.id);
 }
 return f;
}
/** No exchange adapter, Settings writer, ownership transfer or Entry capability is accepted. */
export class TpTargetShadow {
 private active=new Set<string>();private seen=new Map<string,number>();
 constructor(private readonly ports:{now:()=>number;facts:()=>unknown;review:(input:{kind:'TP_TARGET_REVIEW_DRY_RUN';envelopeHash:string;candidateIds:string[];evidenceRefs:string[];mode:'SHADOW'})=>Promise<unknown>}){}
 async run():Promise<TpTargetShadowResult>{
  const base:TpTargetShadowResult={mode:'SHADOW',kind:'TP_TARGET_REVIEW_DRY_RUN',usable:false,reason:'UNKNOWN',decision:null,candidateId:null,targetDelta:null,exchangeWrites:0,entryPermission:false,protectionChanged:false};
  let f:TpTargetShadowFacts;
  try{f=validateFacts(this.ports.facts(),this.ports.now());}catch{return{...base,reason:'FACTS_INVALID_OR_STALE'};}
  if(f.owner==='HUMAN_MANAGED')return{...base,reason:'HUMAN_MANAGED_READ_ONLY'};
  const envelopeHash=hash(f),key=hash([f.scopeHash,f.cycleId,f.planId,f.planVersion,f.ownerVersion,f.factsVersion,f.tpIdentityHash]);
  if(this.active.has(key)||this.seen.has(key))return{...base,reason:'DUPLICATE_FACTS'};
  if(this.active.size>=16)return{...base,reason:'SHADOW_CAPACITY_FULL'};
  this.active.add(key);
  try{
   const refs=[...new Set(f.candidates.flatMap(c=>c.evidenceRefs))];
   const decision=TpTargetShadowDecisionSchema.parse(await this.ports.review({kind:'TP_TARGET_REVIEW_DRY_RUN',envelopeHash,candidateIds:f.candidates.map(c=>c.id),evidenceRefs:refs,mode:'SHADOW'}));
   const after=validateFacts(this.ports.facts(),this.ports.now());
   if(hash(after)!==envelopeHash)return{...base,reason:'FACTS_OR_OWNER_CHANGED'};
   const selected=f.candidates.find(c=>c.id===decision.candidateId);
   if((decision.decision==='SELECT_CANDIDATE'?!selected:decision.candidateId!==null)||decision.evidenceRefs.some(ref=>!refs.includes(ref))||decision.decision==='SELECT_CANDIDATE'&&!decision.evidenceRefs.length)return{...base,reason:'OUTPUT_NOT_FROZEN_OR_EVIDENCE_UNBOUND'};
   this.seen.set(key,this.ports.now());if(this.seen.size>720)this.seen.delete(this.seen.keys().next().value!);
   return{...base,usable:true,reason:'SHADOW_ONLY_NO_EXECUTION',decision,candidateId:selected?.id??null,targetDelta:selected?selected.price-f.currentTarget:null};
  }catch{return{...base,reason:'REVIEW_FAILED_OR_FACTS_EXPIRED'};}finally{this.active.delete(key);}
 }
}
