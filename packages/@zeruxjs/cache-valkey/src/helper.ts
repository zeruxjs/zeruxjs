import type {CacheHelper,CacheValue} from '@zeruxjs/cache';
import {cachePolicy,cacheKey,cacheBulk,cacheValue,cacheSetOptions} from '@zeruxjs/cache/policy';
import type {ValkeyClient,ValkeyHelperOptions,ValkeyOperation,ValkeyOperationRecord,ValkeyRequestOptions,ValkeySetOptions} from './types.js';
export class ValkeyCacheError extends Error {
 readonly details:{code:string;message:string;writeOutcome?:'unknown'};
 constructor(readonly code:string,cause?:unknown,write=false){super(`Valkey cache error (${code})`);this.name='ValkeyCacheError';this.details={code,message:this.message,...(write?{writeOutcome:'unknown' as const}:{})};if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}
}
export const fail=(code:string,cause?:unknown,write=false)=>new ValkeyCacheError(code,cause,write);
export function integer(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw fail('VALKEY_INVALID_LIMIT');return value;}
export function keys(value:unknown,allowed:readonly string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!allowed.includes(key))||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!('value'in d)))throw fail('VALKEY_INVALID_OPTIONS');}
export const helperKeys=['ownClient','allowFlushDb','commandTimeoutMs','shutdownTimeoutMs','maxPendingCommands','maxScanPages','valueLimits','onOperation'];
export function helperPolicy(raw:ValkeyHelperOptions={}){
 keys(raw,helperKeys);for(const flag of ['ownClient','allowFlushDb'] as const)if(raw[flag]!==undefined&&typeof raw[flag]!=='boolean')throw fail('VALKEY_INVALID_OPTIONS');if(raw.onOperation!==undefined&&typeof raw.onOperation!=='function')throw fail('VALKEY_INVALID_OPTIONS');
 if(raw.valueLimits!==undefined)keys(raw.valueLimits,['maxBulk','maxKeyBytes','maxValueBytes','maxDepth']);
 return {ownClient:raw.ownClient??false,allowFlushDb:raw.allowFlushDb??false,commandTimeoutMs:integer(raw.commandTimeoutMs??3000,1,120000),shutdownTimeoutMs:integer(raw.shutdownTimeoutMs??5000,1,120000),maxPendingCommands:integer(raw.maxPendingCommands??64,1,1024),maxScanPages:integer(raw.maxScanPages??10000,1,100000),value:cachePolicy(raw.valueLimits),onOperation:raw.onOperation};
}
export class ValkeyCacheHelper implements CacheHelper {
 readonly capabilities;readonly #policy;readonly #work=new Set<Promise<unknown>>();readonly #controllers=new Set<AbortController>();
 #closed=false;#closing?:Promise<void>;#settled?:Promise<void>;#hookPending=0;#hookDropped=0;#hookErrors=0;#backendErrors=0;
 readonly #onError=()=>{this.#backendErrors++;};
 constructor(private readonly client:ValkeyClient,options:ValkeyHelperOptions={}){
  this.#policy=helperPolicy(options);
  if(!client||['get','set','del','exists','incrby','decrby','expire','scan','flushdb','quit','disconnect','on','off'].some(key=>typeof (client as any)[key]!=='function'))throw fail('VALKEY_INVALID_CLIENT');
  const cluster=typeof client.nodes==='function',native=cluster?client.options?.redisOptions:client.options;
  if(!native||native.enableOfflineQueue!==false||native.autoResendUnfulfilledCommands!==false||native.maxRetriesPerRequest!==0||native.keyPrefix||native.reconnectOnError!=null||cluster&&(client.options?.enableOfflineQueue!==false||client.options?.maxRedirections!==0||client.options?.scaleReads!=='master'))throw fail('VALKEY_UNSAFE_CLIENT_POLICY');
  client.on('error',this.#onError);
  this.capabilities=Object.freeze({conditionalWrites:'supported' as const,counters:'supported' as const,namespaceClear:'supported' as const,bulkAtomicity:'unsupported' as const,ownership:this.#policy.ownClient?'owned' as const:'borrowed' as const});
 }
 #emit(record:ValkeyOperationRecord){const hook=this.#policy.onOperation;if(!hook)return;if(this.#hookPending>=4){this.#hookDropped++;return;}this.#hookPending++;try{void Promise.resolve(hook(Object.freeze(record))).catch(()=>{this.#hookErrors++;}).finally(()=>{this.#hookPending--;});}catch{this.#hookPending--;this.#hookErrors++;}}
 async #run<T>(operation:ValkeyOperation,execute:(check:()=>void)=>Promise<T>,options:ValkeyRequestOptions={}):Promise<T>{
  keys(options,['signal','deadline']);if(options.signal!==undefined&&!(options.signal instanceof AbortSignal)||options.deadline!==undefined&&(!Number.isSafeInteger(options.deadline)||options.deadline<0||options.deadline>Date.now()+120000))throw fail('VALKEY_INVALID_REQUEST');
  if(this.#closed)throw fail('VALKEY_CLOSED');if(this.#work.size>=this.#policy.maxPendingCommands){this.#emit({operation,durationMs:0,outcome:'overload',code:'VALKEY_OVERLOAD'});throw fail('VALKEY_OVERLOAD');}
  if(options.signal?.aborted)throw fail('VALKEY_CANCELLED');if(options.deadline!==undefined&&options.deadline<=Date.now())throw fail('VALKEY_DEADLINE');
  const write=!['get','getMany','has'].includes(operation),start=performance.now(),deadline=Math.min(Date.now()+this.#policy.commandTimeoutMs,options.deadline??Infinity),controller=new AbortController(),abort=()=>controller.abort();let expired=false,issued=false,timer:ReturnType<typeof setTimeout>|undefined;
  options.signal?.addEventListener('abort',abort,{once:true});this.#controllers.add(controller);
  const check=()=>{if(this.#closed||controller.signal.aborted||Date.now()>=deadline)throw fail(this.#closed?'VALKEY_CLOSED':expired||Date.now()>=deadline?'VALKEY_DEADLINE':'VALKEY_CANCELLED',undefined,issued&&write);};
  const work=Promise.resolve().then(()=>{check();issued=true;return execute(check);});this.#work.add(work);void work.finally(()=>{this.#work.delete(work);this.#controllers.delete(controller);}).catch(()=>{});
  let cancelled=()=>{};const stopped=new Promise<never>((_,reject)=>{cancelled=()=>reject(fail(this.#closed?'VALKEY_CLOSED':expired?'VALKEY_DEADLINE':'VALKEY_CANCELLED',undefined,issued&&write));controller.signal.addEventListener('abort',cancelled,{once:true});timer=setTimeout(()=>{expired=true;controller.abort();},Math.max(1,deadline-Date.now()));if(controller.signal.aborted)cancelled();});
  try{const value=await Promise.race([work,stopped]);check();this.#emit({operation,durationMs:performance.now()-start,outcome:'ok'});return value;}
  catch(cause){const error=cause instanceof ValkeyCacheError?cause:fail('VALKEY_BACKEND_ERROR',cause,issued&&write);this.#emit({operation,durationMs:performance.now()-start,outcome:error.code==='VALKEY_DEADLINE'?'deadline':['VALKEY_CANCELLED','VALKEY_CLOSED'].includes(error.code)?'cancelled':'error',code:error.code,...(error.details.writeOutcome?{writeOutcome:'unknown' as const}:{})});throw error;}
  finally{if(timer)clearTimeout(timer);options.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',cancelled);}
 }
 #key(value:string){try{return cacheKey(value,this.#policy.value);}catch(cause){throw fail('VALKEY_INVALID_KEY',cause);}}
 #bulk(value:string[]){try{cacheBulk(value,this.#policy.value);return value.map(key=>this.#key(key));}catch(cause){throw cause instanceof ValkeyCacheError?cause:fail('VALKEY_BULK_LIMIT',cause);}}
 #encode(value:CacheValue){try{const copy=cacheValue(value,this.#policy.value);return JSON.stringify(copy,(_key,v)=>{if(typeof v==='number'&&Number.isInteger(v)&&!Number.isSafeInteger(v))throw fail('VALKEY_NUMBER_RANGE');return v;});}catch(cause){throw cause instanceof ValkeyCacheError?cause:fail('VALKEY_INVALID_VALUE',cause);}}
 #decode(value:unknown):CacheValue|undefined{if(value===null)return;if(typeof value!=='string'||Buffer.byteLength(value)>this.#policy.value.maxValueBytes)throw fail('VALKEY_INVALID_RESULT');try{const parsed=JSON.parse(value) as CacheValue;return JSON.parse(this.#encode(parsed)) as CacheValue;}catch(cause){throw cause instanceof ValkeyCacheError?cause:fail('VALKEY_INVALID_VALUE',cause);}}
 #count(value:unknown,write=false){if(typeof value==='string'&&/^-?\d{1,20}$/.test(value))value=Number(value);if(typeof value!=='number'||!Number.isSafeInteger(value))throw fail('VALKEY_NUMBER_RANGE',undefined,write);return value;}
 #binary(value:unknown,write=false){const count=this.#count(value,write);if(count!==0&&count!==1)throw fail('VALKEY_INVALID_RESULT',undefined,write);return count===1;}
 #ttl(seconds:unknown){if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<=0||!Number.isSafeInteger(Math.ceil(seconds))||Math.ceil(seconds)>2147483647)throw fail('VALKEY_INVALID_TTL');return Math.ceil(seconds);}
 #setOptions(options:ValkeySetOptions){keys(options,['ttlSeconds','ifAbsent','ifPresent','signal','deadline']);try{cacheSetOptions(options);}catch(cause){throw fail('VALKEY_INVALID_CONDITION',cause);}return {...options};}
 #args(options:ValkeySetOptions):(string|number)[]{return [...(options.ttlSeconds===undefined?[]:['EX',this.#ttl(options.ttlSeconds)]),...(options.ifAbsent?['NX']:[]),...(options.ifPresent?['XX']:[])];}
 get(key:string,options:ValkeyRequestOptions={}){key=this.#key(key);return this.#run('get',async()=>this.#decode(await this.client.get(key)),options);}
 set(key:string,value:CacheValue,options:ValkeySetOptions={}){key=this.#key(key);options=this.#setOptions(options);const encoded=this.#encode(value),args=this.#args(options);return this.#run('set',async()=>{const result=await this.client.set(key,encoded,...args);if(result!==null&&result!=='OK')throw fail('VALKEY_INVALID_RESULT',undefined,true);},{signal:options.signal,deadline:options.deadline});}
 delete(key:string,options:ValkeyRequestOptions={}){key=this.#key(key);return this.#run('delete',async()=>this.#binary(await this.client.del(key),true),options);}
 has(key:string,options:ValkeyRequestOptions={}){key=this.#key(key);return this.#run('has',async()=>this.#binary(await this.client.exists(key)),options);}
 increment(key:string,amount=1,options:ValkeyRequestOptions={}){key=this.#key(key);integer(amount,0,Number.MAX_SAFE_INTEGER);return this.#run('increment',async()=>this.#count(await this.client.incrby(key,amount),true),options);}
 decrement(key:string,amount=1,options:ValkeyRequestOptions={}){key=this.#key(key);integer(amount,0,Number.MAX_SAFE_INTEGER);return this.#run('decrement',async()=>this.#count(await this.client.decrby(key,amount),true),options);}
 touch(key:string,seconds:number,options:ValkeyRequestOptions={}){key=this.#key(key);const ttl=this.#ttl(seconds);return this.#run('touch',async()=>this.#binary(await this.client.expire(key,ttl),true),options);}
 getMany(keys:string[],options:ValkeyRequestOptions={}){keys=this.#bulk(keys);return this.#run('getMany',async check=>{const result:Record<string,CacheValue|undefined>=Object.create(null);for(const key of keys){check();result[key]=this.#decode(await this.client.get(key));}return result;},options);}
 setMany(values:Record<string,CacheValue>,options:ValkeySetOptions={}){if(!values||typeof values!=='object'||Array.isArray(values))throw fail('VALKEY_INVALID_VALUE');const names=this.#bulk(Object.keys(values));options=this.#setOptions(options);const args=this.#args(options),encoded=names.map(key=>{const d=Object.getOwnPropertyDescriptor(values,key)!;if(!('value'in d))throw fail('VALKEY_INVALID_VALUE');return [key,this.#encode(d.value)] as const;});return this.#run('setMany',async check=>{for(const [key,value] of encoded){check();const result=await this.client.set(key,value,...args);if(result!==null&&result!=='OK')throw fail('VALKEY_INVALID_RESULT',undefined,true);}},{signal:options.signal,deadline:options.deadline});}
 deleteMany(keys:string[],options:ValkeyRequestOptions={}){keys=this.#bulk(keys);return this.#run('deleteMany',async check=>{let total=0;for(const key of keys){check();total+=this.#binary(await this.client.del(key),true)?1:0;}return total;},options);}
 clear(options:ValkeyRequestOptions={}){if(!this.#policy.allowFlushDb||typeof this.client.nodes==='function')return Promise.reject(fail('VALKEY_GLOBAL_CLEAR_DISABLED'));return this.#run('clear',async()=>{await this.client.flushdb();},options);}
 clearPrefix(prefix:string,options:ValkeyRequestOptions={}){prefix=this.#key(prefix);return this.#run('clearPrefix',async check=>{
  const nodes=typeof this.client.nodes==='function'?this.client.nodes('master'):[this.client];if(!Array.isArray(nodes)||!nodes.length||nodes.length>128)throw fail('VALKEY_INVALID_RESULT');const match=prefix.replace(/[\\*?[\]]/g,'\\$&')+':*';let pages=0;
  for(const node of [...nodes]){let cursor='0';do{check();if(++pages>this.#policy.maxScanPages)throw fail('VALKEY_SCAN_LIMIT');const result=await node.scan(cursor,'MATCH',match,'COUNT',100);if(!Array.isArray(result)||result.length!==2||typeof result[0]!=='string'||!/^\d{1,20}$/.test(result[0])||!Array.isArray(result[1])||result[1].length>10000)throw fail('VALKEY_INVALID_RESULT');cursor=result[0];for(const key of result[1]){check();this.#key(key);if(key.startsWith(prefix+':'))await this.client.del(key);}}while(cursor!=='0');}
 },options);}
 native(){if(this.#closed)throw fail('VALKEY_CLOSED');return this.client;}
 getDiagnostics(){return {closed:this.#closed,pending:this.#work.size,hookPending:this.#hookPending,hookDropped:this.#hookDropped,hookErrors:this.#hookErrors,backendErrors:this.#backendErrors};}
 close():Promise<void>{if(this.#closing)return this.#closing;this.#closed=true;for(const controller of this.#controllers)controller.abort();
  this.#settled=Promise.allSettled([...this.#work]).then(async()=>{try{if(this.#policy.ownClient)await this.client.quit();}catch(cause){try{if(this.#policy.ownClient)this.client.disconnect(false);}catch{/* Preserve original close failure privately. */}throw fail('VALKEY_CLOSE_FAILED',cause);}finally{this.client.off('error',this.#onError);}});
  this.#closing=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([this.#settled,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{try{if(this.#policy.ownClient)this.client.disconnect(false);reject(fail('VALKEY_SHUTDOWN_DEADLINE'));}catch(cause){reject(fail('VALKEY_CLOSE_FAILED',cause));}},this.#policy.shutdownTimeoutMs);})]);}catch(cause){throw cause instanceof ValkeyCacheError?cause:fail('VALKEY_CLOSE_FAILED',cause);}finally{if(timer)clearTimeout(timer);}})();return this.#closing;
 }
 /** Actual work/client cleanup barrier; borrowed uncooperative commands may keep it pending. */
 whenClosed(){if(!this.#closed)return Promise.reject(fail('VALKEY_NOT_CLOSED'));return this.#settled!;}
}
export const createValkeyCacheHelper=(client:ValkeyClient,options:ValkeyHelperOptions={})=>new ValkeyCacheHelper(client,options);
