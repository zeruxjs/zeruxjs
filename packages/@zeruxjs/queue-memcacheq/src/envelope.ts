export class MemcacheQError extends Error {
 constructor(readonly code:string,cause?:unknown){super(`MemcacheQ error (${code})`);this.name='MemcacheQError';if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}
}
export const invalid=(code:string,cause?:unknown)=>new MemcacheQError(code,cause);
export function optionKeys(value:unknown,allowed:readonly string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!allowed.includes(key))||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!('value'in d)))throw invalid('MEMCACHEQ_INVALID_OPTIONS');}
export function integer(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw invalid('MEMCACHEQ_INVALID_OPTIONS');return value;}
export function copyData(value:unknown,max:number):Record<string,unknown>{
 let count=0,characters=0;const seen=new Set<object>();
 function visit(item:unknown,depth:number):any{
  if(++count>8192||depth>16)throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');
  if(typeof item==='string'){characters+=item.length;if(characters>max)throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');return item;}
  if(item===null||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
  if(!item||typeof item!=='object'||seen.has(item)||![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(item)))throw invalid('MEMCACHEQ_INVALID_PAYLOAD');
  const keys=Object.keys(item);if(keys.length>8192||Array.isArray(item)&&(item.length>8192||keys.length!==item.length||keys.some((key,i)=>key!==String(i))))throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');
  seen.add(item);const out:any=Array.isArray(item)?[]:{};
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(item,key)!;if(['__proto__','prototype','constructor'].includes(key)||!('value'in d))throw invalid('MEMCACHEQ_INVALID_PAYLOAD');characters+=key.length;if(characters>max)throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');out[key]=visit(d.value,depth+1);}seen.delete(item);return out;
 }
 if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('MEMCACHEQ_INVALID_PAYLOAD');const out=visit(value,0);if(Buffer.byteLength(JSON.stringify(out))>max)throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');return out;
}
