import {encodeEntryRecordTables,decodeEntryRecordTables,type EntryRecordTable} from './entryRecordTables.js';
import {compactTableValues,expandTableValues,compactFactContexts,expandFactContexts,type TableDedup,type FactContextCopy} from './entryTableDedup.js';

type JsonPrimitive = string | number | boolean | null;
export type EntryFactJson = JsonPrimitive | EntryFactJson[] | {[key:string]:EntryFactJson};
type JsonObject = {[key:string]:EntryFactJson};
type Column = string | string[];
type Leaf = {path:string[];value:EntryFactJson};
type TechnicalRecord = {market:string;frame:string;leaves:Leaf[]};

export interface EntryFactTable extends TableDedup {
  common:JsonObject;
  columns:Column[];
  // The first two cells identify MARKET_FACTS[market].technical[frame].
  // Remaining cells correspond one-for-one to columns, without missing cells.
  rows:EntryFactJson[][];
}
export interface EntryFactAlias {
  market:string;
  frame:string;
  sourceMarket:'symbol';
  sourceFrame:string;
  factId:string;
}
export interface EncodedEntryFacts {
  encoding:'ENTRY_FACT_TABLES_V2'|'ENTRY_FACT_TABLES_V3'|'ENTRY_READABLE_FACTS_V4';
  facts:JsonObject;
  technicalTables:EntryFactTable[];
  aliases?:EntryFactAlias[];
  recordTables?:EntryRecordTable[];
  contextCopies?:FactContextCopy[];
  /** Wire metadata only; absent/non-array candidate evidence never becomes zero. */
  candidateCounts?:Partial<Record<'LONG'|'SHORT',number>>;
  /** One visible metadata object per side, never a profile or row-index lookup. */
  candidateCommon?:Partial<Record<'LONG'|'SHORT',JsonObject>>;
  candidateFields?:Record<string,string>;
  criticalTechnicalFacts?:JsonObject;
  targetTerms?:Partial<Record<'LONG'|'SHORT',Record<string,JsonObject>>>;
  /** Declares required expansion metadata; this is not an authenticity proof. */
  requiredReferences?:{candidateFields:string[];candidateCommon:Record<string,string[]>;targetTerms:Record<string,string[]>};
}

export const ENTRY_FACT_ENCODING_INSTRUCTIONS = 'INPUT_ENCODING ENTRY_FACT_TABLES_V3: lossless tables; reconstruct facts before deciding. Column strings are field names; arrays are exact nested paths. A technicalTables row [market, timeframe, ...values] maps columns to values under facts.MARKET_FACTS[market].technical[timeframe], merged with that table\'s common. recordTables restore facts[path] arrays from each group\'s common/columns and rows [originalIndex,...values]; preserve original order and length. Per table/group, profiles.columns map profiles.rows[profiles.forRows[rowIndex]] to additional fields in that row. copies pairs [targetColumn,sourceColumn] copy that row\'s exact source value, after profiles. common, profiles and copies apply only to their own table/group. aliases copy sourceMarket/sourceFrame to market/frame, replacing only factId (verified same instrument/timeframe). contextCopies [targetPath,sourcePath] copy the exact source object/array within facts into its null placeholder. []/null placeholders are restored, not missing evidence or zero candidates. An absent field remains absent, never zero or null. IDs, prices, quantities, original timestamps, horizons and units are unchanged.';


const READABLE_FRAMES=new Set(['1d','4h','15m']);
const CRITICAL_FIELDS=['factId','trend','macdHistogram','emaSlope21','asOf','isClosed','source'];
const TARGET_TERM_FIELDS=new Set(['targetPrice','acceptableTargetRange','targetHorizonMinutes','reachProbability','targetBasis','reachabilityP50MovePercent','reachabilityP75MovePercent']);
const CANDIDATE_FIELD_NAMES:Record<string,string>={id:'candidateId',qtyUnits:'quantityUnits',tpPrice:'targetPrice',tpRange:'acceptableTargetRange',tpMinutes:'targetHorizonMinutes',targetNetUsd:'targetConditionalNetProfitUsd',expectedNetUsd:'expectedNetPnlAtHorizonUsd',pReach:'reachProbability',tpBasis:'targetBasis',p50MovePct:'reachabilityP50MovePercent',p75MovePct:'reachabilityP75MovePercent'};
const CANDIDATE_COMMON_FIELDS=new Set(['side','leverage','entryReferencePrice','costVersion','reachProbabilityStatus','targetVsStatisticalCeiling']);
export const ENTRY_READABLE_FACT_ENCODING_INSTRUCTIONS = 'INPUT_ENCODING ENTRY_READABLE_FACTS_V4: LONG/SHORT.planCandidates are explicit candidate objects in original order; candidateCounts gives exact lengths. candidateFields maps each short key to its exact original name; absent keys stay absent. id is the verbatim selectedCandidateId value; qtyUnits retains original quantityUnits semantics, tpMinutes is the target horizon, never entry horizon. candidateCommon.LONG/SHORT contains identical side metadata applied once to EACH corresponding row; row overrides are forbidden. Each candidate keeps its literal id, qtyUnits, marginUsd, notionalUsd, targetNetUsd and expectedNetUsd. If targetTermsId is present, read that exact named object in targetTerms.LONG/SHORT for immutable targetPrice/range/horizon/probability/statistical facts; no row overrides, cross-side lookup or nearest match. T1/T2 are identifiers, not ranks. Return only the original candidate id, never targetTermsId as selectedCandidateId. criticalTechnicalFacts exposes exact 1d/4h/15m trend/sign-source/clocks for reading; complete facts remain in technicalTables. For technicalTables, row [market,timeframe,...values] maps columns (string=key,array=nested path) onto common. profiles.columns/rows selected by profiles.forRows and copies [targetColumn,sourceColumn] apply only to that table. recordTables restore ONLY reachability.horizons in original order using [originalIndex,...values], common/columns/profiles/copies. aliases copy a same-instrument frame, replacing only factId. contextCopies [targetPath,sourcePath] restore exact objects at null placeholders, never candidate menus. Absent stays absent; null is unknown, never zero. Values, units, hash/version and original clocks are unchanged.';


const object = (value:unknown):value is JsonObject => value!==null && typeof value==='object' && !Array.isArray(value);
const own = (value:object,key:string) => Object.prototype.hasOwnProperty.call(value,key);
const copyJson = <T>(value:T):T => JSON.parse(JSON.stringify(value));
const pathKey = (path:string[]) => JSON.stringify(path);
const instrument = (section:JsonObject):string|undefined => typeof section.symbol==='string'?section.symbol:object(section.identity)&&typeof section.identity.symbol==='string'?section.identity.symbol:undefined;

function leavesOf(value:JsonObject,prefix:string[]=[]):Leaf[] {
  return Object.entries(value).flatMap(([key,child])=>{
    const path=[...prefix,key];
    return object(child) && Object.keys(child).length ? leavesOf(child,path) : [{path,value:child}];
  });
}

// Equality is by JSON value, not object insertion order. No numeric rounding,
// truthiness defaulting, timestamp rebasing or evidence selection occurs here.
function valueKey(value:EntryFactJson):string {
  if(Array.isArray(value))return `[${value.map(valueKey).join(',')}]`;
  if(object(value))return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${valueKey(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function setPath(target:JsonObject,path:string[],value:EntryFactJson):void {
  let cursor=target;
  for(const key of path.slice(0,-1)){
    if(!own(cursor,key))Object.defineProperty(cursor,key,{value:{},enumerable:true,writable:true,configurable:true});
    if(!object(cursor[key]))throw new Error('ENTRY_FACT_TABLE_PATH_CONFLICT');
    cursor=cursor[key] as JsonObject;
  }
  Object.defineProperty(cursor,path[path.length-1],{value:copyJson(value),enumerable:true,writable:true,configurable:true});
}

/** Lossless relative to the JSON originally sent to the model, not a new fact projection. */
export function encodeEntryFacts(input:unknown):EncodedEntryFacts {
  return encodeFacts(input,false);
}

/** Readable transport for new requests; historical V2/V3 encoders remain stable. */
export function encodeReadableEntryFacts(input:unknown):EncodedEntryFacts {
  return encodeFacts(input,true);
}

function encodeFacts(input:unknown,readable:boolean):EncodedEntryFacts {
  // Normalizing BEFORE grouping preserves the old JSON semantics: undefined
  // object fields are absent, non-finite numbers are null, and array holes null.
  // In particular undefined must not turn into null by being placed in a row.
  const facts=copyJson(input);
  if(!object(facts))throw new Error('ENTRY_FACTS_OBJECT_REQUIRED');
  const criticalTechnicalFacts=readable?projectCriticalTechnicalFacts(facts):undefined;
  const candidateCommon=readable?factorCandidateMetadata(facts):{};
  const targetTerms=readable?factorCandidateTargetTerms(facts):{};
  const candidateFields=readable?renameCandidateFields(facts):{};
  const groups=new Map<string,TechnicalRecord[]>();
  const markets=facts.MARKET_FACTS;
  const aliases:EntryFactAlias[]=[];
  // Only the candidate's own instrument can duplicate a reference instrument.
  // Matching numbers on two different instruments never establish an alias.
  const candidate=object(markets)&&object(markets.symbol)?markets.symbol:undefined;
  if(candidate&&object(candidate.technical)&&instrument(candidate))for(const market of ['BTC','ETH']){
    const reference=(markets as JsonObject)[market];
    if(!object(reference)||!object(reference.technical)||instrument(reference)!==instrument(candidate))continue;
    for(const [frame,card] of Object.entries(reference.technical)){
      const source=own(candidate.technical,frame)?candidate.technical[frame]:undefined;
      if(!object(card)||!object(source)||typeof card.factId!=='string'||typeof source.factId!=='string')continue;
      const withoutId=(value:JsonObject)=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='factId'));
      if(valueKey(withoutId(card))!==valueKey(withoutId(source)))continue;
      aliases.push({market,frame,sourceMarket:'symbol',sourceFrame:frame,factId:card.factId});
      delete reference.technical[frame];
    }
  }
  if(object(markets))for(const market of ['symbol','BTC','ETH']){
    const section=markets[market];
    if(!object(section)||!object(section.technical))continue;
    for(const [frame,card] of Object.entries(section.technical)){
      if(!object(card))continue;
      const leaves=leavesOf(card).sort((a,b)=>pathKey(a.path)<pathKey(b.path)?-1:pathKey(a.path)>pathKey(b.path)?1:0);
      const key=JSON.stringify(leaves.map(leaf=>leaf.path));
      const records=groups.get(key)??[];
      records.push({market,frame,leaves});groups.set(key,records);
      delete section.technical[frame];
    }
  }
  const technicalTables:EntryFactTable[]=[];
  for(const records of groups.values()){
    const first=records[0],common:JsonObject={},varying:number[]=[];
    for(let i=0;i<first.leaves.length;i++){
      const leaf=first.leaves[i];
      // A single card gains no useful shared context; keep its cells explicit.
      if(records.length>1 && records.every(record=>valueKey(record.leaves[i].value)===valueKey(leaf.value)))setPath(common,leaf.path,leaf.value);
      else varying.push(i);
    }
    technicalTables.push(compactTableValues({common,
      columns:varying.map(i=>first.leaves[i].path.length===1?first.leaves[i].path[0]:first.leaves[i].path),
      rows:records.map(record=>[record.market,record.frame,...varying.map(i=>record.leaves[i].value)]),
    },2));
  }
  const recordTables=encodeEntryRecordTables(facts,{includeCandidates:!readable});
  const literalPaths=readable?[
    ...['LONG','SHORT'].map(side=>['EXECUTION_ENVELOPE',side,'planCandidates']),
  ]:[];
  const contextCopies=compactFactContexts(facts,literalPaths);
  const candidateCounts:Partial<Record<'LONG'|'SHORT',number>>={};
  if(readable&&object(facts.EXECUTION_ENVELOPE))for(const side of ['LONG','SHORT'] as const){
    const section=facts.EXECUTION_ENVELOPE[side];
    if(object(section)&&Array.isArray(section.planCandidates))candidateCounts[side]=section.planCandidates.length;
  }
  return {encoding:readable?'ENTRY_READABLE_FACTS_V4':'ENTRY_FACT_TABLES_V3',facts,
    ...(readable?{candidateCounts}:{}),...(Object.keys(candidateCommon).length?{candidateCommon}:{}),...(readable?{criticalTechnicalFacts}:{}),...(Object.keys(candidateFields).length?{candidateFields}:{}),...(Object.keys(targetTerms).length?{targetTerms}:{}),...(readable?{requiredReferences:{candidateFields:Object.keys(candidateFields),candidateCommon:Object.fromEntries(Object.entries(candidateCommon).map(([side,common])=>[side,Object.keys(common)])),targetTerms:Object.fromEntries(Object.entries(targetTerms).map(([side,terms])=>[side,Object.keys(terms)]))}}:{}),technicalTables,...(aliases.length?{aliases}:{}),...(recordTables.length?{recordTables}:{}),...(contextCopies.length?{contextCopies}:{})};
}

/** Audit/test decoder. Runtime freshness, decision and risk checks use the original packet. */
export function decodeEntryFacts(encoded:EncodedEntryFacts):JsonObject {
  if(!['ENTRY_FACT_TABLES_V2','ENTRY_FACT_TABLES_V3','ENTRY_READABLE_FACTS_V4'].includes(encoded.encoding)||!object(encoded.facts)||!Array.isArray(encoded.technicalTables))throw new Error('ENTRY_FACT_ENCODING_INVALID');
  if(encoded.encoding==='ENTRY_READABLE_FACTS_V4')validateReadableFacts(encoded);
  const facts=copyJson(encoded.facts),markets=facts.MARKET_FACTS;
  if(encoded.contextCopies!==undefined)expandFactContexts(facts,encoded.contextCopies);
  if(encoded.encoding==='ENTRY_READABLE_FACTS_V4'){
    if(encoded.candidateFields)restoreCandidateFieldNames(facts,encoded.candidateFields);
    if(encoded.targetTerms)restoreCandidateTargetTerms(facts,encoded.targetTerms);
    if(encoded.candidateCommon)restoreCandidateMetadata(facts,encoded.candidateCommon);
  }
  for(const wireTable of encoded.technicalTables){
    const table=wireTable.copies!==undefined||wireTable.profiles!==undefined?expandTableValues(wireTable,2):wireTable;
    if(!object(table.common)||!Array.isArray(table.columns)||!Array.isArray(table.rows))throw new Error('ENTRY_FACT_TABLE_INVALID');
    const paths=table.columns.map(column=>typeof column==='string'?[column]:column);
    if(paths.some(path=>!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string')))throw new Error('ENTRY_FACT_TABLE_COLUMN_INVALID');
    const allPaths=[...leavesOf(table.common).map(leaf=>leaf.path),...paths];
    if(new Set(allPaths.map(pathKey)).size!==allPaths.length)throw new Error('ENTRY_FACT_TABLE_COLUMN_DUPLICATE');
    for(const row of table.rows){
      if(!Array.isArray(row)||row.length!==paths.length+2||typeof row[0]!=='string'||typeof row[1]!=='string')throw new Error('ENTRY_FACT_TABLE_ROW_INVALID');
      const [market,frame]=row as [string,string,...EntryFactJson[]];
      const section=object(markets)&&own(markets,market)?markets[market]:undefined;
      if(!object(section)||!object(section.technical)||own(section.technical,frame))throw new Error('ENTRY_FACT_TABLE_TARGET_INVALID');
      const card=copyJson(table.common);
      paths.forEach((path,i)=>setPath(card,path,row[i+2]));
      Object.defineProperty(section.technical,frame,{value:card,enumerable:true,writable:true,configurable:true});
    }
  }
  if(encoded.aliases!==undefined&&!Array.isArray(encoded.aliases))throw new Error('ENTRY_FACT_ALIASES_INVALID');
  for(const alias of encoded.aliases??[]){
    if(!alias||!['BTC','ETH'].includes(alias.market)||alias.sourceMarket!=='symbol'||typeof alias.frame!=='string'||alias.frame!==alias.sourceFrame||typeof alias.factId!=='string')throw new Error('ENTRY_FACT_ALIAS_INVALID');
    const source=object(markets)&&object(markets.symbol)?markets.symbol:undefined;
    const target=object(markets)&&own(markets,alias.market)?markets[alias.market]:undefined;
    if(!source||!object(source.technical)||!own(source.technical,alias.sourceFrame)||!object(source.technical[alias.sourceFrame])||
      !object(target)||!object(target.technical)||own(target.technical,alias.frame)||!instrument(source)||instrument(source)!==instrument(target))throw new Error('ENTRY_FACT_ALIAS_TARGET_INVALID');
    const card=copyJson(source.technical[alias.sourceFrame]) as JsonObject;
    card.factId=alias.factId;
    Object.defineProperty(target.technical,alias.frame,{value:card,enumerable:true,writable:true,configurable:true});
  }
  if(encoded.recordTables!==undefined)decodeEntryRecordTables(facts,encoded.recordTables);
  if(encoded.encoding==='ENTRY_READABLE_FACTS_V4'&&valueKey(encoded.criticalTechnicalFacts??null)!==valueKey(projectCriticalTechnicalFacts(facts)))throw new Error('ENTRY_CRITICAL_FACTS_MISMATCH');
  return facts;
}


function validateReadableFacts(encoded:EncodedEntryFacts):void {
  validateRequiredReferences(encoded);
  if(!object(encoded.candidateCounts)||Object.keys(encoded.candidateCounts).some(side=>!['LONG','SHORT'].includes(side)))throw new Error('ENTRY_CANDIDATE_COUNTS_INVALID');
  const envelope=encoded.facts.EXECUTION_ENVELOPE;
  for(const side of ['LONG','SHORT'] as const){
    const section=object(envelope)?envelope[side]:undefined;
    const candidates=object(section)?section.planCandidates:undefined;
    if(Array.isArray(candidates)){
      if(encoded.candidateCounts[side]!==candidates.length||candidates.some(candidate=>!object(candidate)))throw new Error('ENTRY_CANDIDATE_COUNTS_INVALID');
    }else if(own(encoded.candidateCounts,side))throw new Error('ENTRY_CANDIDATE_COUNTS_INVALID');
  }
  const literalPaths=['LONG','SHORT'].map(side=>['EXECUTION_ENVELOPE',side,'planCandidates']);
  const overlaps=(a:readonly string[],b:readonly string[])=>a.slice(0,Math.min(a.length,b.length)).every((key,index)=>key===b[index]);
  if(encoded.recordTables?.some(table=>!Array.isArray(table.path)||table.path[table.path.length-1]==='planCandidates')||
    encoded.contextCopies?.some(copy=>!Array.isArray(copy?.[0])||literalPaths.some(path=>overlaps(path,copy[0]))))throw new Error('ENTRY_READABLE_LITERAL_REQUIRED');
}


function factorCandidateMetadata(facts:JsonObject):Partial<Record<'LONG'|'SHORT',JsonObject>> {
  const result:Partial<Record<'LONG'|'SHORT',JsonObject>>={};
  if(!object(facts.EXECUTION_ENVELOPE))return result;
  for(const side of ['LONG','SHORT'] as const){
    const section=facts.EXECUTION_ENVELOPE[side];
    if(!object(section)||!Array.isArray(section.planCandidates)||section.planCandidates.length<2||!section.planCandidates.every(object))continue;
    const rows=section.planCandidates as JsonObject[],common:JsonObject={};
    for(const key of CANDIDATE_COMMON_FIELDS){
      if(own(rows[0],key)&&rows.every(row=>own(row,key)&&valueKey(row[key])===valueKey(rows[0][key])))common[key]=copyJson(rows[0][key]);
    }
    if(!Object.keys(common).length)continue;
    const compact=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!own(common,key))));
    if(JSON.stringify(compact).length+JSON.stringify(common).length+32>=JSON.stringify(rows).length)continue;
    result[side]=common;section.planCandidates=compact;
  }
  return result;
}

function restoreCandidateMetadata(facts:JsonObject,commonBySide:Partial<Record<'LONG'|'SHORT',JsonObject>>):void {
  if(!object(commonBySide)||Object.keys(commonBySide).some(side=>!['LONG','SHORT'].includes(side)))throw new Error('ENTRY_CANDIDATE_COMMON_INVALID');
  const staged:{rows:JsonObject[];common:JsonObject}[]=[];
  for(const [side,common] of Object.entries(commonBySide)){
    if(!object(common)||!Object.keys(common).length||Object.keys(common).some(key=>!CANDIDATE_COMMON_FIELDS.has(key)))throw new Error('ENTRY_CANDIDATE_COMMON_INVALID');
    const section=object(facts.EXECUTION_ENVELOPE)?facts.EXECUTION_ENVELOPE[side]:undefined;
    if(!object(section)||!Array.isArray(section.planCandidates)||!section.planCandidates.length||!section.planCandidates.every(object))throw new Error('ENTRY_CANDIDATE_COMMON_INVALID');
    const rows=section.planCandidates as JsonObject[];
    if(rows.some(row=>Object.keys(common).some(key=>own(row,key))))throw new Error('ENTRY_CANDIDATE_COMMON_OVERRIDE');
    staged.push({rows,common});
  }
  for(const {rows,common} of staged)for(const row of rows)for(const [key,value] of Object.entries(common))Object.defineProperty(row,key,{value:copyJson(value),enumerable:true,writable:true,configurable:true});
}


function projectCriticalTechnicalFacts(facts:JsonObject):JsonObject {
  const technical=object(facts.MARKET_FACTS)&&object(facts.MARKET_FACTS.symbol)?facts.MARKET_FACTS.symbol.technical:undefined;
  if(!object(technical))return {};
  return Object.fromEntries([...READABLE_FRAMES].filter(frame=>object(technical[frame])).map(frame=>[frame,Object.fromEntries(CRITICAL_FIELDS.filter(field=>own(technical[frame] as JsonObject,field)).map(field=>[field,copyJson((technical[frame] as JsonObject)[field])]))]));
}
function candidateRows(facts:JsonObject):JsonObject[] {
  if(!object(facts.EXECUTION_ENVELOPE))return [];
  return ['LONG','SHORT'].flatMap(side=>{
    const section=(facts.EXECUTION_ENVELOPE as JsonObject)[side];
    return object(section)&&Array.isArray(section.planCandidates)?section.planCandidates.filter(object):[];
  });
}
function renameCandidateFields(facts:JsonObject):Record<string,string> {
  const rows=candidateRows(facts),mapping:Record<string,string>={};
  for(const [short,original] of Object.entries(CANDIDATE_FIELD_NAMES)){
    // Unknown future fields may already use a proposed short name. Keep that
    // field family literal rather than colliding or silently overwriting it.
    if(rows.some(row=>own(row,short))||!rows.some(row=>own(row,original)))continue;
    mapping[short]=original;
    for(const row of rows)if(own(row,original)){Object.defineProperty(row,short,{value:row[original],enumerable:true,writable:true,configurable:true});delete row[original];}
  }
  return mapping;
}
function restoreCandidateFieldNames(facts:JsonObject,mapping:Record<string,string>):void {
  if(!object(mapping)||Object.entries(mapping).some(([short,original])=>CANDIDATE_FIELD_NAMES[short]!==original))throw new Error('ENTRY_CANDIDATE_FIELDS_INVALID');
  const rows=candidateRows(facts);
  for(const [short,original] of Object.entries(mapping))for(const row of rows){
    if(own(row,original))throw new Error('ENTRY_CANDIDATE_FIELD_CONFLICT');
    if(own(row,short)){Object.defineProperty(row,original,{value:row[short],enumerable:true,writable:true,configurable:true});delete row[short];}
  }
}


/** One named immutable target object, with no size tier or table-profile chain. */
function factorCandidateTargetTerms(facts:JsonObject):Partial<Record<'LONG'|'SHORT',Record<string,JsonObject>>> {
  const result:Partial<Record<'LONG'|'SHORT',Record<string,JsonObject>>>={};
  if(!object(facts.EXECUTION_ENVELOPE))return result;
  for(const side of ['LONG','SHORT'] as const){
    const section=facts.EXECUTION_ENVELOPE[side];
    if(!object(section)||!Array.isArray(section.planCandidates)||section.planCandidates.length<2||!section.planCandidates.every(object))continue;
    const rows=section.planCandidates as JsonObject[];
    if(rows.some(row=>own(row,'targetTermsId')))continue;
    const terms:Record<string,JsonObject>={},byValue=new Map<string,string>();
    const compact=rows.map(row=>{
      const target=Object.fromEntries(Object.entries(row).filter(([key])=>TARGET_TERM_FIELDS.has(key)));
      if(!Object.keys(target).length)return row;
      const signature=valueKey(target);let id=byValue.get(signature);
      if(!id){id=`T${byValue.size+1}`;byValue.set(signature,id);terms[id]=target;}
      return {...Object.fromEntries(Object.entries(row).filter(([key])=>!TARGET_TERM_FIELDS.has(key))),targetTermsId:id};
    });
    // Factor the side atomically. Empty/future records stay literal, with no
    // synthesized target values; names/order are merely exact transport IDs.
    if(compact.some(row=>!own(row,'targetTermsId'))||byValue.size===rows.length||
      JSON.stringify(compact).length+JSON.stringify(terms).length+32>=JSON.stringify(rows).length)continue;
    result[side]=terms;section.planCandidates=compact;
  }
  return result;
}
function restoreCandidateTargetTerms(facts:JsonObject,bySide:Partial<Record<'LONG'|'SHORT',Record<string,JsonObject>>>):void {
  if(!object(bySide)||Object.keys(bySide).some(side=>!['LONG','SHORT'].includes(side)))throw new Error('ENTRY_TARGET_TERMS_INVALID');
  const staged:{row:JsonObject;target:JsonObject}[]=[];
  for(const [side,terms] of Object.entries(bySide)){
    if(!object(terms)||!Object.keys(terms).length||Object.entries(terms).some(([id,target])=>!/^T[1-9][0-9]*$/.test(id)||!object(target)||!Object.keys(target).length||Object.keys(target).some(key=>!TARGET_TERM_FIELDS.has(key))))throw new Error('ENTRY_TARGET_TERMS_INVALID');
    const section=object(facts.EXECUTION_ENVELOPE)?facts.EXECUTION_ENVELOPE[side]:undefined;
    if(!object(section)||!Array.isArray(section.planCandidates)||!section.planCandidates.length||!section.planCandidates.every(object))throw new Error('ENTRY_TARGET_TERMS_INVALID');
    const used=new Set<string>();
    for(const row of section.planCandidates as JsonObject[]){
      const id=row.targetTermsId;
      if(typeof id!=='string'||!own(terms,id))throw new Error('ENTRY_TARGET_TERMS_REFERENCE_INVALID');
      const target=terms[id] as JsonObject;
      if(Object.keys(target).some(key=>own(row,key)))throw new Error('ENTRY_TARGET_TERMS_OVERRIDE');
      used.add(id);staged.push({row,target});
    }
    if(used.size!==Object.keys(terms).length)throw new Error('ENTRY_TARGET_TERMS_UNUSED');
  }
  for(const {row,target} of staged){for(const [key,value] of Object.entries(target))Object.defineProperty(row,key,{value:copyJson(value),enumerable:true,writable:true,configurable:true});delete row.targetTermsId;}
}


/** Detects missing declared maps/side maps/keys before any expansion, including
 * the manifest itself. It cannot authenticate arbitrarily rewritten evidence. */
function validateRequiredReferences(encoded:EncodedEntryFacts):void {
  const manifest=encoded.requiredReferences;
  const keys=(value:unknown):string[]=>{
    if(value===undefined)return [];
    if(!object(value))throw new Error('ENTRY_REQUIRED_REFERENCES_INVALID');
    return Object.keys(value);
  };
  const verify=(declared:unknown,actual:string[]):void=>{
    if(!Array.isArray(declared)||declared.some(key=>typeof key!=='string')||new Set(declared).size!==declared.length)throw new Error('ENTRY_REQUIRED_REFERENCES_INVALID');
    if(JSON.stringify([...declared].sort())!==JSON.stringify([...actual].sort()))throw new Error('ENTRY_REQUIRED_REFERENCES_MISMATCH');
  };
  if(!object(manifest)||Object.keys(manifest).sort().join(',')!=='candidateCommon,candidateFields,targetTerms')throw new Error('ENTRY_REQUIRED_REFERENCES_INVALID');
  verify(manifest.candidateFields,keys(encoded.candidateFields));
  for(const field of ['candidateCommon','targetTerms'] as const){
    if(!object(manifest[field]))throw new Error('ENTRY_REQUIRED_REFERENCES_INVALID');
    verify(Object.keys(manifest[field]),keys(encoded[field]));
    for(const [side,declared] of Object.entries(manifest[field]))verify(declared,keys(encoded[field]?.[side as 'LONG'|'SHORT']));
  }
}
