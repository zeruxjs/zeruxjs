import {createHash, randomBytes} from 'node:crypto';
import type {StorageManager, FileAddress, FileSource, FileInfo} from '@zeruxjs/files' with {'resolution-mode':'import'};
import type {Asset} from './types.js';
import {AssetManager, AssetRevisionError} from './manager.js';
import {validateAsset} from './validation.js';
export interface AssetIdentity {tenant:string;subject:string}
export interface AssetVersionReference {
 schema:1; versionId:string; assetId:string; tenantDigest:string; namespace:string;
 address:FileAddress; owned:boolean; size:number; sha256:string; contentType:string;
 createdAt:number; parentVersionId?:string;
}
export interface StoredAssetVersion {asset:Asset;reference:AssetVersionReference;retired:boolean}
export interface AssetRepairCandidate {address:FileAddress;versionId:string;etag:string;size:number;sha256:string;revision:number}
export interface AssetAccessContext {address?:FileAddress;versionId?:string;owned?:boolean}
export interface AssetStorageOptions {
 catalog:AssetManager;
 /** Borrowed; the adapter never closes the file manager. */
 files:StorageManager;
 namespace:string;
 location:(identity:AssetIdentity)=>{storage:string;bucket:string;prefix?:string};
 authorize:(identity:AssetIdentity,action:'upload'|'register'|'versions'|'download'|'delete'|'repair',assetId:string,context?:Readonly<AssetAccessContext>)=>boolean|Promise<boolean>;
 allowedTypes:readonly string[];
 maxBytes?:number;maxRecords?:number;maxPending?:number;
 approveRepair?:(identity:AssetIdentity,candidates:readonly AssetRepairCandidate[])=>boolean|Promise<boolean>;
}
export interface AssetStorageInput {
 asset:Asset;size:number;sha256:string;contentType:string;previousVersionId?:string;expectedRevision?:number;
}
export class AssetStorageError extends Error {
 constructor(readonly code:string,options?:ErrorOptions){super(code.toLowerCase().replaceAll('_',' '),options);this.name='AssetStorageError';}
}
const fail=(code:string)=>new AssetStorageError(code);
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const versionPattern=/^[a-f0-9]{48}$/;
const hashPattern=/^[a-f0-9]{64}$/;
const catalogLeases=new WeakMap<AssetManager,Set<string>>();
const recordKey='asset.storage.version',deletedKey='asset.storage.retired';
const recordId=(id:string)=>'storage.version/'+id;
const retiredId=(id:string)=>'storage.retired/'+id;
function identity(value:AssetIdentity){if(!value||[value.tenant,value.subject].some(v=>typeof v!=='string'||!v||v.length>256||/[\x00-\x1f\x7f]/.test(v)))throw fail('ASSET_IDENTITY');return {...value};}
function version(id:string){if(typeof id!=='string'||!versionPattern.test(id))throw fail('ASSET_VERSION');return id;}
function size(value:number,max:number){if(!Number.isSafeInteger(value)||value<0||value>max)throw fail('ASSET_SIZE');}
/** Explicit adapter: local catalog revisions do not provide cross-process coordination. */
export function createAssetStorage(options:AssetStorageOptions){
 if(!options||!(options.catalog instanceof AssetManager)||typeof options.files?.validateWrite!=='function'||typeof options.location!=='function'||typeof options.authorize!=='function'||!/^[a-z][a-z0-9_-]{0,63}$/.test(options.namespace))throw new TypeError('Catalog, policy-aware files, namespace and authorization required');
 if(!Array.isArray(options.allowedTypes)||!options.allowedTypes.length||options.allowedTypes.length>100||options.allowedTypes.some(type=>typeof type!=='string'||!/^[-\w.+]+\/(?:[-\w.+]+|\*)$/.test(type)))throw new TypeError('Explicit MIME allowlist required');
 const files=options.files,catalog=options.catalog,namespace=options.namespace,allowedTypes=[...options.allowedTypes];
 const maxBytes=options.maxBytes??16*1024*1024,maxRecords=options.maxRecords??10000,maxPending=options.maxPending??4;
 size(maxBytes,64*1024*1024);if(maxBytes<1||!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>100000||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>64)throw new TypeError('Invalid asset storage limits');
 const pending=new Set<Promise<unknown>>();let closed=false;
 const leased=catalogLeases.get(catalog)??new Set<string>();catalogLeases.set(catalog,leased);
 const leaseKey=(address:FileAddress)=>JSON.stringify([address.storage,address.bucket,address.key]);
 async function lease<T>(address:FileAddress,fn:()=>Promise<T>){const key=leaseKey(address);if(leased.has(key))throw fail('ASSET_BUSY');leased.add(key);try{return await fn();}finally{leased.delete(key);}}

 function run<T>(fn:()=>Promise<T>):Promise<T>{if(closed)return Promise.reject(fail('ASSET_CLOSED'));if(pending.size>=maxPending)return Promise.reject(fail('ASSET_BUSY'));const work=Promise.resolve().then(fn);pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}
 async function permit(who:AssetIdentity,action:Parameters<AssetStorageOptions['authorize']>[1],id:string,context?:AssetAccessContext){if(await options.authorize({...who},action,id,context?structuredClone(context):undefined)!==true)throw fail('ASSET_FORBIDDEN');}
 function scope(who:AssetIdentity){
  const binding=options.location({...who});
  if(!binding||typeof binding.storage!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(binding.storage)||typeof binding.bucket!=='string'||!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(binding.bucket)||binding.bucket.includes('..'))throw fail('ASSET_LOCATION');
  const prefix=binding.prefix??'';
  if(typeof prefix!=='string'||prefix.length>400||prefix&&(!prefix.endsWith('/')||prefix.startsWith('/')||prefix.slice(0,-1).split('/').some(p=>!p||p==='.'||p==='..'))||/[\\\x00-\x1f\x7f]/.test(prefix))throw fail('ASSET_LOCATION');
  const tenantDigest=digest(who.tenant);return {...binding,tenantDigest,prefix:prefix+namespace+'/'+tenantDigest+'/'};
 }
 function same(a:FileAddress,b:FileAddress){return a.storage===b.storage&&a.bucket===b.bucket&&a.key===b.key;}
 function inScope(who:AssetIdentity,address:FileAddress){const target=scope(who);if(!address||address.storage!==target.storage||address.bucket!==target.bucket||typeof address.key!=='string'||!address.key.startsWith(target.prefix))throw fail('ASSET_FORBIDDEN');return target;}
 function records():StoredAssetVersion[]{
  if(catalog.size>maxRecords)throw fail('ASSET_RECORD_LIMIT');const snapshot=catalog.snapshot();if(snapshot.assets.length>maxRecords)throw fail('ASSET_RECORD_LIMIT');
  return snapshot.assets.filter(asset=>asset.id.startsWith('storage.version/')).map(asset=>{
   let reference:AssetVersionReference;try{reference=JSON.parse(asset.metadata?.[recordKey]??'');}catch{throw fail('ASSET_CATALOG_CORRUPT');}
   if(reference.schema!==1||asset.id!==recordId(version(reference.versionId))||!hashPattern.test(reference.tenantDigest)||!hashPattern.test(reference.sha256)||typeof reference.owned!=='boolean'||typeof reference.namespace!=='string'||typeof reference.assetId!=='string')throw fail('ASSET_CATALOG_CORRUPT');
   size(reference.size,64*1024*1024);const metadata={...asset.metadata};delete metadata[recordKey];
   return {asset:validateAsset({...asset,id:reference.assetId,metadata}),reference,retired:catalog.has(retiredId(reference.versionId))};
  });
 }
 function ownedVersions(who:AssetIdentity){const target=scope(who);return records().filter(v=>v.reference.tenantDigest===target.tenantDigest&&v.reference.namespace===namespace);}
 function find(who:AssetIdentity,id:string){version(id);const found=ownedVersions(who).find(v=>v.reference.versionId===id);if(!found)throw fail('ASSET_NOT_FOUND');inScope(who,found.reference.address);return found;}
 function begin(who:AssetIdentity,input:AssetStorageInput){
  const asset=validateAsset(input.asset);if(asset.id.startsWith('storage.')||Object.keys(asset.metadata??{}).some(key=>key.startsWith('asset.storage.')))throw fail('ASSET_RESERVED');
  if(Object.keys(asset.metadata??{}).length>99)throw fail('ASSET_METADATA');
  size(input.size,maxBytes);if(typeof input.sha256!=='string'||!hashPattern.test(input.sha256)||typeof input.contentType!=='string'||! /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(input.contentType)||!allowedTypes.some(type=>type.endsWith('/*')?input.contentType.startsWith(type.slice(0,-1)):type===input.contentType))throw fail('ASSET_CONTENT');
  const revision=catalog.revision;if(input.expectedRevision!==undefined&&input.expectedRevision!==revision)throw new AssetRevisionError();
  const existing=ownedVersions(who).filter(v=>v.asset.id===asset.id);const latest=existing.at(-1);
  if(latest){if(!input.previousVersionId)throw fail('ASSET_EXISTS');if(input.previousVersionId!==latest.reference.versionId)throw fail('ASSET_VERSION_CONFLICT');}
  else if(input.previousVersionId!==undefined)throw fail('ASSET_VERSION_CONFLICT');
  if(catalog.size>=maxRecords)throw fail('ASSET_RECORD_LIMIT');return {asset,revision};
 }
 async function collect(source:FileSource,expected:number,sha256:string,signal?:AbortSignal){
  const data=Buffer.alloc(expected);let count=0,chunks=0;const hash=createHash('sha256');
  const consume=(chunk:Uint8Array)=>{if(signal?.aborted)throw fail('ASSET_CANCELLED');if(!(chunk instanceof Uint8Array))throw fail('ASSET_CONTENT');if(++chunks>65536||count+chunk.byteLength>expected)throw fail('ASSET_LENGTH');data.set(chunk,count);count+=chunk.byteLength;hash.update(chunk);};
  if(source instanceof Uint8Array)consume(source);
  else if(source instanceof ReadableStream){const reader=source.getReader();try{while(true){if(signal?.aborted)throw fail('ASSET_CANCELLED');const next=await reader.read();if(next.done)break;consume(next.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
  else for await(const chunk of source)consume(chunk);
  if(signal?.aborted)throw fail('ASSET_CANCELLED');if(count!==expected)throw fail('ASSET_LENGTH');if(hash.digest('hex')!==sha256)throw fail('ASSET_INTEGRITY');return data;
 }
 async function verified(address:FileAddress,expected:Pick<AssetVersionReference,'size'|'sha256'|'contentType'>,signal?:AbortSignal){
  size(expected.size,maxBytes);const info=await files.stat(address);if(!info)throw fail('ASSET_BINARY_MISSING');if(info.size!==expected.size||info.contentType!==expected.contentType)throw fail('ASSET_INTEGRITY');
  const bytes=await collect(await files.read(address,{signal}),expected.size,expected.sha256,signal);return {info,bytes};
 }
 function publish(who:AssetIdentity,input:AssetStorageInput,asset:Asset,revision:number,address:FileAddress,owned:boolean,versionId:string){
  const reference:AssetVersionReference={schema:1,versionId,assetId:asset.id,namespace,tenantDigest:scope(who).tenantDigest,address:{...address},owned,size:input.size,sha256:input.sha256,contentType:input.contentType,createdAt:Date.now(),...(input.previousVersionId?{parentVersionId:input.previousVersionId}:{})};
  const record=validateAsset({...asset,id:recordId(versionId),metadata:{...asset.metadata,[recordKey]:JSON.stringify(reference)}});
  catalog.apply([{action:'add',asset:record}],revision);return structuredClone({asset,reference,retired:false});
 }
 function marker(info:FileInfo,who:AssetIdentity,versionId:string,sha256:string){return info.metadata['zx-asset-namespace']===namespace&&info.metadata['zx-asset-tenant']===scope(who).tenantDigest&&info.metadata['zx-asset-version']===versionId&&info.metadata['zx-asset-sha256']===sha256;}
 function referenced(address:FileAddress,except?:string){return records().some(v=>!v.retired&&v.reference.versionId!==except&&same(v.reference.address,address));}
 return {
  upload(who:AssetIdentity,input:AssetStorageInput,source:FileSource,signal?:AbortSignal){return run(async()=>{
   who=identity(who);input={...input,asset:validateAsset(input.asset)};const {asset,revision}=begin(who,input);
   const target=scope(who),versionId=randomBytes(24).toString('hex');
   const address={storage:target.storage,bucket:target.bucket,key:target.prefix+versionId};
   await permit(who,'upload',asset.id,{address,versionId,owned:true});
   files.validateWrite!(address,{contentType:input.contentType,maxBytes:input.size||1});
   if(files.getDriver(address.storage).capabilities?.createOnlyWrite!==true)throw fail('ASSET_UNSUPPORTED_CAPABILITY');
   const bytes=await collect(source,input.size,input.sha256,signal);
   return lease(address,async()=>{
   await files.put(address,bytes,{contentType:input.contentType,visibility:'private',maxBytes:input.size||1,ifNoneMatch:true,signal,metadata:{'zx-asset-namespace':namespace,'zx-asset-tenant':target.tenantDigest,'zx-asset-version':versionId,'zx-asset-sha256':input.sha256}});
   const stored=await verified(address,input,signal);if(!marker(stored.info,who,versionId,input.sha256))throw fail('ASSET_OWNERSHIP');
   // A revision conflict never deletes a possibly committed object. Inventory repair is explicit.
   return publish(who,input,asset,revision,address,true,versionId);
   });
  });},
  register(who:AssetIdentity,input:AssetStorageInput,address:FileAddress,signal?:AbortSignal){return run(async()=>{
   who=identity(who);input={...input,asset:validateAsset(input.asset)};const {asset,revision}=begin(who,input);address={...address};inScope(who,address);await permit(who,'register',asset.id,{address,owned:false});return lease(address,async()=>{await verified(address,input,signal);
   return publish(who,input,asset,revision,address,false,randomBytes(24).toString('hex'));});
  });},
  versions(who:AssetIdentity,assetId:string){return run(async()=>{who=identity(who);await permit(who,'versions',assetId);return structuredClone(ownedVersions(who).filter(v=>v.asset.id===assetId));});},
  download(who:AssetIdentity,versionId:string,signal?:AbortSignal){return run(async()=>{who=identity(who);const found=find(who,versionId);await permit(who,'download',found.asset.id,{address:found.reference.address,versionId,owned:found.reference.owned});if(found.retired)throw fail('ASSET_RETIRED');return lease(found.reference.address,async()=>(await verified(found.reference.address,found.reference,signal)).bytes);});},
  delete(who:AssetIdentity,versionId:string,input:{binary:boolean;expectedRevision?:number}){return run(async()=>{
   who=identity(who);if(!input||typeof input.binary!=='boolean')throw fail('ASSET_DELETE_POLICY');input={...input};const found=find(who,versionId),revision=catalog.revision;
   if(input.expectedRevision!==undefined&&input.expectedRevision!==revision)throw new AssetRevisionError();await permit(who,'delete',found.asset.id,{address:found.reference.address,versionId,owned:found.reference.owned});if(found.retired)return;if(catalog.size>=maxRecords)throw fail('ASSET_RECORD_LIMIT');
   return lease(found.reference.address,async()=>{
   if(input.binary){
    if(!found.reference.owned)throw fail('ASSET_BORROWED_BINARY');if(referenced(found.reference.address,versionId))throw fail('ASSET_REFERENCED');
    const {info}=await verified(found.reference.address,found.reference);
    if(!marker(info,who,versionId,found.reference.sha256))throw fail('ASSET_OWNERSHIP');
    if(!await files.delete(found.reference.address))throw fail('ASSET_BINARY_MISSING');
   }
   catalog.apply([{action:'add',asset:{id:retiredId(versionId),name:'Retired asset reference',type:'other',metadata:{[deletedKey]:JSON.stringify({versionId,tenantDigest:scope(who).tenantDigest,namespace,binary:input.binary})}}}],revision);
   });
  });},
  previewRepair(who:AssetIdentity,input:{cursor?:string;limit?:number}={}){return run(async()=>{
   who=identity(who);await permit(who,'repair','*');const target=scope(who),revision=catalog.revision;
   const limit=input.limit??50;if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw fail('ASSET_LIMIT');
   const page=await files.list(target.bucket,{storage:target.storage,prefix:target.prefix,limit,cursor:input.cursor});const items:AssetRepairCandidate[]=[];
   for(const info of page.items){const versionId=info.metadata['zx-asset-version'],sha256=info.metadata['zx-asset-sha256'];const address={storage:target.storage,bucket:target.bucket,key:info.key};
    if(versionPattern.test(versionId??'')&&hashPattern.test(sha256??'')&&marker(info,who,versionId,sha256)&&!leased.has(leaseKey(address))&&!referenced(address))items.push({address,versionId,etag:info.etag,size:info.size,sha256,revision});
   }return {items,nextCursor:page.nextCursor};
  });},
  repair(who:AssetIdentity,candidates:readonly AssetRepairCandidate[]){return run(async()=>{
   who=identity(who);await permit(who,'repair','*');if(!Array.isArray(candidates)||candidates.length>100)throw fail('ASSET_LIMIT');
   const snapshot=structuredClone(candidates);for(const candidate of snapshot){version(candidate.versionId);inScope(who,candidate.address);size(candidate.size,maxBytes);if(!hashPattern.test(candidate.sha256))throw fail('ASSET_INTEGRITY');}
   if(!options.approveRepair||await options.approveRepair({...who},structuredClone(snapshot))!==true)throw fail('ASSET_FORBIDDEN');
   let deleted=0;for(const candidate of snapshot){
    if(catalog.revision!==candidate.revision||referenced(candidate.address))continue;
    if(leased.has(leaseKey(candidate.address)))continue;
    await lease(candidate.address,async()=>{
    const info=await files.stat(candidate.address);if(!info||info.etag!==candidate.etag||info.size!==candidate.size||!marker(info,who,candidate.versionId,candidate.sha256))return;
    await verified(candidate.address,{size:candidate.size,sha256:candidate.sha256,contentType:info.contentType});
    if(catalog.revision!==candidate.revision||referenced(candidate.address))return;
    if(await files.delete(candidate.address))deleted++;
    });
   }return deleted;
  });},
  async close(){closed=true;await Promise.allSettled([...pending]);}
 };
}
