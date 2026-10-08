const localPreWireErrors=new WeakSet<Error>();
/** Only the guardian's known pre-adapter boundary may mint this proof. An adapter
 * error/string with the same wording is not evidence that no request was sent. */
export function tpLocalPreWireFailure(cause:unknown):Error{
  const error=new Error(`TP_LOCAL_PREWIRE_FAILED: ${cause instanceof Error?cause.message:String(cause)}`,{cause});
  localPreWireErrors.add(error);return error;
}
/** These exact local guards throw before the adapter can call the order transport. */
export function confirmedTpNotSent(error:unknown):boolean {
  if(error instanceof Error&&localPreWireErrors.has(error))return true;
  const message=error instanceof Error?error.message:String(error);
  return /^TESTNET_WRITE_EGRESS_NOT_VERIFIED:(UNAVAILABLE|UNVERIFIED|MISMATCH)$/.test(message)
    || message.startsWith('TP_EXIT_JIT_RECHECK_FAILED: ');
}
/** Only a definite exchange rejection can release an uncertain submission. */
export function confirmedTpSubmissionRejection(error: unknown): boolean {
  const message=error instanceof Error?error.message:String(error);
  const response=message.match(/^Binance HTTP 400: (\{.*\})$/s);
  if(!response)return false;
  try{return JSON.parse(response[1]!).code===-2022;}catch{return false;}
}
