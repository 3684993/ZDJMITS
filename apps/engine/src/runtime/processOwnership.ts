export type ProcessEvidence={pid:number;ppid:number;name:string;executablePath?:string|null;commandLine?:string|null;parentName?:string|null;identityPid?:number|null};
export type ProcessClassification='ZDJ_RUNTIME_REQUIRED'|'ZDJ_TRANSIENT_CHILD'|'ZDJ_ORPHANED_CHILD'|'EXTERNAL_TOOL_PROCESS'|'UNKNOWN_DO_NOT_KILL';
export function classifyProcess(p:ProcessEvidence):ProcessClassification{
  const command=p.commandLine??'',path=p.executablePath??'';
  if(p.name.toLowerCase()==='node.exe'&&p.identityPid===p.pid&&/(^|[\s/])dist[\/]main\.js([\s]|$)/i.test(command))return'ZDJ_RUNTIME_REQUIRED';
  if(/D:\\MITS|@zdj\/engine|dist[\/]main\.js/i.test(command))return p.ppid>0?'ZDJ_TRANSIENT_CHILD':'ZDJ_ORPHANED_CHILD';
  if(/OpenAI\\Codex|codex-runtimes|cua_node/i.test(path)||p.parentName?.toLowerCase()==='codex.exe')return'EXTERNAL_TOOL_PROCESS';
  return'UNKNOWN_DO_NOT_KILL';
}
export const mayStopProcess=(classification:ProcessClassification)=>classification==='ZDJ_RUNTIME_REQUIRED'||classification==='ZDJ_ORPHANED_CHILD';
