import type {ResumableUploads,UploadIdentity,UploadSession,FileAddress,FileInfo} from '@zeruxjs/files';
import {mediaRequestBody} from './request-body.js';
export interface MediaResumableOptions {
 uploads:ResumableUploads;
 prefix:string;
 identify:(request:Request)=>UploadIdentity|Promise<UploadIdentity>;
 /** Authenticate/authorize and apply origin/CSRF policy for writes, even on retries. */
 authorizeRequest:(request:Request)=>boolean|Promise<boolean>;
 destination:(identity:UploadIdentity,input:{name:string;contentType:string;size:number;sha256:string})=>FileAddress;
 allowedTypes:readonly string[];
 partBytes?:number;maxBytes?:number;maxPending?:number;
 /** Optional metadata integration AFTER binary commit. Must be durably idempotent by tenant+session ID. */
 onError?:(cause:unknown,detail:Readonly<{committed:boolean}>)=>void;
 onCommitted?:(identity:UploadIdentity,sessionId:string,info:FileInfo)=>Promise<{assetId:string;versionId:string}>;
}
function sessionView(session:UploadSession,partBytes:number){return {protocol:'zerux-media-resumable-v1',id:session.id,status:session.status,size:session.size,sha256:session.sha256,expiresAt:session.expiresAt,partBytes,parts:session.parts.map(({number,size,sha256})=>({number,size,sha256}))};}
/** Explicit Fetch protocol over the files-owned tenant journal. No route, server or store starts here. */
export function createMediaResumableHandler(options:MediaResumableOptions){
 if(((((((((!options||(typeof options.uploads?.initiate!=='function'))||(typeof options.identify!=='function'))||(typeof options.authorizeRequest!=='function'))||(typeof options.destination!=='function'))||! /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(options.prefix))||!Array.isArray(options.allowedTypes))||!options.allowedTypes.length)||(options.allowedTypes.length>100))||options.allowedTypes.some(v=>(typeof v!=='string')||! /^[\w.+-]+\/[\w.+-]+$/.test(v)))throw new TypeError('Explicit resumable protocol configuration required');
 const partBytes=options.partBytes??((5*1024)*1024),maxBytes=options.maxBytes??((1024*1024)*1024),maxPending=options.maxPending??8;
 if(((((((!Number.isSafeInteger(partBytes)||(partBytes<1))||(partBytes>((64*1024)*1024)))||!Number.isSafeInteger(maxBytes))||(maxBytes<1))||!Number.isSafeInteger(maxPending))||(maxPending<1))||(maxPending>64))throw new TypeError('Invalid resumable protocol limits');
 const pending=new Set<Promise<unknown>>();let closed=false;
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 async function json(request:Request,keys:readonly string[]){
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new TypeError('JSON required');
  const body=mediaRequestBody(request,{maxBytes:8192});const pieces:Uint8Array[]=[];let total=0;for await(const chunk of body.source){total+=chunk.length;pieces.push(chunk);}const bytes=new Uint8Array(total);let offset=0;for(const chunk of pieces){bytes.set(chunk,offset);offset+=chunk.length;}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(((!value||(typeof value!=='object'))||Array.isArray(value))||Object.keys(value).some(key=>!keys.includes(key)))throw new TypeError('Invalid protocol fields');return value;
 }
 async function dispatch(request:Request){
  let committed=false;
  try{
   if(await options.authorizeRequest(request)!==true)return reply({code:'FORBIDDEN'},403);
   const identity=await options.identify(request);const path=new URL(request.url).pathname;
   if((path!==options.prefix)&&!path.startsWith(options.prefix+'/'))return reply({code:'NOT_FOUND'},404);
   const suffix=path.slice(options.prefix.length),match=/^\/([a-f0-9]{48})(?:\/(complete)|\/parts\/([1-9][0-9]{0,3}))?$/.exec(suffix);
   if((suffix==='')&&(request.method==='POST')){
    const input=await json(request,['name','size','sha256','contentType']);
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    if((((((((((typeof input.name!=='string')||!input.name)||(input.name.length>180))||/[\\/\x00-\x1f\x7f]/.test(input.name))||!Number.isSafeInteger(input.size))||(input.size<1))||(input.size>maxBytes))||(typeof input.sha256!=='string'))||! /^[a-f0-9]{64}$/.test(input.sha256))||!options.allowedTypes.includes(input.contentType))throw new TypeError('Invalid initiation');
    const address=options.destination({...identity},input);
    const session=await options.uploads.initiate(identity,address,{size:input.size,sha256:input.sha256,contentType:input.contentType,metadata:{'media-name':input.name},ifNoneMatch:true,visibility:'private'});
    return reply(sessionView(session,partBytes),201);
   }
   if(!match)return reply({code:'NOT_FOUND'},404);const id=match[1];
   if((!match[2]&&!match[3])&&(request.method==='GET'))return reply(sessionView(await options.uploads.listParts(identity,id),partBytes));
   if((!match[2]&&!match[3])&&(request.method==='DELETE')){await options.uploads.abort(identity,id);return reply({id,status:'aborted'});}
   if(match[3]&&(request.method==='PUT')){
    const rawSize=request.headers.get('x-media-part-size'),sha256=request.headers.get('x-media-part-sha256');
    if((((!rawSize||! /^[1-9][0-9]{0,9}$/.test(rawSize))||!sha256)||! /^[a-f0-9]{64}$/.test(sha256))||(Number(rawSize)>partBytes))throw new TypeError('Invalid part declaration');
    const existing=await options.uploads.listParts(identity,id),number=Number(match[3]);
    if((Number(rawSize)!==Math.min(partBytes,existing.size-((number-1)*partBytes)))||(Number(rawSize)<1))throw new TypeError('Invalid planned part size');
    const body=mediaRequestBody(request,{maxBytes:partBytes,expectedBytes:Number(rawSize),contentType:'application/octet-stream'});
    const receipt=await options.uploads.uploadPart(identity,id,Number(match[3]),body.source,{size:Number(rawSize),sha256,signal:request.signal});
    return reply({number:receipt.number,size:receipt.size,sha256:receipt.sha256});
   }
   if(match[2]&&(request.method==='POST')){
    const input=await json(request,['parts']);if(((!Array.isArray(input.parts)||!input.parts.length)||(input.parts.length>1000))||input.parts.some((v:unknown,i:number)=>v!==(i+1)))throw new TypeError('Invalid part order');
    const existing=await options.uploads.listParts(identity,id);
    const info=await options.uploads.finalize(identity,id,input.parts,request.signal);committed=true;
    const asset=options.onCommitted?await options.onCommitted({...identity},id,info):undefined;
    if(asset&&((((typeof asset.assetId!=='string')||! /^[\w.:/-]{1,128}$/.test(asset.assetId))||(typeof asset.versionId!=='string'))||! /^[a-f0-9]{48}$/.test(asset.versionId)))throw new Error('Invalid committed metadata receipt');
    return reply({protocol:'zerux-media-resumable-v1',id,status:'complete',size:info.size,sha256:existing.sha256,...(asset?{asset}:{})});
   }
   return reply({code:'METHOD_NOT_ALLOWED'},405);
  }catch(error){
   try{options.onError?.(error,Object.freeze({committed}));}catch{/* Observers do not change the protocol outcome. */}
   if(committed)return reply({code:'METADATA_AFTER_COMMIT_FAILED',committed:true},503);
   const code=(error as {code?:string})?.code;
   if((code==='UPLOAD_FORBIDDEN')||(code==='FORBIDDEN'))return reply({code:'FORBIDDEN'},403);
   if(code==='UPLOAD_EXPIRED')return reply({code:'UPLOAD_EXPIRED'},410);
   if(code==='ENOENT')return reply({code:'NOT_FOUND'},404);
   if(((code==='UPLOAD_BUSY')||(code==='FILE_EXISTS'))||(code==='UPLOAD_STATE'))return reply({code},409);
   if(code==='UPLOAD_UNCERTAIN')return reply({code,committed:'unknown'},409);
   if(code==='UPLOAD_LIMIT')return reply({code:'UPLOAD_LIMIT'},413);
   if(((((((code==='UPLOAD_INTEGRITY')||(code==='UPLOAD_LENGTH'))||(code==='UPLOAD_PART_CONFLICT'))||(code==='UPLOAD_PART_ORDER'))||(error instanceof TypeError))||(error instanceof SyntaxError))||(error instanceof RangeError))return reply({code:'INVALID_UPLOAD'},400);
   return reply({code:'UPLOAD_FAILED'},503);
  }finally{await request.body?.cancel().catch(()=>{});}
 }
 return {
  handle(request:Request){if(closed)return Promise.resolve(reply({code:'CLOSED'},503));if(pending.size>=maxPending)return Promise.resolve(reply({code:'BUSY'},503));const work=dispatch(request);pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;},
  async close(){closed=true;await Promise.allSettled([...pending]);}
 };
}
