import {Readable} from 'node:stream';
import type {EmailManagerOptions,MailAttachment} from './types.js';

export async function resolveAttachments(attachments:readonly MailAttachment[]=[],options:Pick<EmailManagerOptions,'files'|'maxAttachmentBytes'>,allowLocalPaths=false):Promise<Record<string,unknown>[]> {
  const max=options.maxAttachmentBytes??25*1024*1024;
  if(!Number.isSafeInteger(max)||max<1||max>1024*1024*1024)throw new RangeError('Invalid attachment limit');
  if(attachments.length>40)throw new RangeError('Too many attachments');
  let sum=0;
  return Promise.all(attachments.map(async a=>{
    if(!a||typeof a.filename!=='string'||a.filename.length>255||/[\r\n\0/\\]/.test(a.filename))throw new TypeError('Invalid attachment filename');
    if(a.cid&&(/[\r\n\0]/.test(a.cid)||a.cid.length>255))throw new TypeError('Invalid content ID');
    const provided=[a.file!==undefined,a.path!==undefined,a.content!==undefined].filter(Boolean).length;
    if(provided!==1)throw new TypeError('Exactly one attachment source is required');
    if(a.path){if(!allowLocalPaths)throw new TypeError('Filesystem-path attachments are disabled; use @zeruxjs/files');return {...a};}
    if(a.file){
      if(!options.files)throw new TypeError('File manager required for storage attachments');
      const stat=await options.files.stat(a.file);if(!stat)throw Object.assign(new Error('File attachment missing'),{code:'ENOENT'});
      sum+=stat.size;if(sum>max)throw new RangeError('Attachments exceed aggregate limit');
      const iterable=await options.files.read(a.file);
      const {file:_,...original}=a;
      let consumed=0;
      async function* bounded(){for await(const chunk of iterable){consumed+=chunk.byteLength;if(consumed>stat!.size||consumed>max)throw new RangeError('Attachment exceeds recorded size');yield chunk;}}
      return {...original,content:Readable.from(bounded(),{objectMode:false}),contentType:a.contentType??stat.contentType};
    }
    if(typeof a.content==='string')sum+=Buffer.byteLength(a.content);
    else if(a.content instanceof Uint8Array)sum+=a.content.byteLength;
    else throw new TypeError('Use @zeruxjs/files for streamed attachments');
    if(sum>max)throw new RangeError('Attachments exceed aggregate limit');
    return {...a};
  }));
}
