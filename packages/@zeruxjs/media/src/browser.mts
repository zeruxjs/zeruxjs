/** Browser-only ESM entry. No Node imports, globals, storage or network work on import. */
export interface TransferProgress {loaded:number;total?:number}
export interface BrowserMediaOptions {
 baseUrl:string;fetch?:typeof fetch;allowedOrigins?:readonly string[];
 objectUrls?:{createObjectURL(blob:Blob):string;revokeObjectURL(url:string):void};
 maxPending?:number;
}
export interface TransferOptions {signal?:AbortSignal;onProgress?:(progress:TransferProgress)=>void}
export class MediaTransferError extends Error {constructor(readonly code:string,readonly committed?:boolean|'unknown'){super(code.toLowerCase().replaceAll('_',' '));this.name='MediaTransferError';}}
const fail=(code:string)=>new MediaTransferError(code);
const hashPattern=/^[a-f0-9]{64}$/;
const idPattern=/^[a-f0-9]{48}$/;
function limit(value:number,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(value)||value<0||value>max)throw fail('TRANSFER_LIMIT');return value;}
async function sha256(bytes:ArrayBuffer){if(!globalThis.crypto?.subtle)throw fail('HASH_UNAVAILABLE');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');}
interface Session {protocol:'zerux-media-resumable-v1';id:string;status:string;size:number;sha256:string;expiresAt:number;partBytes:number;parts:{number:number;size:number;sha256:string}[]}
function session(value:unknown):Session{
 const s=value as Session;if(!s||s.protocol!=='zerux-media-resumable-v1'||!idPattern.test(s.id)||!['open','initiating','finalizing','complete','aborted'].includes(s.status)||!hashPattern.test(s.sha256)||!Array.isArray(s.parts)||s.parts.length>1000)throw fail('INVALID_PROTOCOL');
 limit(s.size);limit(s.expiresAt);limit(s.partBytes,64*1024*1024);if(!s.partBytes||!s.size)throw fail('INVALID_PROTOCOL');
 const seen=new Set<number>();for(const part of s.parts){limit(part.number,1000);limit(part.size,s.partBytes);if(!part.number||!part.size||!hashPattern.test(part.sha256)||seen.has(part.number))throw fail('INVALID_PROTOCOL');seen.add(part.number);}return s;
}
export function createMediaTransfers(options:BrowserMediaOptions){
 if(!options||typeof options.baseUrl!=='string')throw fail('INVALID_DESTINATION');
 let base:URL;try{base=new URL(options.baseUrl,globalThis.location?.href);}catch{throw fail('INVALID_DESTINATION');}
 // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
 if(!['https:','http:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||/[\x00-\x20\x7f\\]/.test(options.baseUrl))throw fail('INVALID_DESTINATION');
 const origins=options.allowedOrigins??(globalThis.location?[location.origin]:[]);
 if(!Array.isArray(origins)||origins.length>32||origins.some(origin=>{try{return new URL(origin).origin!==origin;}catch{return true;}})||!origins.includes(base.origin))throw fail('DESTINATION_DENIED');
 base.pathname=base.pathname.replace(/\/?$/,'/');const fetcher=options.fetch??globalThis.fetch;
 if(typeof fetcher!=='function')throw fail('FETCH_UNAVAILABLE');const maxPending=options.maxPending??4;limit(maxPending,64);if(!maxPending)throw fail('TRANSFER_LIMIT');
 let closed=false,closing:Promise<void>|undefined;const active=new Set<AbortController>(),urls=new Set<string>(),settlements=new Map<AbortController,Promise<void>>();const objectUrls=options.objectUrls??globalThis.URL;
 // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
 function destination(path:string){if(typeof path!=='string'||path.length>2048||path.startsWith('/')||/[\x00-\x20\x7f\\]/.test(path))throw fail('INVALID_DESTINATION');let url:URL;try{url=new URL(path,base);}catch{throw fail('INVALID_DESTINATION');}if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||url.username||url.password||url.hash)throw fail('DESTINATION_DENIED');return url.href;}
 async function owned<T>(signal:AbortSignal|undefined,fn:(signal:AbortSignal)=>Promise<T>){
  if(closed)throw fail('TRANSFER_CLOSED');if(active.size>=maxPending)throw fail('TRANSFER_BUSY');const controller=new AbortController();active.add(controller);let finish!:()=>void;settlements.set(controller,new Promise<void>(resolve=>{finish=resolve;}));const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{if(controller.signal.aborted)throw fail('TRANSFER_CANCELLED');return await fn(controller.signal);}finally{signal?.removeEventListener('abort',abort);active.delete(controller);settlements.delete(controller);finish();}
 }
 async function fetchResponse(path:string,init:RequestInit){const response=await fetcher(destination(path),{...init,redirect:'error',credentials:'same-origin'});if(!response.ok){await response.body?.cancel().catch(()=>{});throw fail('HTTP_FAILED');}return response;}
 async function json(path:string,init:RequestInit):Promise<any>{
  const response=await fetcher(destination(path),{...init,redirect:'error',credentials:'same-origin'});const reader=response.body?.getReader();if(!reader)throw fail('INVALID_PROTOCOL');
  let bytes=0,count=0;const parts:Uint8Array[]=[];const cancel=()=>{void reader.cancel().catch(()=>{});};init.signal?.addEventListener('abort',cancel,{once:true});if(init.signal?.aborted)cancel();
  try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>256*1024||++count>4096)throw fail('INVALID_PROTOCOL');parts.push(next.value);}
   if(init.signal?.aborted)throw fail('TRANSFER_CANCELLED');const data=new Uint8Array(bytes);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
   if(!response.ok)throw new MediaTransferError(typeof value?.code==='string'&&/^[A-Z_]{1,64}$/.test(value.code)?value.code:'HTTP_FAILED',value?.committed===true?true:value?.committed==='unknown'?'unknown':undefined);return value;
  }finally{init.signal?.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 async function stream(path:string,sink:WritableStream<Uint8Array>,input:TransferOptions&{maxBytes?:number},signal:AbortSignal){
  const max=limit(input.maxBytes??1024*1024*1024);const response=await fetchResponse(path,{signal});
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,writer:WritableStreamDefaultWriter<Uint8Array>|undefined,cancelled=false;
  const cancel=()=>{if(cancelled)return;cancelled=true;void reader?.cancel().catch(()=>{});void writer?.abort(fail('TRANSFER_CANCELLED')).catch(()=>{});};
  try{
   const encoding=response.headers.get('content-encoding');if(encoding&&encoding!=='identity')throw fail('ENCODED_TRANSFER_UNSUPPORTED');
   const raw=response.headers.get('content-length');if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))throw fail('TRANSFER_LENGTH');const total=raw===null?undefined:Number(raw);if(total!==undefined&&total>max)throw fail('TRANSFER_LIMIT');
   if(!response.body)throw fail('BODY_UNAVAILABLE');reader=response.body.getReader();writer=sink.getWriter();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
   let loaded=0,count=0;while(true){if(signal.aborted)throw fail('TRANSFER_CANCELLED');const next=await reader.read();if(next.done)break;if(!(next.value instanceof Uint8Array))throw fail('INVALID_BYTES');loaded+=next.value.byteLength;if(loaded>max||++count>65536)throw fail('TRANSFER_LIMIT');if(total!==undefined&&loaded>total)throw fail('TRANSFER_LENGTH');await writer.write(next.value);input.onProgress?.({loaded,...(total!==undefined?{total}:{})});}
   if(signal.aborted)throw fail('TRANSFER_CANCELLED');if(total!==undefined&&loaded!==total)throw fail('TRANSFER_LENGTH');await writer.close();return {loaded,...(total!==undefined?{total}:{})};
  }catch(error){await writer?.abort(error).catch(()=>{});throw error;}
  finally{signal.removeEventListener('abort',cancel);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}else await response.body?.cancel().catch(()=>{});writer?.releaseLock();}
 }
 return {
  downloadTo(path:string,sink:WritableStream<Uint8Array>,input:TransferOptions&{maxBytes?:number}={}){return owned(input.signal,signal=>stream(path,sink,input,signal));},
  downloadBlob(path:string,input:TransferOptions&{maxBytes:number;sha256?:string}){return owned(input?.signal,async signal=>{
   if(!input||!Number.isSafeInteger(input.maxBytes)||input.maxBytes<1||input.maxBytes>64*1024*1024||input.sha256!==undefined&&!hashPattern.test(input.sha256))throw fail('TRANSFER_LIMIT');
   const parts:Uint8Array<ArrayBuffer>[]=[];await stream(path,new WritableStream({write(chunk){parts.push(new Uint8Array(chunk));}}),input,signal);
   const blob=new Blob(parts);if(input.sha256!==undefined&&await sha256(await blob.arrayBuffer())!==input.sha256)throw fail('TRANSFER_INTEGRITY');if(signal.aborted)throw fail('TRANSFER_CANCELLED');return blob;
  });},
  objectUrl(blob:Blob){
   if(closed)throw fail('TRANSFER_CLOSED');if(!(blob instanceof Blob)||urls.size>=32||typeof objectUrls?.createObjectURL!=='function'||typeof objectUrls.revokeObjectURL!=='function')throw fail('OBJECT_URL_UNAVAILABLE');
   const url=objectUrls.createObjectURL(blob);urls.add(url);let revoked=false;return {url,revoke(){if(revoked)return;revoked=true;if(urls.delete(url))objectUrls.revokeObjectURL(url);}};
  },
  downloadAttachment(path:string,name:string,document:Document=globalThis.document){
   // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
   if(closed)throw fail('TRANSFER_CLOSED');if(!document?.createElement||typeof name!=='string'||!name||name.length>180||/[\\/\x00-\x1f\x7f]/.test(name))throw fail('ATTACHMENT_UNAVAILABLE');
   const anchor=document.createElement('a');anchor.href=destination(path);anchor.download=name;anchor.rel='noopener';document.body.append(anchor);try{anchor.click();}finally{anchor.remove();}
  },
  upload(path:string,source:Blob|ReadableStream<Uint8Array>,input:TransferOptions&{size:number;contentType:string;method?:'POST'|'PUT'}){return owned(input?.signal,async signal=>{
   if(!input||!Number.isSafeInteger(input.size)||input.size<0||! /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(input.contentType)||input.method!==undefined&&!['POST','PUT'].includes(input.method))throw fail('INVALID_UPLOAD');
   let duplexAccessed=false;try{const probe=new Request(destination(path),{method:'POST',body:new ReadableStream(),get duplex(){duplexAccessed=true;return 'half';}} as RequestInit);if(!duplexAccessed||probe.headers.has('content-type'))throw fail('STREAM_UPLOAD_UNAVAILABLE');}catch{throw fail('STREAM_UPLOAD_UNAVAILABLE');}
   const reader=(source instanceof Blob?source.stream():source).getReader();let loaded=0,count=0;
   const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
   const body=new ReadableStream<Uint8Array>({async pull(controller){try{if(signal.aborted)throw fail('TRANSFER_CANCELLED');const next=await reader.read();if(next.done){if(loaded!==input.size)throw fail('TRANSFER_LENGTH');controller.close();return;}if(!(next.value instanceof Uint8Array))throw fail('INVALID_BYTES');loaded+=next.value.byteLength;if(loaded>input.size||++count>65536)throw fail('TRANSFER_LENGTH');input.onProgress?.({loaded,total:input.size});controller.enqueue(next.value);}catch(error){controller.error(error);}},async cancel(){await reader.cancel();}});
   try{const response=await fetchResponse(path,{method:input.method??'PUT',headers:{'Content-Type':input.contentType},body,signal,duplex:'half'} as RequestInit);if(loaded!==input.size)throw fail('TRANSFER_LENGTH');return response;}
   finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
  });},
  /** Files-owned protocol sessions persist independently of any individual browser request signal. */
  getSession(path:string,id:string,signal?:AbortSignal){return owned(signal,async signal=>{if(!idPattern.test(id))throw fail('INVALID_PROTOCOL');return session(await json(path+'/'+id,{signal}));});},
  initiateSession(path:string,input:{name:string;size:number;sha256:string;contentType:string},signal?:AbortSignal){return owned(signal,async signal=>session(await json(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal})));},
  uploadSession(path:string,id:string,file:Blob,input:TransferOptions&{sha256:string}){return owned(input?.signal,async signal=>{
   if(!idPattern.test(id)||!(file instanceof Blob)||!hashPattern.test(input.sha256))throw fail('INVALID_PROTOCOL');const current=session(await json(path+'/'+id,{signal}));
   if(current.status!=='open'||current.size!==file.size||current.sha256!==input.sha256||current.expiresAt<=Date.now())throw fail('SESSION_MISMATCH');
   const total=Math.ceil(file.size/current.partBytes);if(total>1000)throw fail('TRANSFER_LIMIT');let loaded=0;
   for(let number=1;number<=total;number++){
    if(signal.aborted)throw fail('TRANSFER_CANCELLED');const part=file.slice((number-1)*current.partBytes,number*current.partBytes),hash=await sha256(await part.arrayBuffer()),existing=current.parts.find(p=>p.number===number);
    if(existing){if(existing.size!==part.size||existing.sha256!==hash)throw fail('SESSION_MISMATCH');}
    else{const receipt=await json(path+'/'+id+'/parts/'+number,{method:'PUT',headers:{'Content-Type':'application/octet-stream','X-Media-Part-Size':String(part.size),'X-Media-Part-SHA256':hash},body:part,signal});if(receipt.number!==number||receipt.size!==part.size||receipt.sha256!==hash)throw fail('INVALID_PROTOCOL');}
    loaded+=part.size;input.onProgress?.({loaded,total:file.size});
   }return {id,parts:Array.from({length:total},(_,i)=>i+1)};
  });},
  finalizeSession(path:string,id:string,parts:readonly number[],signal?:AbortSignal){return owned(signal,async signal=>{if(!idPattern.test(id)||!Array.isArray(parts)||!parts.length||parts.length>1000||parts.some((v,i)=>v!==i+1))throw fail('INVALID_PROTOCOL');const value=await json(path+'/'+id+'/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parts}),signal});if(!value||value.protocol!=='zerux-media-resumable-v1'||value.id!==id||value.status!=='complete'||!hashPattern.test(value.sha256)||!Number.isSafeInteger(value.size)||value.size<1)throw new MediaTransferError('INVALID_PROTOCOL','unknown');return value;});},
  abortSession(path:string,id:string,signal?:AbortSignal){return owned(signal,async signal=>{if(!idPattern.test(id))throw fail('INVALID_PROTOCOL');return json(path+'/'+id,{method:'DELETE',signal});});},
  close(){if(closing)return closing;closed=true;for(const controller of active)controller.abort();for(const url of urls)objectUrls.revokeObjectURL(url);urls.clear();return closing=Promise.allSettled([...settlements.values()]).then(()=>{});}
 };
}
