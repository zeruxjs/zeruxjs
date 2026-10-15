import type { FileAddress, FileInfo, PutFileOptions, StorageManager } from './types.js';
import { validateAddress } from './validation.js';
export interface FileHttpOptions {
  /** Called before each access, including public files. Required to access private files. */
  authorize?: (request:Request,address:FileAddress,operation:'read'|'write'|'delete',info?:FileInfo) => boolean|Promise<boolean>;
  /** Explicit storage and bucket mapping; never accept arbitrary locations from a URL. */
  storage?: string; bucket:string; prefix?:string;
  maxUploadBytes?:number; cacheControl?:string; allowDelete?:boolean;
}
function filename(value:string){const safe=value.replace(/[\x00-\x1f\x7f"\\/]/g,'_').slice(0,180)||'file';return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;}
function rangeFrom(header:string,size:number):{start:number,end:number}|null{
  const found=/^bytes=(\d*)-(\d*)$/.exec(header.trim());if(!found||(!found[1]&&!found[2])||size===0)return null;
  const start=found[1]?Number(found[1]):Math.max(0,size-Number(found[2]));const end=found[1]?(found[2]?Number(found[2]):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;
  return {start,end:Math.min(end,size-1)};
}
function iterableBody(iterator:AsyncIterable<Uint8Array>):ReadableStream<Uint8Array>{
  const reader=iterator[Symbol.asyncIterator]();return new ReadableStream({async pull(c){try{const next=await reader.next();if(next.done)c.close();else c.enqueue(next.value);}catch(err){c.error(err);}},async cancel(){await reader.return?.();}});
}
export async function createFileResponse(manager:StorageManager,address:FileAddress,request:Request,options:{authorize?:FileHttpOptions['authorize'];inline?:boolean;cacheControl?:string;downloadName?:string}={}):Promise<Response>{
  validateAddress(address);
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
  const info=await manager.stat(address);
  if(!info)return new Response('Not found',{status:404});
  if(info.visibility==='private'&&!options.authorize)return new Response('Forbidden',{status:403});
  if(options.authorize&&!await options.authorize(request,address,'read',info))return new Response('Forbidden',{status:403});
  const safeInline=/^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[A-Za-z0-9.+-]+|video\/[A-Za-z0-9.+-]+|application\/pdf|text\/plain)$/.test(info.contentType.toLowerCase());
  const disposition=options.inline&&safeInline?'inline; '+filename(options.downloadName??address.key.split('/').at(-1)!):info.contentDisposition?.toLowerCase().startsWith('attachment')?info.contentDisposition:filename(options.downloadName??address.key.split('/').at(-1)!);
  const headers=new Headers({'Content-Type':info.contentType,'ETag':info.etag,'Last-Modified':new Date(info.modifiedAt).toUTCString(),'X-Content-Type-Options':'nosniff', 'Cache-Control':info.visibility==='private'?'private, no-store':options.cacheControl??info.cacheControl??'public, max-age=60','Content-Disposition':disposition, 'Accept-Ranges':info.rangeSupported===false?'none':'bytes'});
  const match=request.headers.get('if-none-match');
  if(match&&match.split(',').some(item=>item.trim()===info.etag||item.trim()==='*'))return new Response(null,{status:304,headers});
  const modified=request.headers.get('if-modified-since');if(!match&&modified&&Number.isFinite(Date.parse(modified))&&Date.parse(modified)>=new Date(info.modifiedAt).setMilliseconds(0))return new Response(null,{status:304,headers});
  const rangeHeader=request.headers.get('range');const ifRange=request.headers.get('if-range');
  const useRange=info.rangeSupported!==false&&rangeHeader&&(!ifRange||ifRange===info.etag||(Number.isFinite(Date.parse(ifRange))&&Date.parse(ifRange)>=Date.parse(info.modifiedAt)));
  const range=useRange?rangeFrom(rangeHeader,info.size):undefined;
  if(useRange&&!range){headers.set('Content-Range',`bytes */${info.size}`);return new Response(null,{status:416,headers});}
  const start=range?.start??0,end=range?.end??Math.max(0,info.size-1);const status=range?206:200;
  headers.set('Content-Length',String(range?end-start+1:info.size));
  if(range)headers.set('Content-Range',`bytes ${start}-${end}/${info.size}`);
  if(request.method==='HEAD')return new Response(null,{status,headers});
  const iterable=await manager.read(address,range?{start,end,signal:request.signal}:{signal:request.signal});
  return new Response(iterableBody(iterable),{status,headers});
}
/** Binary request bodies, no multipart parsing; authentication belongs to the route. */
export async function uploadFileRequest(manager:StorageManager,address:FileAddress,request:Request,options:PutFileOptions&{authorize?:FileHttpOptions['authorize']}={}):Promise<FileInfo>{
  if(!['PUT','POST'].includes(request.method)||!request.body)throw new TypeError('PUT/POST body required');
  if(options.authorize&&!await options.authorize(request,address,'write'))throw Object.assign(new Error('Forbidden'),{code:'FORBIDDEN'});
  // Require explicit authorization when this helper is used as a public HTTP endpoint.
  const encoded=request.headers.get('content-encoding');if(encoded&&encoded!=='identity')throw new TypeError('Encoded upload unsupported');
  const length=request.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))throw new RangeError('Invalid Content-Length');
  if(options.ifNoneMatch===false)throw new TypeError('HTTP upload helper requires create-only semantics');
  const max=options.maxBytes??16*1024*1024;
  if(!Number.isSafeInteger(max)||max<1)throw new RangeError('Invalid upload limit');
  if(length&&Number(length)>max)throw new RangeError('File exceeds upload limit');
  const contentType=options.contentType??request.headers.get('content-type')?.split(';')[0].trim()??'application/octet-stream';
  const info=await manager.put(address,request.body,{...options,contentType,maxBytes:max,signal:request.signal});
  if(length&&Number(length)!==info.size){await manager.delete(address);throw new RangeError('Upload length mismatch');}
  return info;
}
export function createFileHttpHandler(manager:StorageManager,options:FileHttpOptions):(request:Request)=>Promise<Response>{
  if(!options?.bucket)throw new TypeError('Fixed bucket required');
  const prefix=options.prefix??'';
  return async (request:Request)=>{
    let key:string;
    try{key=decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/,''));if(prefix)key=prefix+key;validateAddress({storage:options.storage,bucket:options.bucket,key});}
    catch{return new Response('Invalid object key',{status:400});}
    const address={storage:options.storage,bucket:options.bucket,key};
    try{
      if(['GET','HEAD'].includes(request.method))return createFileResponse(manager,address,request,{authorize:options.authorize,cacheControl:options.cacheControl});
      if(['POST','PUT'].includes(request.method)){
        // HTTP writes always require an auth callback; private-by-default.
        if(!options.authorize || !await options.authorize(request,address,'write'))return new Response('Forbidden',{status:403});
        const info=await uploadFileRequest(manager,address,request,{maxBytes:options.maxUploadBytes,contentType:request.headers.get('content-type')?.split(';')[0].trim()||'application/octet-stream'});
        return Response.json(info,{status:201,headers:{'Cache-Control':'no-store'}});
      }
      if(request.method==='DELETE'&&options.allowDelete){if(!options.authorize||!await options.authorize(request,address,'delete'))return new Response('Forbidden',{status:403});await manager.delete(address);return new Response(null,{status:204});}
      return new Response(null,{status:405,headers:{Allow:options.allowDelete?'GET, HEAD, POST, PUT, DELETE':'GET, HEAD, POST, PUT'}});
    }catch(err){const code=(err as {code?:string}).code;if(code==='FILE_EXISTS')return new Response('File exists',{status:409});if(code==='ENOENT')return new Response('Not found',{status:404});if(code==='FILE_EXPIRED')return new Response('File expired',{status:410});if(code==='FORBIDDEN')return new Response('Forbidden',{status:403});if(err instanceof RangeError)return new Response('File too large or invalid range',{status:413});if(err instanceof TypeError)return new Response('Invalid file request',{status:400});throw err;}
  };
}
