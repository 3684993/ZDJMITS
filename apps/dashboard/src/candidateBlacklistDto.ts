import type { UniverseCandidate } from '@zdj/contracts';

export function candidateBlacklistDto(candidate:UniverseCandidate,scope:'SYMBOL'|'UNDERLYING'){
  const symbol=String(candidate.symbol),underlying=String(candidate.underlyingAsset??symbol.replace(/(USDT|USDC|BUSD)$/,''));
  return{...(scope==='SYMBOL'?{symbol}:{}),underlying,scope,reason:'USER_BLACKLIST' as const};
}
