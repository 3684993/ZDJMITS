import {readFileSync} from 'node:fs';

let runtimeIdentity:{artifactHash?:string;sourceHash?:string}|null=null;
export function bindEntryStartupIdentity(identity:{artifactHash?:string;sourceHash?:string}){runtimeIdentity={...identity};}

export function entryStartupPolicy(settings:{settingsVersion?:number;connections?:{executionMode?:string;exchange?:{environment?:string}}},env:NodeJS.ProcessEnv=process.env,now=Date.now(),identity=runtimeIdentity){
  const mode=env.ZDJ_ENTRY_EXECUTION_POLICY;
  const result=(orderAuthorization:boolean,reason:string)=>({mode:orderAuthorization?'TESTNET_ENTRY_ENABLED':'ANALYSIS_ONLY',analysisAllowed:true,riskObservation:true,orderAuthorization,reason});
  if(env.ZDJ_ENTRY_ADMISSION_DISABLED==='1')return result(false,'ENTRY_ADMISSION_DISABLED_BY_STARTUP_POLICY');
  // Preserve legacy lifecycle semantics; the reboot orchestrator always supplies an explicit mode.
  if(mode===undefined)return {mode:'LEGACY_GUARDED',analysisAllowed:true,riskObservation:true,orderAuthorization:true,reason:'EXISTING_EXECUTION_GUARDS_REQUIRED'};
  if(mode!=='TESTNET_ENTRY_ENABLED')return result(false,'EXPLICIT_ANALYSIS_ONLY');
  try{
    const approval=JSON.parse(readFileSync(env.ZDJ_ENTRY_APPROVAL_FILE??'','utf8'));
    if(settings.connections?.exchange?.environment!=='TESTNET'||settings.connections?.executionMode!=='TESTNET_ENABLED')return result(false,'TESTNET_SETTINGS_REQUIRED');
    if(approval.version!==1||approval.mode!=='TESTNET_ENTRY_ENABLED'||approval.operatorApproval!=='ONE_TESTNET_ENGINE_SWITCH'||approval.revoked!==false||!Number.isFinite(approval.expiresAt)||approval.expiresAt<=now||approval.settingsVersion!==settings.settingsVersion||!identity?.artifactHash||identity.artifactHash!==approval.artifactSha256||!identity.sourceHash||identity.sourceHash!==approval.sourceSha256||!env.ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256||approval.artifactSha256!==env.ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256||!env.ZDJ_DATA_DIR||approval.dataRoot!==env.ZDJ_DATA_DIR)return result(false,'ENTRY_APPROVAL_INVALID_OR_EXPIRED');
    return result(true,'EXPLICIT_TESTNET_APPROVAL_VALID');
  }catch{return result(false,'ENTRY_APPROVAL_UNAVAILABLE');}
}
