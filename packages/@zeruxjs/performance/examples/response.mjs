import {Readable} from 'node:stream';
import {createCompressionOwner} from 'zhost/compression';
import {forwardPerformanceResponse} from '@zeruxjs/performance/response';
// One owner per application; do not also compress this response in another layer.
const compression=createCompressionOwner({encodings:['br','gzip'],maxConcurrent:4});
export function handlePublicCatalog(request,response){
 const bytes=Buffer.from(JSON.stringify({products:[]}));
 const source=Readable.from([bytes]);
 source.headers={'content-type':'application/json','content-length':String(bytes.length),'cache-control':'public, max-age=30'};
 // Real application handlers derive this classification after authorization.
 forwardPerformanceResponse(compression,request,source,response,{authenticated:false,public:true});
}
export const close=()=>compression.close();
