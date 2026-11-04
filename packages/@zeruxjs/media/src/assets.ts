import type {createAssetStorage,AssetIdentity,AssetStorageInput,AssetRepairCandidate,StoredAssetVersion} from '@zeruxjs/asset-manager/storage';
import type {FileAddress} from '@zeruxjs/files';
import {mediaRequestBody} from './request-body.js';
export interface MediaAssetOptions {
 assets:ReturnType<typeof createAssetStorage>;
 /** Must authenticate server identity; never copy unverified forwarded/header tenant claims. */
 identify:(request:Request)=>AssetIdentity|Promise<AssetIdentity>;
 authorizeRequest:(request:Request)=>boolean|Promise<boolean>;
 maxPending?:number;
}
function publicMetadata(version:StoredAssetVersion){const {asset,reference,retired}=version;return {assetId:asset.id,versionId:reference.versionId,name:asset.name,type:asset.type,size:reference.size,sha256:reference.sha256,contentType:reference.contentType,retired,variants:Object.keys(asset.variants??{})};}
/** Optional borrowed asset adapter. Its underlying catalog authorizes every identity/action. */
export function createMediaAssetService(options:MediaAssetOptions){
 if(!options||typeof options.identify!=='function'||typeof options.authorizeRequest!=='function'||typeof options.assets?.upload!=='function')throw new TypeError('Injected asset storage and identity required');
 const assets=options.assets,maxPending=options.maxPending??4;if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>64)throw new TypeError('Invalid pending limit');
 const pending=new Set<Promise<unknown>>();let closed=false;
 function run<T>(fn:()=>Promise<T>){if(closed)return Promise.reject(new Error('Media asset service closed'));if(pending.size>=maxPending)return Promise.reject(new Error('Media asset service busy'));const work=Promise.resolve().then(fn);pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}
 async function identify(request:Request){if(await options.authorizeRequest(request)!==true)throw Object.assign(new Error('Media request forbidden'),{code:'FORBIDDEN'});return options.identify(request);}
 return {
  upload(request:Request,input:AssetStorageInput){return run(async()=>{try{
   const identity=await identify(request);const body=mediaRequestBody(request,{maxBytes:input.size||1,expectedBytes:input.size,contentType:input.contentType});
   return publicMetadata(await assets.upload(identity,input,body.source,request.signal));
  }catch(error){await request.body?.cancel().catch(()=>{});throw error;}});},
  register(request:Request,input:AssetStorageInput,address:FileAddress){return run(async()=>{if(request.method!=='POST')throw new TypeError('Registration requires POST');return publicMetadata(await assets.register(await identify(request),input,address,request.signal));});},
  metadata(request:Request,assetId:string){return run(async()=> (await assets.versions(await identify(request),assetId)).map(publicMetadata));},
  download(request:Request,assetId:string,versionId:string){return run(async()=>{
   if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
   const identity=await identify(request),version=(await assets.versions(identity,assetId)).find(v=>v.reference.versionId===versionId&&!v.retired);if(!version)return new Response('Not found',{status:404});
   // This path is deliberately bounded/verified; use files-backed streaming for larger transfers.
   const bytes=await assets.download(identity,versionId,request.signal);
   const name=version.asset.name.replace(/[\\/\x00-\x1f\x7f"']/g,'_').slice(0,180)||'download';
   return new Response(request.method==='HEAD'?null:new Uint8Array(bytes),{headers:{'Content-Type':version.reference.contentType,'Content-Length':String(bytes.byteLength),'Content-Disposition':`attachment; filename="${name.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Media-SHA256':version.reference.sha256}});
  });},
  remove(request:Request,versionId:string,input:{binary:boolean;expectedRevision?:number}){return run(async()=>{if(request.method!=='DELETE')throw new TypeError('Removal requires DELETE');return assets.delete(await identify(request),versionId,input);});},
  previewRepair(request:Request,input:{cursor?:string;limit?:number}={}){return run(async()=>assets.previewRepair(await identify(request),input));},
  repair(request:Request,candidates:readonly AssetRepairCandidate[]){return run(async()=>{if(request.method!=='POST')throw new TypeError('Repair requires POST');return assets.repair(await identify(request),candidates);});},
  async close(){closed=true;await Promise.allSettled([...pending]);}
 };
}
