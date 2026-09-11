import type { AssetAdmission, SystemSettings } from '@zdj/contracts';
import { resolveUnderlying } from './portfolio.js';

const canonical=(value:string)=>String(value??'').trim().normalize('NFKC').replace(/[\s/_-]+/g,'').toUpperCase();
const CORE=new Set(['BTC','ETH']);

/** Versioned governance directory. Unknown assets remain visible for research but never reach online Primary. */
export function classifyAsset(symbol:string,settings:SystemSettings,now=Date.now()):AssetAdmission{
  const underlying=canonical(resolveUnderlying(symbol));
  const directory=settings.selection.assetDirectory;
  const excluded=new Set(directory.excluded.map(canonical));
  const approved=new Set(directory.approvedLiquid.map(canonical));
  if(excluded.has(underlying))return{underlying,classification:'EXCLUDED',directoryVersion:directory.version,sourceDomain:'STATIC_GOVERNANCE',reason:'ASSET_DIRECTORY_EXCLUDED',updatedAt:now};
  if(CORE.has(underlying))return{underlying,classification:'CORE',directoryVersion:directory.version,sourceDomain:'STATIC_GOVERNANCE',reason:'CORE_BTC_ETH',updatedAt:now};
  const evidence=directory.approvals?.[underlying],v4=String(directory.methodVersion).includes('V4'),current=Number.isFinite(directory.reviewedAt)&&Number.isFinite(directory.nextReviewAt)&&Number(directory.nextReviewAt)>=now,traceable=Boolean(directory.evidenceHash&&evidence&&Number(evidence.reviewedAt)>=Number(directory.reviewedAt)&&evidence.quoteVolumeUsd24h>=20_000_000&&evidence.medianDailyQuoteVolumeUsd30d>=20_000_000&&evidence.tradeCount24h>=20_000&&evidence.openInterestUsd>=5_000_000&&evidence.listingAgeDays>=180&&evidence.liquidityComposite>=.2);
  if(approved.has(underlying)&&v4&&current&&traceable)return{underlying,classification:'APPROVED_LIQUID',directoryVersion:directory.version,sourceDomain:'STATIC_GOVERNANCE',reason:'TRACEABLE_V4_DIRECTORY_APPROVAL',updatedAt:now};
  if(approved.has(underlying))return{underlying,classification:'RESEARCH_ONLY',directoryVersion:directory.version,sourceDomain:'STATIC_GOVERNANCE',reason:!v4?'LEGACY_DIRECTORY_METHOD':!current?'ASSET_APPROVAL_EXPIRED':'ASSET_APPROVAL_EVIDENCE_INVALID',updatedAt:now};
  return{underlying,classification:'RESEARCH_ONLY',directoryVersion:directory.version,sourceDomain:'STATIC_GOVERNANCE',reason:'NO_TRACEABLE_ASSET_APPROVAL',updatedAt:now};
}

export function isOnlineAsset(admission:AssetAdmission){return admission.classification==='CORE'||admission.classification==='APPROVED_LIQUID';}
