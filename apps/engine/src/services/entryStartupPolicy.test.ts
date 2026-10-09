import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {entryStartupPolicy} from './entryStartupPolicy.js';
const settings={settingsVersion:8,connections:{executionMode:'TESTNET_ENABLED',exchange:{environment:'TESTNET'}}};
it('separates analysis and startup from permission, requires exact approval and supports immediate revocation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'entry-policy-')),file=join(dir,'approval.json'),env={ZDJ_ENTRY_EXECUTION_POLICY:'TESTNET_ENTRY_ENABLED',ZDJ_ENTRY_APPROVAL_FILE:file,ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256:'artifact',ZDJ_DATA_DIR:'data'};
 const approval={version:1,mode:'TESTNET_ENTRY_ENABLED',operatorApproval:'ONE_TESTNET_ENGINE_SWITCH',revoked:false,expiresAt:200,settingsVersion:8,artifactSha256:'artifact',sourceSha256:'source',dataRoot:'data'};
 try{expect(entryStartupPolicy(settings,env,100,{artifactHash:'artifact',sourceHash:'source'})).toMatchObject({analysisAllowed:true,orderAuthorization:false});writeFileSync(file,JSON.stringify(approval));expect(entryStartupPolicy(settings,env,100,{artifactHash:'artifact',sourceHash:'source'}).orderAuthorization).toBe(true);expect(entryStartupPolicy(settings,{...env,ZDJ_ENTRY_ADMISSION_DISABLED:'1'},100,{artifactHash:'artifact',sourceHash:'source'}).orderAuthorization).toBe(false);expect(entryStartupPolicy(settings,env,200,{artifactHash:'artifact',sourceHash:'source'}).orderAuthorization).toBe(false);expect(entryStartupPolicy({...settings,settingsVersion:9},env,100,{artifactHash:'artifact',sourceHash:'source'}).orderAuthorization).toBe(false);expect(entryStartupPolicy({...settings,connections:{...settings.connections,exchange:{environment:'PRODUCTION'}}},env,100,{artifactHash:'artifact',sourceHash:'source'}).orderAuthorization).toBe(false);writeFileSync(file,JSON.stringify({...approval,revoked:true}));expect(entryStartupPolicy(settings,env,100,{artifactHash:'artifact',sourceHash:'source'})).toMatchObject({analysisAllowed:true,orderAuthorization:false});}finally{rmSync(dir,{recursive:true,force:true});}
});
