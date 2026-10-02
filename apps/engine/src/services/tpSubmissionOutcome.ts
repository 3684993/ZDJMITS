import { OrderPrecisionError } from '../adapters/binance/orderPrecision.js';
/** These exact local guards throw before the adapter can call the order transport. */
export function confirmedTpNotSent(error:unknown):boolean {
  const message=error instanceof Error?error.message:String(error);
  return error instanceof OrderPrecisionError || /^TESTNET_WRITE_EGRESS_NOT_VERIFIED:(UNAVAILABLE|UNVERIFIED|MISMATCH)$/.test(message)
    || message.startsWith('TP_EXIT_JIT_RECHECK_FAILED: ');
}
/** Only a definite exchange rejection can release an uncertain submission. */
export function confirmedTpSubmissionRejection(error: unknown): boolean {
  const message=error instanceof Error?error.message:String(error);
  const response=message.match(/^Binance HTTP 400: (\{.*\})$/s);
  if(!response)return false;
  try{return JSON.parse(response[1]!).code===-2022;}catch{return false;}
}
