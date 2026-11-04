import {createHash,randomBytes} from 'node:crypto';
import type {Asset,AssetSnapshot} from './types.js';
import {AssetManager,AssetRevisionError,createAssetManager} from './manager.js';
import {readCatalogData,writeCatalogData} from './catalog-io.js';
import {validateAsset} from './validation.js';
export * from './brand-rules.js';
export type BrandAction='add'|'update'|'delete'|'restore';
export interface BrandActor {actor:string;tenant:string}
export interface BrandVersion {versionId:string;assetId:string;asset:Asset|null;hash:string|null;previousVersionId?:string;action:BrandAction|'migration';actor?:string;at:number;revision:number}
export interface BrandCatalogSnapshot {version:2;tenant:string;catalog:AssetSnapshot;history:BrandVersion[]}
export interface BrandAuditEvent {
 schema:1;eventId:string;phase:'intent'|'committed'|'rejected';actor:string;tenant:string;at:number;action:BrandAction;
 assetId:string;versionId:string;expectedRevision:number;nextRevision:number;
 hashDomain:'asset-metadata-v1';hashAlgorithm:'sha256';beforeHash:string|null;afterHash:string|null;
}
export interface BrandAuditSink {
 /** Resolve only after durable acknowledgement; no raw asset/notes/URLs/binaries are supplied. */
 append(event:Readonly<BrandAuditEvent>):Promise<void>;
}
export interface BrandCatalogOptions {
 catalog:AssetManager;tenant:string;audit:BrandAuditSink;auditPolicy:'required'|'best-effort';
 authorize:(identity:BrandActor,action:BrandAction|'read'|'snapshot',assetId:string)=>boolean|Promise<boolean>;
 snapshot?:AssetSnapshot|BrandCatalogSnapshot;maxHistory?:number;maxPending?:number;now?:()=>number;
}
export interface BrandMutationResult {version:BrandVersion;revision:number;audit:'written'|'failed'}
export class BrandRevisionError extends AssetRevisionError {
 constructor(readonly expectedRevision:number,readonly actualRevision:number,readonly assetId:string,readonly auditStatus?:'written'|'failed'){super();this.name='BrandRevisionError';}
}
export class BrandAuditError extends Error {
 readonly code='BRAND_AUDIT_FAILED';
 constructor(readonly phase:BrandAuditEvent['phase'],readonly committed:boolean,readonly receipt:{versionId:string;revision:number}|undefined,cause:unknown){super('Brand audit sink failed',{cause});this.name='BrandAuditError';}
}
const active=new WeakSet<AssetManager>();
const idPattern=/^[a-f0-9]{48}$/;
function identifier(value:unknown):asserts value is string{if(typeof value!=='string'||! /^[A-Za-z0-9_.:@-]{1,128}$/.test(value))throw new TypeError('Invalid brand actor or tenant');}
function editable(id:string){if(typeof id!=='string'||id.startsWith('storage.')||! /^[\w.:/-]{1,128}$/.test(id)||['__proto__','constructor','prototype'].includes(id))throw new TypeError('Invalid editable asset ID');}
function canonical(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
}
/** Metadata digest only. This is not a binary digest, signature or authorization proof. */
export function hashAssetMetadata(asset:Asset):string{return createHash('sha256').update(canonical(validateAsset(asset))).digest('hex');}
function bounded(value:unknown){let text:string;try{text=JSON.stringify(value);}catch{throw new TypeError('Invalid brand snapshot data');}if(Buffer.byteLength(text)>8*1024*1024)throw new RangeError('Brand snapshot exceeds 8 MiB');}
function time(value:number){if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Invalid brand timestamp');return value;}
/** Explicit migration; legacy actor/time provenance is not invented. at is the migration observation time. */
export function migrateBrandSnapshot(input:AssetSnapshot|BrandCatalogSnapshot,tenant:string,observedAt=Date.now()):BrandCatalogSnapshot {
 identifier(tenant);time(observedAt);bounded(input);
 if(!input||![1,2].includes(input.version))throw new TypeError('Unsupported brand snapshot');
 const catalog=createAssetManager();catalog.load(input.version===1?input:input.catalog);
 const current=catalog.snapshot();
 if(input.version===1){const migrated:BrandCatalogSnapshot={version:2,tenant,catalog:current,history:current.assets.filter(asset=>!asset.id.startsWith('storage.')).map(asset=>({versionId:randomBytes(24).toString('hex'),assetId:asset.id,asset,hash:hashAssetMetadata(asset),action:'migration',at:observedAt,revision:current.revision??0}))};bounded(migrated);return migrated;}
 if(input.tenant!==tenant||!Array.isArray(input.history)||input.history.length>10000)throw new TypeError('Invalid brand snapshot tenant/history');
 const history:BrandVersion[]=[],seen=new Map<string,BrandVersion>();
 for(const item of input.history){
  if(!item||!idPattern.test(item.versionId)||seen.has(item.versionId)||!['migration','add','update','delete','restore'].includes(item.action)||!Number.isSafeInteger(item.revision)||item.revision<0||item.revision>(current.revision??0))throw new TypeError('Invalid brand history');
  editable(item.assetId);time(item.at);if(item.actor!==undefined)identifier(item.actor);if(item.action!=='migration'&&item.actor===undefined)throw new TypeError('Missing brand history actor');
  const asset=item.asset===null?null:validateAsset(item.asset);if(asset&&asset.id!==item.assetId||item.action==='delete'&&asset!==null||item.action!=='delete'&&asset===null||item.hash!==(asset?hashAssetMetadata(asset):null))throw new TypeError('Invalid brand history hash');
  if(item.previousVersionId!==undefined&&seen.get(item.previousVersionId)?.assetId!==item.assetId)throw new TypeError('Invalid brand history parent');
  const version:BrandVersion={versionId:item.versionId,assetId:item.assetId,asset,hash:item.hash,action:item.action,at:item.at,revision:item.revision,...(item.actor!==undefined?{actor:item.actor}:{}),...(item.previousVersionId?{previousVersionId:item.previousVersionId}:{})};
  seen.set(version.versionId,version);history.push(version);
 }
 const result:BrandCatalogSnapshot={version:2,tenant,catalog:current,history};bounded(result);return structuredClone(result);
}
/** One explicit tenant workflow per borrowed catalog; host owns sink durability and persistence. */
export function createBrandCatalog(options:BrandCatalogOptions){
 if(!options||!(options.catalog instanceof AssetManager)||typeof options.audit?.append!=='function'||typeof options.authorize!=='function'||!['required','best-effort'].includes(options.auditPolicy))throw new TypeError('Brand catalog requires explicit authorization/audit policy');
 identifier(options.tenant);const catalog=options.catalog,tenant=options.tenant,now=options.now??Date.now,maxHistory=options.maxHistory??1000,maxPending=options.maxPending??8;
 if(typeof now!=='function'||!Number.isSafeInteger(maxHistory)||maxHistory<1||maxHistory>10000||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>64)throw new TypeError('Invalid brand workflow limits');
 if(active.has(catalog))throw new Error('Brand catalog already owned');
 if(options.snapshot&&catalog.size)throw new Error('Snapshot restoration requires an empty catalog');
 const initial=migrateBrandSnapshot(options.snapshot??catalog.snapshot(),tenant,time(now()));if(initial.history.length>maxHistory)throw new RangeError('Brand history limit');
 if(options.snapshot)catalog.load(initial.catalog);
 const history=initial.history;const pending=new Set<Promise<unknown>>();let closed=false,mutating=false,closing:Promise<void>|undefined;
 const append=options.audit.append.bind(options.audit),auditPolicy=options.auditPolicy;active.add(catalog);
 function run<T>(fn:()=>Promise<T>):Promise<T>{if(closed)return Promise.reject(new Error('Brand catalog closed'));if(pending.size>=maxPending)return Promise.reject(new Error('Brand catalog busy'));const work=Promise.resolve().then(fn);pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}
 function who(input:BrandActor){if(!input)throw new TypeError('Brand actor required');identifier(input.actor);identifier(input.tenant);if(input.tenant!==tenant)throw new Error('Brand tenant denied');return {...input};}
 async function permit(actor:BrandActor,action:Parameters<BrandCatalogOptions['authorize']>[1],id:string){if(await options.authorize({...actor},action,id)!==true)throw new Error('Brand action denied');}
 function check(revision:number,id:string){if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw new TypeError('Expected revision required');if(revision!==catalog.revision)throw new BrandRevisionError(revision,catalog.revision,id);}
 async function mutate(actor:BrandActor,action:BrandAction,id:string,expectedRevision:number,produce:(before:Asset|undefined)=>Asset|null){
  actor=who(actor);editable(id);check(expectedRevision,id);if(mutating)throw new Error('Brand mutation busy');mutating=true;
  try{
   await permit(actor,action,id);check(expectedRevision,id);if(history.length>=maxHistory)throw new RangeError('Brand history limit');
   const before=catalog.get(id),after=produce(before),parent=[...history].reverse().find(v=>v.assetId===id);
   const at=time(now()),version:BrandVersion={versionId:randomBytes(24).toString('hex'),assetId:id,asset:after,hash:after?hashAssetMetadata(after):null,action,actor:actor.actor,at,revision:expectedRevision+1,...(parent?{previousVersionId:parent.versionId}:{})};
   // Stage through the existing validator/revision implementation; no live mutation before audit intent.
   const staging=createAssetManager();staging.load(catalog.snapshot());staging.apply(after?[{action:'add',asset:after}]:[{action:'remove',id}],expectedRevision);
   bounded({version:2,tenant,catalog:staging.snapshot(),history:[...history,version]});
   const event:BrandAuditEvent={schema:1,eventId:randomBytes(24).toString('hex'),phase:'intent',actor:actor.actor,tenant,at,action,assetId:id,versionId:version.versionId,expectedRevision,nextRevision:expectedRevision+1,hashDomain:'asset-metadata-v1',hashAlgorithm:'sha256',beforeHash:before?hashAssetMetadata(before):null,afterHash:version.hash};
   let failed=false;
   try{await append(Object.freeze({...event}));}catch(cause){failed=true;if(auditPolicy==='required')throw new BrandAuditError('intent',false,undefined,cause);}
   if(catalog.revision!==expectedRevision){
    let auditStatus:'written'|'failed'='written';try{await append(Object.freeze({...event,phase:'rejected'}));}catch{auditStatus='failed';}
    throw new BrandRevisionError(expectedRevision,catalog.revision,id,auditStatus);
   }
   catalog.apply(after?[{action:'add',asset:after}]:[{action:'remove',id}],expectedRevision);history.push(version);
   const receipt={versionId:version.versionId,revision:catalog.revision};
   try{await append(Object.freeze({...event,phase:'committed'}));}catch(cause){failed=true;if(auditPolicy==='required')throw new BrandAuditError('committed',true,receipt,cause);}
   return {version:structuredClone(version),revision:receipt.revision,audit:failed?'failed':'written'} satisfies BrandMutationResult;
  }finally{mutating=false;}
 }
 return {
  add(actor:BrandActor,asset:Asset,expectedRevision:number){return run(()=>{const copy=validateAsset(asset);return mutate(actor,'add',copy.id,expectedRevision,before=>{if(before)throw new Error('Brand asset already exists');return copy;});});},
  update(actor:BrandActor,id:string,changes:Partial<Omit<Asset,'id'>>,expectedRevision:number){return run(()=>{const copy=structuredClone(changes);return mutate(actor,'update',id,expectedRevision,before=>{if(!before)throw new Error('Brand asset not found');return validateAsset({...before,...copy,id});});});},
  delete(actor:BrandActor,id:string,expectedRevision:number){return run(()=>mutate(actor,'delete',id,expectedRevision,before=>{if(!before)throw new Error('Brand asset not found');return null;}));},
  restore(actor:BrandActor,versionId:string,expectedRevision:number){return run(()=>{actor=who(actor);if(!idPattern.test(versionId))throw new TypeError('Invalid brand version');const version=history.find(v=>v.versionId===versionId);if(!version?.asset)throw new Error('Restorable brand version not found');return mutate(actor,'restore',version.assetId,expectedRevision,()=>structuredClone(version.asset!));});},
  get(actor:BrandActor,id:string){return run(async()=>{actor=who(actor);editable(id);await permit(actor,'read',id);return catalog.get(id);});},
  history(actor:BrandActor,id:string){return run(async()=>{actor=who(actor);editable(id);await permit(actor,'read',id);return structuredClone(history.filter(v=>v.assetId===id));});},
  snapshot(actor:BrandActor){return run(async()=>{actor=who(actor);await permit(actor,'snapshot','*');const result:BrandCatalogSnapshot={version:2,tenant,catalog:catalog.snapshot(),history:structuredClone(history)};bounded(result);return result;});},
  close(){closed=true;return closing??=(async()=>{await Promise.allSettled([...pending]);active.delete(catalog);})();}
 };
}

/** Persist a validated private V2 brand snapshot using the same bounded atomic writer as legacy catalogs. */
export async function saveBrandSnapshot(snapshot:BrandCatalogSnapshot,file:string):Promise<void>{
 if(snapshot?.version!==2)throw new TypeError('Expected brand snapshot version 2');
 await writeCatalogData(file,migrateBrandSnapshot(snapshot,snapshot.tenant));
}
/** Read V1 or V2 without evaluating notes/code; V1 migration records observation, not historical authorship. */
export async function loadBrandSnapshot(file:string,tenant:string):Promise<BrandCatalogSnapshot>{return migrateBrandSnapshot(await readCatalogData(file) as AssetSnapshot|BrandCatalogSnapshot,tenant);}
