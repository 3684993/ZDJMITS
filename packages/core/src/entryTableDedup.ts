/** Exact-value transport factoring. No rounding, defaults, or timestamp arithmetic. */
export type JsonValue = string | number | boolean | null | JsonValue[] | {[key:string]:JsonValue};
export type FactColumn = string | string[];
export interface TableDedup {
  copies?:[FactColumn,FactColumn][];
  profiles?:{columns:FactColumn[];rows:JsonValue[][];forRows:number[]};
}
type Table = TableDedup & {common:{[key:string]:JsonValue};columns:FactColumn[];rows:JsonValue[][]};
const object=(v:unknown):v is {[key:string]:JsonValue}=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(v:object,k:string|number)=>Object.prototype.hasOwnProperty.call(v,k);
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const key=(v:JsonValue):string=>Array.isArray(v)?`[${v.map(key).join(',')}]`:object(v)?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${key(v[k])}`).join(',')}}`:JSON.stringify(v);
const path=(v:FactColumn):string[]=>typeof v==='string'?[v]:v;
const columnKey=(v:FactColumn)=>JSON.stringify(path(v));
const dense=(v:unknown[])=>Array.from({length:v.length},(_,i)=>own(v,i)).every(Boolean);
const validColumn=(v:unknown):v is FactColumn=>typeof v==='string'||Array.isArray(v)&&v.length>0&&dense(v)&&v.every(k=>typeof k==='string');
const validJson=(v:unknown):v is JsonValue=>v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||Array.isArray(v)&&dense(v)&&v.every(validJson)||object(v)&&Object.values(v).every(validJson);
const size=(v:unknown)=>JSON.stringify(v).length;

/** Values with these meanings repeat across candidate sizing tiers or market clocks. */
const PROFILE_FIELDS=new Set([
  'acceptableTargetRange','entryReferencePrice','leverage','reachProbability','reachProbabilityStatus',
  'reachabilityP50MovePercent','reachabilityP75MovePercent','side','targetBasis','targetHorizonMinutes','targetPrice',
  'targetVsStatisticalCeiling','costVersion',
]);

export function compactTableValues<T extends Table>(input:T,prefixCells:number):T & TableDedup {
  let table=clone(input);
  // Copies refer only to retained columns, never to another copy or a common field.
  const retained:number[]=[],copies:[FactColumn,FactColumn][]=[];
  table.columns.forEach((column,i)=>{
    const source=retained.find(j=>table.rows.every(row=>key(row[i+prefixCells])===key(row[j+prefixCells])));
    if(source===undefined)retained.push(i);else copies.push([column,table.columns[source]]);
  });
  if(copies.length){
    const candidate={...table,columns:retained.map(i=>table.columns[i]),
      rows:table.rows.map(row=>[...row.slice(0,prefixCells),...retained.map(i=>row[i+prefixCells])]),copies};
    if(size(candidate)<size(table))table=candidate;
  }
  const profileColumns=table.columns.map((column,i)=>({column,i})).filter(({column})=>PROFILE_FIELDS.has(path(column)[0]));
  if(profileColumns.length&&table.rows.length>1){
    const unique=new Map<string,number>(),profileRows:JsonValue[][]=[],forRows:number[]=[];
    for(const row of table.rows){
      const values=profileColumns.map(({i})=>row[i+prefixCells]),signature=key(values);
      let index=unique.get(signature);
      if(index===undefined){index=profileRows.length;unique.set(signature,index);profileRows.push(values);}
      forRows.push(index);
    }
    if(profileRows.length<table.rows.length){
      const chosen=new Set(profileColumns.map(({i})=>i)),remaining=table.columns.map((_,i)=>i).filter(i=>!chosen.has(i));
      const candidate={...table,columns:remaining.map(i=>table.columns[i]),
        rows:table.rows.map(row=>[...row.slice(0,prefixCells),...remaining.map(i=>row[i+prefixCells])]),
        profiles:{columns:profileColumns.map(({column})=>column),rows:profileRows,forRows}};
      if(size(candidate)<size(table))table=candidate;
    }
  }
  return table;
}

/** Restore a conventional V2 table before its existing path/schema validation. */
export function expandTableValues<T extends Table>(input:T,prefixCells:number):T {
  const table=clone(input),{profiles,copies}=table;
  if(!Array.isArray(table.columns)||!dense(table.columns)||!table.columns.every(validColumn)||
    !Array.isArray(table.rows)||!dense(table.rows)||table.rows.some(row=>!Array.isArray(row)||!dense(row)||row.length!==table.columns.length+prefixCells||!validJson(row)))throw new Error('ENTRY_TABLE_DEDUP_SHAPE_INVALID');
  if(profiles!==undefined){
    if(!object(profiles)||!Array.isArray(profiles.columns)||!profiles.columns.length||!dense(profiles.columns)||!profiles.columns.every(validColumn)||
      !Array.isArray(profiles.rows)||!profiles.rows.length||!dense(profiles.rows)||profiles.rows.some(row=>!Array.isArray(row)||!dense(row)||row.length!==profiles.columns.length||!validJson(row))||
      !Array.isArray(profiles.forRows)||!dense(profiles.forRows)||profiles.forRows.length!==table.rows.length||profiles.forRows.some(i=>!Number.isSafeInteger(i)||i<0||i>=profiles.rows.length))throw new Error('ENTRY_TABLE_PROFILE_INVALID');
    table.rows=table.rows.map((row,i)=>[...row,...clone(profiles.rows[profiles.forRows[i]])]);
    table.columns.push(...profiles.columns);delete table.profiles;
  }
  if(copies!==undefined){
    if(!Array.isArray(copies)||!dense(copies))throw new Error('ENTRY_TABLE_COPIES_INVALID');
    // Resolve against the original columns so chained/cyclic copies cannot pass.
    const sources=table.columns.map(columnKey),targets=new Set(sources),indices:number[]=[];
    for(const pair of copies){
      if(!Array.isArray(pair)||pair.length!==2||!dense(pair)||!pair.every(validColumn))throw new Error('ENTRY_TABLE_COPY_INVALID');
      const target=columnKey(pair[0]),source=sources.indexOf(columnKey(pair[1]));
      if(source<0||targets.has(target))throw new Error('ENTRY_TABLE_COPY_TARGET_INVALID');
      targets.add(target);indices.push(source);
    }
    table.rows=table.rows.map(row=>[...row,...indices.map(i=>clone(row[i+prefixCells]))]);
    table.columns.push(...copies.map(pair=>pair[0]));delete table.copies;
  }
  return table;
}

export type FactContextCopy=[string[],string[]];
/** Deduplicate only existing, exactly equal JSON objects/arrays; never missing values. */
export function compactFactContexts(facts:{[key:string]:JsonValue},literalPaths:readonly (readonly string[])[]=[]):FactContextCopy[]{
  const seen=new Map<string,string[]>(),copies:FactContextCopy[]=[];
  const overlaps=(a:string[],b:string[])=>a.slice(0,Math.min(a.length,b.length)).every((k,i)=>k===b[i]);
  function visit(parent:{[key:string]:JsonValue},field:string,current:string[]):void{
    // Keep important model-facing objects literal, including their ancestors.
    // Descend into ancestors, but never factor the protected object or a child.
    if(literalPaths.some(p=>p.length<=current.length&&p.every((k,i)=>k===current[i])))return;
    const protectsDescendant=literalPaths.some(p=>current.every((k,i)=>k===p[i]));
    const value=parent[field];
    if(!object(value)&&!Array.isArray(value))return;
    const signature=key(value),source=seen.get(signature);
    // A copy source must remain literal: neither an existing placeholder nor
    // an ancestor containing one. Likewise never replace a used source subtree.
    if(!protectsDescendant&&source&&signature.length>size([current,source])+8&&
      !copies.some(([target,usedSource])=>overlaps(target,source)||overlaps(usedSource,current))){
      parent[field]=null;copies.push([current,source]);return;
    }
    if(signature.length>=100)seen.set(signature,current);
    if(object(value))for(const child of Object.keys(value))visit(value,child,[...current,child]);
  }
  for(const field of Object.keys(facts))visit(facts,field,[field]);
  return copies;
}

export function expandFactContexts(facts:{[key:string]:JsonValue},copies:FactContextCopy[]):void{
  if(!Array.isArray(copies)||!dense(copies))throw new Error('ENTRY_CONTEXT_COPIES_INVALID');
  const locate=(p:string[])=>{let v:JsonValue=facts;for(const k of p){if(!object(v)||!own(v,k))throw new Error('ENTRY_CONTEXT_COPY_PATH_INVALID');v=v[k];}return v;};
  const targets:string[][]=[],staged:{target:string[];value:JsonValue}[]=[];
  const overlaps=(a:string[],b:string[])=>a.slice(0,Math.min(a.length,b.length)).every((k,i)=>k===b[i]);
  for(const pair of copies){
    if(!Array.isArray(pair)||pair.length!==2||!dense(pair)||pair.some(p=>!Array.isArray(p)||!p.length||!dense(p)||p.some(k=>typeof k!=='string')))throw new Error('ENTRY_CONTEXT_COPY_INVALID');
    const [target,source]=pair,value=locate(source);
    if(locate(target)!==null||(!object(value)&&!Array.isArray(value))||overlaps(target,source)||targets.some(p=>overlaps(p,target)))throw new Error('ENTRY_CONTEXT_COPY_TARGET_INVALID');
    targets.push(target);staged.push({target,value:clone(value)});
  }
  if(copies.some(([,source])=>targets.some(target=>overlaps(target,source))))throw new Error('ENTRY_CONTEXT_COPY_SOURCE_INVALID');
  for(const {target,value} of staged){
    const parent=target.length===1?facts:locate(target.slice(0,-1));
    if(!object(parent))throw new Error('ENTRY_CONTEXT_COPY_PATH_INVALID');
    Object.defineProperty(parent,target[target.length-1],{value,enumerable:true,configurable:true,writable:true});
  }
}
