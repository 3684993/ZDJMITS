import { testnetFundsOnlyEntry } from '@zdj/core';

/**
 * P3: two controls that V3.9.6 had collapsed into one SQLite unique index.
 *
 * `SubmissionIdentity` answers exactly-once: has *this* decision already been sent, might it have
 * been sent, or is its fate unknown so it must be re-proved by the same client order id? That is a
 * property of one intent and must never be shared with another intent.
 *
 * `PortfolioScopeObservation` answers a different question: what risk history does this underlying
 * already carry? Under TESTNET_FUNDS_ONLY that is an observation only. Keeping it in the same unique
 * index as submission identity is what produced the audited failure chain (R6): a new INJ intent with
 * valid funds and a live authorization was refused because an unrelated older INJ intent still had an
 * UNKNOWN row, and the refusal then surfaced as `RESERVATION_INVALID`.
 */

export type SubmissionIdentity={
  environment:string;accountId:string;intentId:string;clientOrderId:string;payloadHash:string;kind:'ENTRY'|'EXIT';
};

export type EntryIsolationMode='SUBMISSION_ONLY'|'UNDERLYING_LEGACY';

export type EntrySubmissionIsolation={
  mode:EntryIsolationMode;
  /** One active row per submission identity, always enforced. */
  submissionKey:string;
  /** Legacy per-underlying exclusion; only meaningful when mode is UNDERLYING_LEGACY. */
  isolationKey:string;
  enforcedBy:SubmissionIdentity['kind'];
  /** Deterministic physical-cycle authority; independent from portfolio-risk observation. */
  noAdd?:{authorizedQuantity:number};
};

export type PortfolioScopeObservation={
  environment:string;accountId:string;underlying:string;side:string;
  /** Whether this observation may stop an Entry. Under funds-only it never may. */
  enforced:boolean;
  basis:'TESTNET_FUNDS_ONLY_OBSERVATION'|'PORTFOLIO_SCOPE_ENFORCED';
  historicalUnknownRows:number;activeClaimRows:number;expiredProofRows:number;
  note:string;
};

/**
 * Identity strings are stored verbatim: the environment, credential reference and intent id already
 * carry their own canonical form, and re-casing them here would make a backfilled row and a freshly
 * claimed row compute different keys for the same submission.
 */
const key=(parts:unknown[])=>JSON.stringify(parts.map(part=>String(part??'').trim()));

/**
 * The precise TESTNET + TESTNET_ENABLED + funds-only condition decides the mode. Anything else keeps
 * the legacy per-underlying exclusion, so removing the veto cannot silently widen Production.
 */
export function entrySubmissionIsolation(settings:any,identity:{environment:string;accountId:string;intentId:string;underlying:string;kind?:'ENTRY'|'EXIT'}):EntrySubmissionIsolation{
  const fundsOnly=testnetFundsOnlyEntry(settings);
  const kind=identity.kind??'ENTRY';
  return{
    mode:fundsOnly?'SUBMISSION_ONLY':'UNDERLYING_LEGACY',
    submissionKey:key([identity.environment,identity.accountId,identity.intentId,kind]),
    // The legacy exclusion used exactly the persisted scope string, so an already-active Production row
    // keeps holding the same key it holds today instead of being re-keyed under a new name.
    isolationKey:key([identity.environment,identity.accountId,String(identity.underlying??'').trim().toUpperCase(),kind]),
    enforcedBy:kind,
  };
}

/** The scope persisted before this split used the underlying as the third element; keep that reading. */
export function underlyingOf(value:string){
  return String(value??'').trim().toUpperCase().replace(/(USDT|USDC|BUSD)$/,'');
}

/**
 * An observation is computed from the same rows the veto used to lock on, but it is reported as data
 * with a basis, never returned as a refusal. Callers that still enforce portfolio scope must say so
 * through `enforced:true`, which funds-only cannot produce.
 */
export function portfolioScopeObservation(input:{settings:any;environment:string;accountId:string;underlying:string;side:string;
  historicalUnknownRows?:number;activeClaimRows?:number;expiredProofRows?:number}):PortfolioScopeObservation{
  const fundsOnly=testnetFundsOnlyEntry(input.settings);
  return{
    environment:input.environment,accountId:input.accountId,underlying:input.underlying,side:input.side,
    enforced:!fundsOnly,
    basis:fundsOnly?'TESTNET_FUNDS_ONLY_OBSERVATION':'PORTFOLIO_SCOPE_ENFORCED',
    historicalUnknownRows:Math.max(0,Math.trunc(Number(input.historicalUnknownRows??0))),
    activeClaimRows:Math.max(0,Math.trunc(Number(input.activeClaimRows??0))),
    expiredProofRows:Math.max(0,Math.trunc(Number(input.expiredProofRows??0))),
    note:fundsOnly
      ?'历史 UNKNOWN/claim 与 underlying 风险仅作观察，不阻断新的 Entry 提交身份'
      :'非 funds-only 模式：underlying 范围排他仍然生效',
  };
}

/** Typed causes so a journal conflict keeps its own name instead of becoming RESERVATION_INVALID. */
export type EntryClaimCause='ACQUIRED'|'SAME_INTENT_REPLAY'|'SAME_INTENT_UNACKNOWLEDGED_RECOVER'|'SUBMISSION_IDENTITY_CONFLICT'|'LEGACY_UNDERLYING_ISOLATION'|'JOURNAL_CONFLICT'|'RELEASED_IDENTITY_IMMUTABLE'|'NO_SEPARATE_ADD';

export type EntryClaimOutcome={acquired:boolean;cause:EntryClaimCause;record:any;conflict:{intentId:string|null;orderId:string|null;clientOrderId:string|null;status:string|null;at:number|null}|null;maySubmit:boolean;mustQueryFirst:boolean};

export function describeClaimConflict(record:any){
  const order=record?.order??{};
  return{intentId:String(order.intentId??record?.intent?.id??'')||null,orderId:String(order.id??'')||null,
    clientOrderId:String(order.clientOrderId??'')||null,status:String(order.status??'')||null,
    at:Number.isFinite(Number(order.updatedAt))?Number(order.updatedAt):null};
}
