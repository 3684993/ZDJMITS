/** Lossless model-input projection only; execution continues to use the original packet. */
import {compactTableValues,expandTableValues,type TableDedup} from './entryTableDedup.js';
export type EntryRecordJson = string | number | boolean | null | EntryRecordJson[] | EntryRecordObject;
export interface EntryRecordObject {[key:string]:EntryRecordJson}
export interface EntryRecordTableGroup extends TableDedup {
  common:EntryRecordObject;
  columns:(string|string[])[];
  /** The first cell is the original array index, never a rank or candidate ID. */
  rows:EntryRecordJson[][];
}
export interface EntryRecordTable {
  path:string[];
  length:number;
  groups:EntryRecordTableGroup[];
}

const TARGETS=[
  ['EXECUTION_ENVELOPE','LONG','planCandidates'],
  ['EXECUTION_ENVELOPE','SHORT','planCandidates'],
  ['EXECUTION_ENVELOPE','reachability','horizons'],
] as const;
const object=(v:unknown):v is EntryRecordObject=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(o:object,k:string|number)=>Object.prototype.hasOwnProperty.call(o,k);
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const dense=(v:unknown[])=>Array.from({length:v.length},(_,i)=>own(v,i)).every(Boolean);
const pathKey=(path:readonly string[])=>JSON.stringify(path);
const valueKey=(v:EntryRecordJson):string=>Array.isArray(v)?`[${v.map(valueKey).join(',')}]`:object(v)?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${valueKey(v[k])}`).join(',')}}`:JSON.stringify(v);
type Leaf={path:string[];value:EntryRecordJson};
function leaves(v:EntryRecordObject,path:string[]=[]):Leaf[]{
  return Object.entries(v).flatMap(([key,value])=>object(value)&&Object.keys(value).length?leaves(value,[...path,key]):[{path:[...path,key],value}]);
}
function locate(root:EntryRecordObject,path:readonly string[]):EntryRecordJson|undefined{
  let current:EntryRecordJson=root;
  for(const key of path){if(!object(current)||!own(current,key))return undefined;current=current[key];}
  return current;
}
function setPath(root:EntryRecordObject,path:readonly string[],value:EntryRecordJson):void{
  let current=root;
  for(const key of path.slice(0,-1)){
    if(!own(current,key))Object.defineProperty(current,key,{value:{},enumerable:true,writable:true,configurable:true});
    if(!object(current[key]))throw new Error('ENTRY_RECORD_TABLE_PATH_CONFLICT');
    current=current[key] as EntryRecordObject;
  }
  Object.defineProperty(current,path[path.length-1],{value:copy(value),enumerable:true,writable:true,configurable:true});
}
function validJson(value:unknown,seen=new Set<unknown>()):boolean{
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(!object(value)&&!Array.isArray(value)||seen.has(value))return false;
  seen.add(value);
  const valid=Array.isArray(value)?dense(value)&&value.every(v=>validJson(v,seen)):Object.values(value).every(v=>validJson(v,seen));
  seen.delete(value);return valid;
}

/** Mutates only profitable, nonempty object arrays at the three explicit targets to []. */
export function encodeEntryRecordTables(facts:EntryRecordObject,options:{includeCandidates?:boolean}={}):EntryRecordTable[]{
  const result:EntryRecordTable[]=[];
  for(const path of TARGETS){
    if(options.includeCandidates===false&&path[path.length-1]==='planCandidates')continue;
    const value=locate(facts,path);
    if(!Array.isArray(value)||!value.length||!dense(value)||!value.every(object)||!validJson(value))continue;
    const groups=new Map<string,{index:number;leaves:Leaf[]}[]>();
    value.forEach((record,index)=>{
      const fields=leaves(record as EntryRecordObject).sort((a,b)=>pathKey(a.path)<pathKey(b.path)?-1:pathKey(a.path)>pathKey(b.path)?1:0);
      const key=JSON.stringify(fields.map(leaf=>leaf.path)),rows=groups.get(key)??[];
      rows.push({index,leaves:fields});groups.set(key,rows);
    });
    const table:EntryRecordTable={path:[...path],length:value.length,groups:[...groups.values()].map(records=>{
      const common:EntryRecordObject={},varying:number[]=[];
      records[0].leaves.forEach((leaf,i)=>{
        if(records.length>1&&records.every(record=>valueKey(record.leaves[i].value)===valueKey(leaf.value)))setPath(common,leaf.path,leaf.value);
        else varying.push(i);
      });
      return compactTableValues({common,columns:varying.map(i=>{const p=records[0].leaves[i].path;return p.length===1?p[0]:p;}),
        rows:records.map(record=>[record.index,...varying.map(i=>copy(record.leaves[i].value))])},1);
    })};
    // Include the table wrapper, comma allowance and [] placeholder in the comparison.
    if(JSON.stringify(table).length+3>=JSON.stringify(value).length)continue;
    setPath(facts,path,[]);result.push(table);
  }
  return result;
}

/** Validates the complete projection before restoring any array; malformed data never partially writes. */
export function decodeEntryRecordTables(facts:EntryRecordObject,tables:EntryRecordTable[]):void{
  if(!object(facts)||!Array.isArray(tables)||!dense(tables))throw new Error('ENTRY_RECORD_TABLES_INVALID');
  const paths=new Set<string>(),staged:{path:string[];records:EntryRecordJson[]}[]=[];
  for(const table of tables){
    if(!object(table)||!Array.isArray(table.path)||!dense(table.path)||!table.path.every(k=>typeof k==='string')||
      !TARGETS.some(p=>pathKey(p)===pathKey(table.path))||!Number.isSafeInteger(table.length)||table.length<1||
      !Array.isArray(table.groups)||!table.groups.length||!dense(table.groups))throw new Error('ENTRY_RECORD_TABLE_INVALID');
    const targetKey=pathKey(table.path),placeholder=locate(facts,table.path);
    if(paths.has(targetKey)||!Array.isArray(placeholder)||placeholder.length!==0)throw new Error('ENTRY_RECORD_TABLE_TARGET_INVALID');
    paths.add(targetKey);
    const records:EntryRecordJson[]=[],indices=new Set<number>();
    for(const wireGroup of table.groups){
      const group=wireGroup.copies!==undefined||wireGroup.profiles!==undefined?expandTableValues(wireGroup,1):wireGroup;
      if(!object(group)||!object(group.common)||!validJson(group.common)||!Array.isArray(group.columns)||!dense(group.columns)||
        !Array.isArray(group.rows)||!group.rows.length||!dense(group.rows))throw new Error('ENTRY_RECORD_TABLE_GROUP_INVALID');
      const columns=group.columns.map(c=>typeof c==='string'?[c]:c);
      if(columns.some(p=>!Array.isArray(p)||!p.length||!dense(p)||p.some(k=>typeof k!=='string')))throw new Error('ENTRY_RECORD_TABLE_COLUMN_INVALID');
      const allPaths=[...leaves(group.common).map(leaf=>leaf.path),...columns];
      for(let i=0;i<allPaths.length;i++)for(let j=0;j<i;j++){
        const a=allPaths[i],b=allPaths[j];
        if(a.slice(0,Math.min(a.length,b.length)).every((k,n)=>k===b[n]))throw new Error('ENTRY_RECORD_TABLE_COLUMN_CONFLICT');
      }
      for(const row of group.rows){
        if(!Array.isArray(row)||!dense(row)||row.length!==columns.length+1||!validJson(row))throw new Error('ENTRY_RECORD_TABLE_ROW_INVALID');
        const index=row[0];
        if(typeof index!=='number'||!Number.isSafeInteger(index)||index<0||index>=table.length||indices.has(index))throw new Error('ENTRY_RECORD_TABLE_INDEX_INVALID');
        indices.add(index);const record=copy(group.common);
        columns.forEach((column,i)=>setPath(record,column,row[i+1]));records[index]=record;
      }
    }
    if(indices.size!==table.length)throw new Error('ENTRY_RECORD_TABLE_INDEX_GAP');
    staged.push({path:table.path,records});
  }
  for(const item of staged)setPath(facts,item.path,item.records);
}
