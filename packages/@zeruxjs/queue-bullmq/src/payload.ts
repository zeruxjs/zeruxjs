/** Fixed producer bounds, shared by direct enqueue, bulk, workers and scheduler templates. */
export const QUEUE_JOB_LIMITS=Object.freeze({maxBytes:65536,maxDepth:32,maxNodes:8192,maxBulk:256,maxBulkBytes:1048576});
export function copyJobPayload(value:unknown,maxBytes:number=QUEUE_JOB_LIMITS.maxBytes,maxDepth:number=QUEUE_JOB_LIMITS.maxDepth):Record<string,unknown>{
 let nodes=0,characters=0;const seen=new Set<object>();
 const visit=(item:unknown,depth:number):unknown=>{
  if(++nodes>QUEUE_JOB_LIMITS.maxNodes||depth>maxDepth)throw new RangeError('Queue payload nesting/node limit exceeded');
  if(typeof item==='string'){characters+=item.length;if(characters>maxBytes)throw new RangeError(maxBytes===8192?'Scheduled task data exceeds 8 KiB':'Queue payload byte limit exceeded');return item;}
  if(item===null||typeof item==='boolean')return item;
  if(typeof item==='number'&&Number.isFinite(item))return item;
  if(!item||typeof item!=='object'||seen.has(item)||![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(item)))throw new TypeError('Queue payload must be plain JSON');
  const keys=Object.keys(item);if(keys.length>QUEUE_JOB_LIMITS.maxNodes||Array.isArray(item)&&(item.length>QUEUE_JOB_LIMITS.maxNodes||keys.length!==item.length||keys.some((key,index)=>key!==String(index))))throw new RangeError('Queue payload collection limit exceeded');
  seen.add(item);const result:any=Array.isArray(item)?[]:{};
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(item,key)!;if(['__proto__','constructor','prototype'].includes(key)||!('value'in descriptor))throw new TypeError('Unsafe queue payload property');characters+=key.length;if(characters>maxBytes)throw new RangeError(maxBytes===8192?'Scheduled task data exceeds 8 KiB':'Queue payload byte limit exceeded');result[key]=visit(descriptor.value,depth+1);}
  seen.delete(item);return result;
 };
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Queue payload must be an object');
 const copy=visit(value,0) as Record<string,unknown>;if(Buffer.byteLength(JSON.stringify(copy))>maxBytes)throw new RangeError(maxBytes===8192?'Scheduled task data exceeds 8 KiB':'Queue payload byte limit exceeded');return copy;
}
