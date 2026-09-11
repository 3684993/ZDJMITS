export type ProtocolNormalization = {
  applied:boolean;
  fields:Array<{field:string;raw:unknown;normalized:number;rule:string}>;
  repairAttempted:boolean;
};

/** Only lossless protocol representation repairs belong here.  It never invents
 * a direction, decision, ideal price, or executable range. */
export function normalizeAiProtocol(input:unknown, fields=['confidence','reachability']):{value:unknown;normalization:ProtocolNormalization}{
  const normalization:ProtocolNormalization={applied:false,fields:[],repairAttempted:false};
  if(!input||typeof input!=='object'||Array.isArray(input))return{value:input,normalization};
  const value={...(input as Record<string,unknown>)};
  for(const field of fields){
    const raw=value[field]; let normalized:number|undefined; let rule='';
    if(typeof raw==='number'&&Number.isFinite(raw)&&raw>1&&raw<=100){normalized=raw/100;rule='NUMBER_PERCENT_0_100';}
    else if(typeof raw==='string'){
      const text=raw.trim();
      if(/^\d+(?:\.\d+)?%$/.test(text)){const n=Number(text.slice(0,-1));if(Number.isFinite(n)&&n>=0&&n<=100){normalized=n/100;rule='STRING_PERCENT';}}
      else if(/^0(?:\.\d+)?$|^1(?:\.0+)?$/.test(text)){normalized=Number(text);rule='DECIMAL_STRING';}
    }
    if(normalized!==undefined){value[field]=normalized;normalization.applied=true;normalization.fields.push({field,raw,normalized,rule});}
  }
  return{value,normalization};
}
