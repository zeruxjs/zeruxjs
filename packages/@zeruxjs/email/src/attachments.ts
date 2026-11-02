import {Readable} from 'node:stream';
import {createReadStream} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import type {EmailManagerOptions,MailAttachment} from './types.js';

export interface AttachmentScope {attachments:Record<string,unknown>[];dispose():Promise<void>}
/** Lazy, bounded, owned attachment readers. The host's files manager remains borrowed. */
export async function resolveAttachmentScope(attachments:readonly MailAttachment[]=[],options:Pick<EmailManagerOptions,'files'|'maxAttachmentBytes'|'maxAttachmentStreams'>,allowLocalPaths=false,signal?:AbortSignal):Promise<AttachmentScope>{
 const max=options.maxAttachmentBytes??25*1024*1024,concurrency=options.maxAttachmentStreams??4;
 if(!Number.isSafeInteger(max)||max<1||max>1024*1024*1024||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>40||!Array.isArray(attachments)||attachments.length>40)throw new RangeError('Invalid attachment limit');
 const streams=new Set<Readable>(),settlements:Promise<void>[]=[];let sum=0,active=0,disposed=false,closing:Promise<void>|undefined;
 const check=()=>{if(disposed||signal?.aborted)throw Object.assign(new Error('Attachment operation cancelled'),{code:'EMAIL_ATTACHMENT_CANCELLED'});};
 const abort=()=>{for(const stream of streams)stream.destroy(Object.assign(new Error('Attachment cancelled'),{code:'EMAIL_ATTACHMENT_CANCELLED'}));};signal?.addEventListener('abort',abort,{once:true});
 const scope:AttachmentScope={attachments:[],dispose(){return closing??=(async()=>{disposed=true;signal?.removeEventListener('abort',abort);for(const stream of streams)stream.destroy();await Promise.allSettled(settlements);})();}};
 const reserve=(size:number)=>{if(!Number.isSafeInteger(size)||size<0)throw new RangeError('Invalid attachment size');sum+=size;if(sum>max)throw new RangeError('Attachments exceed aggregate limit');};
 function stream(open:()=>Promise<AsyncIterable<Uint8Array>>|AsyncIterable<Uint8Array>,size:number){
  async function* bounded(){check();if(active>=concurrency)throw Object.assign(new Error('Attachment stream limit'),{code:'EMAIL_ATTACHMENT_LIMIT'});active++;let iterator:AsyncIterator<Uint8Array>|undefined,consumed=0;
   try{const iterable=await open();iterator=iterable[Symbol.asyncIterator]();check();while(true){const next=await iterator.next();check();if(next.done)break;if(!(next.value instanceof Uint8Array))throw new TypeError('Invalid attachment bytes');consumed+=next.value.byteLength;if(consumed>size)throw new RangeError('Attachment exceeds recorded size');yield next.value;}if(consumed!==size)throw new RangeError('Attachment shorter than recorded size');}
   finally{try{await iterator?.return?.();}finally{active--;}}
  }
  const readable=Readable.from(bounded(),{objectMode:false});streams.add(readable);readable.on('error',()=>{});settlements.push(new Promise(resolve=>readable.once('close',()=>{streams.delete(readable);resolve();})));return readable;
 }
 try{for(const a of attachments){check();if(!a||typeof a!=='object'||Object.keys(a).some(k=>!['filename','file','path','content','cid','contentType','contentDisposition','encoding'].includes(k))||Object.values(Object.getOwnPropertyDescriptors(a)).some(d=>!('value'in d))||typeof a.filename!=='string'||!a.filename||a.filename.length>255||/[\r\n\0/\\]/.test(a.filename))throw new TypeError('Invalid attachment filename/options');
  if(a.cid!==undefined&&(typeof a.cid!=='string'||/[\r\n\0]/.test(a.cid)||a.cid.length>255)||a.contentType!==undefined&&(typeof a.contentType!=='string'||/[\r\n\0]/.test(a.contentType)||a.contentType.length>200)||a.contentDisposition!==undefined&&!['attachment','inline'].includes(a.contentDisposition))throw new TypeError('Invalid attachment metadata');
  if([a.file!==undefined,a.path!==undefined,a.content!==undefined].filter(Boolean).length!==1)throw new TypeError('Exactly one attachment source is required');
  const result:Record<string,unknown>={filename:a.filename,...(a.cid?{cid:a.cid}:{}),...(a.contentType?{contentType:a.contentType}:{}),...(a.contentDisposition?{contentDisposition:a.contentDisposition}:{})};
  if(a.file){if(!options.files)throw new TypeError('File manager required for storage attachments');const address={...a.file},stat=await options.files.stat(address);check();if(!stat)throw Object.assign(new Error('File attachment missing'),{code:'ENOENT'});if(typeof stat.contentType!=='string'||/[\r\n\0]/.test(stat.contentType)||stat.contentType.length>200)throw new TypeError('Invalid stored attachment type');reserve(stat.size);result.content=stream(()=>options.files!.read(address,{signal}),stat.size);if(!result.contentType)result.contentType=stat.contentType;}
  else if(a.path!==undefined){if(!allowLocalPaths)throw new TypeError('Filesystem-path attachments are disabled; use @zeruxjs/files');if(typeof a.path!=='string'||!isAbsolute(a.path)||/[\r\n\0]/.test(a.path))throw new TypeError('Absolute local attachment path required');const path=a.path,stat=await lstat(path);check();if(!stat.isFile()||stat.isSymbolicLink())throw new TypeError('Regular local attachment required');reserve(stat.size);result.content=stream(()=>createReadStream(path,{signal}),stat.size);}
  else {let bytes:Buffer;if(typeof a.content==='string'){if(a.encoding!==undefined&&!Buffer.isEncoding(a.encoding))throw new TypeError('Invalid attachment encoding');bytes=Buffer.from(a.content,a.encoding as BufferEncoding|undefined);}else if(a.content instanceof Uint8Array)bytes=Buffer.from(a.content);else throw new TypeError('Use @zeruxjs/files for streamed attachments');reserve(bytes.byteLength);result.content=bytes;}
  scope.attachments.push(result);
 }return scope;}catch(error){await scope.dispose();throw error;}
}
/** Compatibility helper: streams own completion cleanup; dispose unconsumed streams when used directly. */
export async function resolveAttachments(attachments:readonly MailAttachment[]=[],options:Pick<EmailManagerOptions,'files'|'maxAttachmentBytes'|'maxAttachmentStreams'>={},allowLocalPaths=false):Promise<Record<string,unknown>[]>{return (await resolveAttachmentScope(attachments,options,allowLocalPaths)).attachments;}
