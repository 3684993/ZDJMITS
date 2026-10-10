import type { ExecutionFill, TradeRecord } from '@zdj/contracts';
import type { OrderProvenanceRow } from './orderProvenanceRegistry.js';

type Role = 'TP' | 'MANUAL' | 'EXIT';
export type ExitProvenanceContext = {
  executionFills: ExecutionFill[];
  manualOrders: Map<string, any>;
  tpOrders: Map<string, any>;
  orderProvenance?: { resolve(input: {symbol:string;clientOrderId?:string|null;exchangeOrderId?:string|null}): {status:string;rows?:OrderProvenanceRow[];proof?:string[]} } | null;
};
const same = (a: unknown, b: unknown) => a != null && String(a) !== '' && String(a) === String(b ?? '');
const quantity = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
/** Read-only: role composition is not an identity collision. Unknown coverage never acquires a role. */
export function projectExitProvenance(record: TradeRecord, context: ExitProvenanceContext) {
  const ids = new Set(record.exitOrderIds), linked = new Set(record.linkedFillIds);
  const candidates = context.executionFills.filter(f => f.symbol === record.symbol &&
    f.side === (record.direction === 'LONG' ? 'SELL' : 'BUY') &&
    (ids.has(f.orderId) || ids.has(f.clientOrderId)) &&
    (linked.has(f.fillId) || (record.cycleId != null && f.cycleId === record.cycleId)));
  const rows = new Map<string, ExecutionFill>(); let identityConflict = false;
  const conflictReasons = new Set<string>();
  for (const f of candidates) {
    const key = f.tradeId ? `${f.symbol}|${f.tradeId}` : f.fillId;
    const prior = rows.get(key);
    if (prior && ['orderId','clientOrderId','qty','price','executionTime','cycleId'].some(k => (prior as any)[k] !== (f as any)[k])) {identityConflict = true;conflictReasons.add('DUPLICATE_TRADE_ID_FACT_MISMATCH');}
    else rows.set(key, f);
  }
  const fills = [...rows.values()].sort((a,b) => a.executionTime-b.executionTime || a.fillId.localeCompare(b.fillId));
  const roleQuantities: Record<Role, number> = {TP:0, MANUAL:0, EXIT:0};
  const identities = fills.map(fill => {
    const proof = context.orderProvenance?.resolve({symbol:fill.symbol,clientOrderId:fill.clientOrderId,exchangeOrderId:fill.orderId});
    const roles = new Set<Role>();
    const proofConflictCodes=(proof?.proof ?? []).filter(x => x.includes('CONFLICT'));
    for(const reason of proofConflictCodes)conflictReasons.add(String(reason));
    let conflict = proofConflictCodes.length>0;
    for (const row of proof?.rows ?? []) {
      if (row.symbol !== fill.symbol || !(same(row.clientOrderId,fill.clientOrderId) || same(row.exchangeOrderId,fill.orderId))) { conflict=true;conflictReasons.add('REGISTRY_IDENTITY_MISMATCH'); continue; }
      if (row.cycleId && record.cycleId && row.cycleId !== record.cycleId) {conflict=true;conflictReasons.add('REGISTRY_CYCLE_MISMATCH');}
      if (row.role === 'TP' || row.role === 'MANUAL' || row.role === 'EXIT') roles.add(row.role);
      else {conflict=true;conflictReasons.add('REGISTRY_ROLE_UNRECOGNIZED');}
    }
    const matching = (order:any) => order.symbol === fill.symbol &&
      (same(order.exchangeOrderId,fill.orderId) || same(order.clientOrderId,fill.clientOrderId));
    for (const [orders,role] of [[context.manualOrders,'MANUAL'],[context.tpOrders,'TP']] as const) {
      for (const order of orders.values()) if (matching(order) && (role !== 'MANUAL' || order.reduceOnly === true)) {
        if (order.cycleId && record.cycleId && order.cycleId !== record.cycleId) {conflict=true;conflictReasons.add('LOCAL_ORDER_CYCLE_MISMATCH');}
        roles.add(role);
      }
    }
    if (roles.size > 1) {conflict=true;conflictReasons.add('SAME_FILL_MULTIPLE_EXIT_ROLES');}
    identityConflict ||= conflict;
    const role: Role|null = !conflict && roles.size === 1 ? [...roles][0]! : null;
    if (role) roleQuantities[role] += quantity(fill.qty);
    return {fillId:fill.fillId,exchangeOrderId:fill.orderId,clientOrderId:fill.clientOrderId,quantity:fill.qty,executionTime:fill.executionTime,role,proofStatus:conflict?'CONFLICT':role?'EXACT':'UNRESOLVED'};
  });
  const observedQuantity = fills.reduce((n,f) => n+quantity(f.qty),0);
  const provenQuantity = Object.values(roleQuantities).reduce((n,v)=>n+v,0);
  const expectedQuantity = quantity(record.exitQty) || observedQuantity;
  const tolerance = Math.max(1e-10,expectedQuantity*1e-8);
  const quantityConflict = observedQuantity > expectedQuantity+tolerance;
  if(quantityConflict)conflictReasons.add('EXIT_QUANTITY_EXCEEDS_RECORDED_CYCLE');
  const unknownQuantity = Math.max(0,expectedQuantity-provenQuantity);
  const complete = unknownQuantity<=tolerance && observedQuantity+tolerance>=expectedQuantity && fills.length>=record.exitFillCount && !identityConflict && !quantityConflict;
  const roles = (Object.keys(roleQuantities) as Role[]).filter(role => roleQuantities[role]>0);
  const exitComposition = !complete?'UNKNOWN':roles.length===1?(roles[0]==='EXIT'?'SYSTEM_EXIT':roles[0]):
    roles.length===2 && roles.includes('TP') && roles.includes('MANUAL')?'MIXED_TP_MANUAL':roles.length>1?'MIXED':'UNKNOWN';
  const lastAt = identities.filter(i=>i.proofStatus==='EXACT').at(-1)?.executionTime;
  const lastRoles = new Set(identities.filter(row=>row.executionTime===lastAt&&row.proofStatus==='EXACT').map(row=>row.role));
  const lastRole = !identityConflict && lastRoles.size===1 ? [...lastRoles][0] : null;
  const finalizer = lastRole==='MANUAL'?'SYSTEM_MANUAL':lastRole==='EXIT'?'SYSTEM_EXIT':lastRole==='TP'?'TP':'UNKNOWN';
  const closeProvenance = !Number.isFinite(record.closedAt)?'OPEN':identityConflict||quantityConflict?'CONFLICT':exitComposition==='MANUAL'?'SYSTEM_MANUAL':exitComposition;
  return {closeProvenance,exitComposition,quantityConflict,
    conflictReasons:[...conflictReasons].sort(),provenanceEvidenceStatus:identityConflict||quantityConflict?'CONFLICT':complete?'PROVEN':'INCOMPLETE_OR_UNKNOWN',
    finalizer,finalizerIsTerminalProof:complete&&lastAt===fills.at(-1)?.executionTime,identityConflict,
    proofCoverage:{expectedQuantity,observedQuantity,provenQuantity,unknownQuantity,complete,roleQuantities},exitIdentityEvidence:identities};
}
