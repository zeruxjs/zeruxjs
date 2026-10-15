/** Lightweight Fetch client; safe to import in browsers without Node/AWS dependencies. */
export function createFilesClient(options:{baseUrl:string;fetch?:typeof fetch;headers?:Record<string,string>}){
  const fetcher=options.fetch??fetch;
  const base=new URL(options.baseUrl);
  if(!['https:','http:'].includes(base.protocol))throw new TypeError('Invalid files URL');
  function path(key:string){if(!key||key.split('/').some(s=>!s||s==='.'||s==='..'))throw new TypeError('Invalid file key');const url=new URL(base.toString());url.pathname=base.pathname.replace(/\/?$/,'/')+key.split('/').map(encodeURIComponent).join('/');return url.toString();}
  async function request(key:string,init:RequestInit){const result=await fetcher(path(key),{...init,headers:{...options.headers,...init.headers}});if(!result.ok)throw Object.assign(new Error(`File request failed: ${result.status}`),{status:result.status});return result;}
  return {
    upload(key:string,data:Blob|Uint8Array|ReadableStream<Uint8Array>,opts:{contentType?:string;signal?:AbortSignal}={}){return request(key,{method:'PUT',headers:{'Content-Type':opts.contentType??'application/octet-stream'},body:data as BodyInit,signal:opts.signal,...(data instanceof ReadableStream ? {duplex:'half'} as RequestInit : {})}).then(r=>r.json());},
    download(key:string,opts:{signal?:AbortSignal;range?:string}={}){return request(key,{method:'GET',headers:opts.range?{Range:opts.range}:{},signal:opts.signal});},
    async bytes(key:string,maxBytes=16*1024*1024){const response=await request(key,{method:'GET'});const length=Number(response.headers.get('content-length')??0);if(length>maxBytes)throw new RangeError('File too large');const chunks:Uint8Array[]=[];let total=0;const reader=response.body?.getReader();if(!reader)return new Uint8Array();try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>maxBytes)throw new RangeError('File too large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}const output=new Uint8Array(total);let i=0;for(const chunk of chunks){output.set(chunk,i);i+=chunk.byteLength;}return output;},
    head(key:string){return request(key,{method:'HEAD'}).then(r=>r.headers);},
    remove(key:string){return request(key,{method:'DELETE'}).then(()=>undefined)}
  };
}
