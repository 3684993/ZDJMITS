#!/usr/bin/env node
// Retention now runs in bounded SettingsStore scheduler batches. Never install an unbounded INSERT trigger.
if(process.argv.includes('--apply'))throw new Error('RETENTION_IS_RUNTIME_MANAGED: use the verified runtime build; no offline trigger installation is needed');
console.log(JSON.stringify({mode:'DRY_RUN',status:'RUNTIME_MANAGED',batchRows:100,intervalMs:5000,legacyTrigger:'removed by SettingsStore initialization'},null,2));
