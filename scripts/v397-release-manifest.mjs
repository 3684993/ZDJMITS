#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'docs/reports/v397-entry-sizing-primary-authority-version-closeout-20261004/release-manifest.json');
const files=[
  'package.json','package-lock.json','config/settings.default.json','packages/contracts/src/version.ts',
  'packages/contracts/src/settings.ts','packages/contracts/src/trading.ts','packages/contracts/src/tradePlan.ts',
  'apps/engine/src/services/v397FrozenSizing.ts','apps/engine/src/services/quantityHorizonCandidates.ts',
  'apps/engine/src/services/preAiExecutionEnvelope.ts','apps/engine/src/services/entryCoordinator.ts',
  'apps/engine/src/services/aiQuantityAllocation.ts','apps/engine/src/services/marketDataStaleness.ts',
  'apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts','apps/engine/src/services/runExecutionOutcome.ts',
  'apps/dashboard/src/views/OverviewView.vue','apps/dashboard/src/views/SettingsView.vue',
];
const hash=file=>createHash('sha256').update(readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')).digest('hex');
const manifest={schemaVersion:'V397-RELEASE-MANIFEST-1',releaseVersion:'3.9.7',apiVersion:'V3.9.7',
  startMainSha:'fc95fe0fe64d36ccb961c6657eaedc7b48a99ab8',
  identityRule:'SHA-256 of LF-normalized UTF-8 source; manifest commit itself is excluded to avoid self-reference',
  files:Object.fromEntries(files.map(file=>[file,hash(file)])),
  policy:{minimumInitialMarginByQuote:{USDT:100,USDC:100},leverageRange:[10,20],
    BTCUSDT:{exchangeMinimumSource:'TESTNET exchangeInfo live readback required',businessMinimumNotionalQuote:150}},
  runtimeAcceptance:'REQUIRES_FINAL_TESTNET_READBACK'};
writeFileSync(out,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({gate:'V397_RELEASE_MANIFEST_WRITTEN',file:path.relative(root,out),files:files.length}));
