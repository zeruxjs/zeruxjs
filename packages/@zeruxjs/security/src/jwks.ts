import {JwtVerificationError,validateJwtKey,type JwtKeySource,type JwtVerificationKey,type JwtRequest} from './jwt.js';
export interface JwtJwksOptions {url:string;allowedUrls:readonly string[];transport:(url:string,init:RequestInit)=>Promise<Response>;timeoutMs?:number;cacheMs?:number;cooldownMs?:number;maxBytes?:number;maxPending?:number}
/** One configured HTTPS JWKS endpoint. Transport/egress authorization belongs to the host. */
export function createJwtJwks(options:JwtJwksOptions):JwtKeySource&{getDiagnostics():{closed:boolean;cachedKeys:number;pending:boolean};close():Promise<void>}{
 const unavailable=(cause?:unknown)=>new JwtVerificationError('JWT_UNAVAILABLE',cause===undefined?undefined:{cause});
 const url=(value:unknown)=>{if(typeof value!=='string'||value.length>2048)throw new TypeError('Invalid JWKS destination');let parsed:URL;try{parsed=new URL(value);}catch{throw new TypeError('Invalid JWKS destination');}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||parsed.search)throw new TypeError('Invalid JWKS destination');return parsed.href;};
 if(!options||typeof options!=='object'||!Array.isArray(options.allowedUrls)||options.allowedUrls.length<1||options.allowedUrls.length>8||typeof options.transport!=='function')throw new TypeError('Invalid JWKS options');
 const target=url(options.url),allowed=options.allowedUrls.map(url);if(!allowed.includes(target))throw new TypeError('JWKS destination denied');
 const n=(value:unknown,fallback:number,max:number,min=1)=>{const result=value===undefined?fallback:value;if(typeof result!=='number'||!Number.isSafeInteger(result)||result<min||result>max)throw new TypeError('Invalid JWKS limit');return result;};
 const cap=n(options.maxPending,32,256);
 const timeout=n(options.timeoutMs,1000,10000),ttl=n(options.cacheMs,60000,600000),cooldown=n(options.cooldownMs,1000,60000),maxBytes=n(options.maxBytes,65536,262144),transport=options.transport;
 let waiters=0;
 let closed=false,cache:JwtVerificationKey[]=[],expires=0,nextRefresh=0,pending:Promise<void>|undefined,controller:AbortController|undefined,closing:Promise<void>|undefined;
 function refresh():Promise<void>{
  if(pending)return pending;if(Date.now()<nextRefresh)return Promise.reject(unavailable());nextRefresh=Date.now()+cooldown;const active=new AbortController();controller=active;
  const work=Promise.resolve().then(async()=>{let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined;let success=false;const cancelReader=()=>{void reader?.cancel().catch(()=>{});};active.signal.addEventListener('abort',cancelReader,{once:true});const timer=setTimeout(()=>active.abort(),timeout);
   try{response=await transport(target,{signal:active.signal,redirect:'error',credentials:'omit',headers:{accept:'application/jwk-set+json, application/json'}});if(closed||active.signal.aborted||response.status!==200||response.redirected||response.url&&response.url!==target||!/^application\/(?:json|jwk-set\+json)(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw unavailable();
    const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw unavailable();if(!response.body)throw unavailable();reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
    while(true){if(closed||active.signal.aborted)throw unavailable();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw unavailable();chunks.push(part.value);}
    if(closed||active.signal.aborted)throw unavailable();const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size))) as {keys?:unknown};if(!body||!Array.isArray(body.keys)||body.keys.length<1||body.keys.length>16)throw unavailable();
    const keys=body.keys.map(key=>validateJwtKey(key,true));if(new Set(keys.map(k=>k.kid)).size!==keys.length)throw unavailable();cache=keys;expires=Date.now()+ttl;success=true;
   }catch(cause){throw unavailable(cause);}finally{clearTimeout(timer);active.signal.removeEventListener('abort',cancelReader);if(!success){active.abort();try{if(reader)await reader.cancel();else await response?.body?.cancel();}catch{/* Preserve the primary private failure. */}}reader?.releaseLock();}
  });pending=work;void work.finally(()=>{if(pending===work){pending=undefined;controller=undefined;}}).catch(()=>{});return work;
 }
 return {
  async getKeys(kid:string,request:JwtRequest={}){
   if(closed)throw new JwtVerificationError('JWT_CLOSED');if(typeof kid!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(kid)||!request||typeof request!=='object'||request.signal!==undefined&&!(request.signal instanceof AbortSignal)||request.deadline!==undefined&&(!Number.isSafeInteger(request.deadline)||request.deadline<0))throw unavailable();
   request={signal:request.signal,deadline:request.deadline};
   if(request.signal?.aborted||request.deadline!==undefined&&request.deadline<=Date.now())throw unavailable();
   if(Date.now()<expires&&cache.some(key=>key.kid===kid))return cache.map(key=>validateJwtKey(key,true));
   if(waiters>=cap)throw unavailable();waiters++;
   const work=refresh();let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
   try{await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());request.signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,Math.max(1,Math.min(timeout,(request.deadline??Infinity)-Date.now())));if(request.signal?.aborted)abort();})]);if(closed||Date.now()>=expires||!cache.some(key=>key.kid===kid))throw unavailable();return cache.map(key=>validateJwtKey(key,true));}
   finally{waiters--;if(timer)clearTimeout(timer);request.signal?.removeEventListener('abort',abort);}
  },
  getDiagnostics(){return {closed,cachedKeys:cache.length,pending:Boolean(pending)};},
  close(){closed=true;controller?.abort();cache=[];return closing??=Promise.resolve().then(async()=>{try{await pending;}catch{/* A failing fetch has already rejected its callers. */}cache=[];});}
 };
}
