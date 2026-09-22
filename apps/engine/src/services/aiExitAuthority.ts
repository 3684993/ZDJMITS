import type {AiExitVerdict,PolicyInput} from './s03AiExitPolicy.js';
import {decideAiExit} from './s03AiExitPolicy.js';
import type {V396ExitRuntime,V396PrepareExitInput} from './v396ExitRuntime.js';
import type {ExitTaskState} from './s04ExitCoordinator.js';

/**
 * J1: the single production door for an AI-initiated exit. It is authority-gated and defaults to
 * OFF: without ENFORCE nothing is decided, prepared or submitted. A SHADOW round may only record
 * what would have been decided. Only a model verdict computed from real cost facts can be
 * prepared, and the caller still has to pass the JIT check before the wire call.
 */
export type AiExitAuthority='OFF'|'SHADOW'|'ENFORCE';
export type AiExitOutcome={attempted:boolean;authority:AiExitAuthority;accepted:boolean;submitRequired:boolean;clientOrderId:string|null;
  taskId:string|null;reasons:string[];shadowDecision:AiExitVerdict|null};

export class AiExitAuthorityService {
  private shadowLog:Array<{scope:string;cycleId:string;outcome:string;reasons:string[];at:number}>=[];
  constructor(private readonly runtime:V396ExitRuntime,private readonly authority:()=>AiExitAuthority){}

  currentAuthority(){return this.authority();}
  shadowEntries(){return this.shadowLog.slice();}

  /**
   * Returns a prepared task only when the authority is ENFORCE, the verdict is a real model/cost
   * decision and the coordinator accepted it. Shadow keeps the decision for evidence and prepares
   * nothing, so no submit can be derived from it.
   */
  async evaluate(input:{subject:Parameters<V396ExitRuntime['prepareAiExit']>[0]['subject'];policyInput:Omit<PolicyInput,'now'>;exit:V396PrepareExitInput;now:number}):Promise<AiExitOutcome>{
    const authority=this.authority();
    if(authority==='OFF')return{attempted:false,authority,accepted:false,submitRequired:false,clientOrderId:null,taskId:null,reasons:['AI_EXIT_AUTHORITY_OFF'],shadowDecision:null};
    const verdict=decideAiExit({...input.policyInput,now:input.now});
    if(authority==='SHADOW'){
      this.shadowLog.push({scope:this.runtime.scope(input.subject),cycleId:String(input.subject.cycleId??''),outcome:verdict.outcome,
        reasons:[...verdict.reasonCodes,'SHADOW_NO_AUTHORITY'],at:input.now});
      return{attempted:false,authority,accepted:false,submitRequired:false,clientOrderId:null,taskId:null,reasons:['AI_EXIT_AUTHORITY_SHADOW'],shadowDecision:verdict};
    }
    const prepared=await this.runtime.prepareAiExit(input.exit,verdict);
    return{attempted:true,authority,accepted:prepared.accepted,submitRequired:prepared.submitRequired&&prepared.accepted,
      clientOrderId:prepared.clientOrderId,taskId:prepared.taskId,reasons:prepared.reasons,shadowDecision:null};
  }

  /** JIT guard the caller must pass immediately before any exchange write. */
  jit(input:{subject:Parameters<V396ExitRuntime['jitBeforeSubmit']>[0]['subject'];clientOrderId:string;proofCheckedAt:number;now:number}){
    return this.runtime.jitBeforeSubmit(input);
  }
}

export type ObservedExitFact={clientOrderId:string;state:ExitTaskState;filledUnits:number;positionVersion:number;eventId:string};
