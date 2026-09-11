/** Only a definite exchange rejection can release an uncertain submission. */
export function confirmedTpSubmissionRejection(error: unknown): boolean {
  const message=error instanceof Error?error.message:String(error);
  const response=message.match(/^Binance HTTP 400: (\{.*\})$/s);
  if(!response)return false;
  try{return JSON.parse(response[1]!).code===-2022;}catch{return false;}
}
