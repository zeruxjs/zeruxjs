/** Raw Fetch body validation shared by legacy, asset and multipart adapters; never parses multipart/form-data. */
export function mediaRequestBody(request:Request,options:{maxBytes?:number;expectedBytes?:number;contentType?:string}={}){
 if(!['POST','PUT'].includes(request.method)||!request.body)throw new TypeError('Upload requires POST/PUT body');
 if(request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')throw new TypeError('Encoded uploads unsupported');
 const contentType=(request.headers.get('content-type')??'application/octet-stream').split(';',1)[0].trim();
 if(options.contentType!==undefined&&contentType!==options.contentType)throw new TypeError('Upload content type mismatch');
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))throw new RangeError('Invalid Content-Length');
 if(options.expectedBytes!==undefined&&length!==null&&Number(length)!==options.expectedBytes)throw new RangeError('Upload length mismatch');
 if(options.maxBytes!==undefined&&(!Number.isSafeInteger(options.maxBytes)||options.maxBytes<1))throw new RangeError('Invalid upload limit');
 if(length!==null&&options.maxBytes!==undefined&&Number(length)>options.maxBytes)throw new RangeError('Media size exceeds limit');
 const declared=length===null?options.expectedBytes:Number(length);
 async function* source(){
  // Lazy acquisition also avoids leaking a reader if a downstream store rejects its options first.
  const reader=request.body!.getReader();let bytes=0,count=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};request.signal.addEventListener('abort',cancel,{once:true});
  try{while(true){if(request.signal.aborted)throw new Error('Upload cancelled');const next=await reader.read();if(next.done)break;if(!(next.value instanceof Uint8Array))throw new TypeError('Invalid binary chunk');bytes+=next.value.byteLength;
   if(!Number.isSafeInteger(bytes)||options.maxBytes!==undefined&&bytes>options.maxBytes||++count>65536)throw new RangeError('Media size exceeds limit');
   if(declared!==undefined&&bytes>declared)throw new RangeError('Upload length mismatch');yield next.value;
  }if(request.signal.aborted)throw new Error('Upload cancelled');if(declared!==undefined&&bytes!==declared)throw new RangeError('Upload length mismatch');}
  finally{request.signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 return {contentType,source:source()};
}
