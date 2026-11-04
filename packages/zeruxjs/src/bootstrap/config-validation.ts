import {validateQueueSelection} from '@zeruxjs/queue/neutral';
import { ServerLifecycleHooks } from '@zeruxjs/hooks';
import { validateDatabaseExecutionPolicy } from '@zeruxjs/db';
import { validateObservability } from '../observability.js';
import { createDevelopmentWatchIgnore } from 'zhost';
import { isDeepStrictEqual } from 'node:util';
import type { ZeruxConfig } from '../index.js';
import type { ServiceDefinition, PreparedService } from './service-definitions.js';
import { orderServices } from './service-definitions.js';
export class ConfigurationError extends Error {
  constructor(readonly code:string,cause?:unknown){super(`Invalid Zerux configuration (${code})`,{cause});this.name='ConfigurationError';}
}
export class RestartRequiredError extends Error {
  constructor(readonly fields:readonly string[]){super('Configuration change requires an explicit application restart');this.name='RestartRequiredError';}
}
const core=new Set('files email analytics tags reports queue search protocols type entryPoint outDir multisite structure server devtools worker allowedDomains allowedDevDomain connectorManager db database websocket cache security auth theme services serviceDefinitions publicSettings observability lifecycleHooks'.split(' '));
const forbidden=new Set(['__proto__','prototype','constructor']);
export function record(value:unknown):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ConfigurationError('EXPECTED_OBJECT');}
function keys(value:unknown,allowed:string[]){record(value);if(Object.keys(value).some(key=>!allowed.includes(key)||forbidden.has(key)))throw new ConfigurationError('UNKNOWN_CORE_KEY');}
function text(value:unknown){if(typeof value!=='string'||!value||value.length>4096||/[\x00-\x1f\x7f]/.test(value))throw new ConfigurationError('INVALID_STRING');}
function integer(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new ConfigurationError('INVALID_NUMBER');}
function list(value:unknown):asserts value is any[]{if(!Array.isArray(value)||value.length>1024)throw new ConfigurationError('COLLECTION_LIMIT');}
function stringList(value:unknown){if(typeof value==='string')text(value);else{list(value);value.forEach(text);}}
/** Snapshot plain config data; private class instances and executable definitions remain host-owned. */
export function snapshotConfig<T>(value:T):T{
  let nodes=0;const seen=new WeakSet<object>();
  const copy=(item:any,depth:number,key=''):any=>{
    if(++nodes>20000||depth>24)throw new ConfigurationError('CONFIG_LIMIT');
    if(typeof item==='string'&&item.length>65536)throw new ConfigurationError('CONFIG_LIMIT');
    if(typeof item==='number'&&!Number.isFinite(item))throw new ConfigurationError('INVALID_NUMBER');
    if(!item||typeof item!=='object')return item;
    if(key==='serviceDefinitions'){list(item);return [...item];}
    if(Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null&&!Array.isArray(item))return item;
    if(seen.has(item))throw new ConfigurationError('CYCLIC_CONFIG');seen.add(item);
    const result:any=Array.isArray(item)?[]:Object.create(null);if(Array.isArray(item))list(item);
    for(const name of Object.keys(item)){if(forbidden.has(name))throw new ConfigurationError('UNSAFE_CONFIG_KEY');const descriptor=Object.getOwnPropertyDescriptor(item,name)!;if(!('value'in descriptor))throw new ConfigurationError('CONFIG_ACCESSOR');result[name]=(key==='search'&&name==='registration'||key==='observability'&&name==='adapter'||key==='selection'&&name==='factory')?descriptor.value:copy(descriptor.value,depth+1,name);}
    seen.delete(item);return result;
  };
  return copy(value,0);
}
const serviceKeys:Record<string,string[]>={
  search:['enabled','registration'],
  cache:['policy','connector','options','prefix','defaultTtlSeconds','startupTimeoutMs','required'],
  files:['defaultStorage','stores','cache'],
  analytics:['analytics','enabled','table','indexes','numericFields','numericUniqueIndexManagedExternally','required','collector'],
  tags:['enabled','prefix','site','publicOrigin','allowedOrigins','serverToken','requestIds','store','container','credentials','destinations','authorizeAdmin','authorizePublish','requireBrowserConsent','siteByOrigin','botPolicy','onWarning','dashboardHost','debug','defaultConsent','onDebug','maxBodyBytes','maxEventsPerMinute'],
  reports:['enabled','prefix','authorize','dashboardHost','store','source','resolveScope','campaigns','maxSourceRows','site'],
  queue:['enabled','required','selection','redis','prefix','queues','workers','readyTimeoutMs','shutdownGraceMs','onWorkerError','events','dashboard','administration'],
  email:['accounts','receive','defaultAccount','maxRecipients','marketingSuppression','reputation','tracking','preferences','marketingFeedback','marketingCampaignDashboard','campaignDashboard']
};
/** Validate framework-owned shapes before any connector factory is called.
 * Driver-specific options and authorizer semantics remain with their owning packages.
 */
export function validateCoreConfig(config:ZeruxConfig):void{
  record(config);for(const key of Object.keys(config))if(!core.has(key))throw new ConfigurationError('UNKNOWN_CORE_KEY');
  if (![Object.prototype,null].includes(Object.getPrototypeOf(config))) throw new ConfigurationError('EXPECTED_OBJECT');
  snapshotConfig(config);
  if(config.lifecycleHooks!==undefined&&(!(config.lifecycleHooks instanceof ServerLifecycleHooks)||config.lifecycleHooks.getDiagnostics().disposed))throw new ConfigurationError('INVALID_LIFECYCLE_HOOKS');
  if(config.observability!==undefined)validateObservability(config.observability);
  for (const name of ['auth','security','websocket','devtools','theme','protocols']) if (config[name] !== undefined) record(config[name]);
  if(config.type!==undefined&&!['fix','dynamic','function'].includes(config.type))throw new ConfigurationError('INVALID_MODE');
  for(const key of ['entryPoint','outDir','connectorManager','allowedDevDomain'] as const)if(config[key]!==undefined)text(config[key]);
  if(config.multisite!==undefined&&typeof config.multisite!=='boolean')throw new ConfigurationError('INVALID_BOOLEAN');
  if(config.allowedDomains!==undefined)stringList(config.allowedDomains);
  if(config.server!==undefined){keys(config.server,['port','devPort','portless','allowedDomains','allowedDevDomain','watchIgnoredPaths']);for(const key of ['port','devPort'] as const)if(config.server[key]!==undefined)integer(config.server[key],0,65535);if(config.server.portless!==undefined&&typeof config.server.portless!=='boolean')throw new ConfigurationError('INVALID_PORTLESS_OPTION');if(config.server.allowedDomains!==undefined)stringList(config.server.allowedDomains);if(config.server.allowedDevDomain!==undefined)text(config.server.allowedDevDomain);if(config.server.watchIgnoredPaths!==undefined){if(!Array.isArray(config.server.watchIgnoredPaths)||config.server.watchIgnoredPaths.length>64)throw new ConfigurationError('COLLECTION_LIMIT');try{createDevelopmentWatchIgnore(config.server.watchIgnoredPaths);}catch(error){throw new ConfigurationError('INVALID_WATCH_EXCLUSIONS',error);}}}
  if(config.structure!==undefined){keys(config.structure,['app','middleware','controllers','composables','plugins','public','env']);for(const value of Object.values(config.structure))if(value!==undefined)stringList(value);}
  if(config.worker!==undefined){keys(config.worker,['minThreads','maxThreads']);if(config.worker.minThreads!==undefined)integer(config.worker.minThreads,0,128);if(config.worker.maxThreads!==undefined)integer(config.worker.maxThreads,1,128);if((config.worker.minThreads??0)>(config.worker.maxThreads??128))throw new ConfigurationError('WORKER_RANGE');}
  for(const key of ['db','database'] as const)if(config[key]!==undefined){const db=config[key]!;keys(db,['default','connections','connection','execution']);if(db.execution!==undefined)validateDatabaseExecutionPolicy(db.execution);if(db.default!==undefined)text(db.default);for(const field of ['connections','connection'] as const)if(db[field]!==undefined){list(db[field]);const slugs=new Set<string>();for(const connection of db[field]!){keys(connection,['name','slug','connector','connecter','options']);text(connection.slug);if(slugs.has(connection.slug))throw new ConfigurationError('DUPLICATE_CONNECTION');slugs.add(connection.slug);if(connection.name!==undefined)text(connection.name);text(connection.connector??connection.connecter);if(connection.options!==undefined)record(connection.options);}}}
  for(const [name,allowed] of Object.entries(serviceKeys)){const value=config[name];if(value===undefined)continue;keys(value,allowed);for(const key of ['enabled','required','indexes','numericUniqueIndexManagedExternally','requireBrowserConsent','debug'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw new ConfigurationError('INVALID_BOOLEAN');}
  if(config.search!==undefined){const r=config.search.registration;if(!r||r.kind!=='zerux-search-v1'||typeof r.validate!=='function'||typeof r.start!=='function')throw new ConfigurationError('INVALID_SEARCH_REGISTRATION');try{r.validate();}catch(error){throw new ConfigurationError('INVALID_SEARCH_REGISTRATION',error);}}
  if(config.cache?.policy!==undefined){record(config.cache.policy);const policy=config.cache.policy;const allowed=['maxBulk','maxPendingProducers','maxKeyBytes','maxValueBytes','maxDepth','requireCapabilities','ownHelper'];for(const key of Object.keys(policy))if(!allowed.includes(key))throw new ConfigurationError('UNKNOWN_CONFIG_KEY');for(const [key,max] of Object.entries({maxBulk:10000,maxPendingProducers:1024,maxKeyBytes:65536,maxValueBytes:16777216,maxDepth:64}))if((policy as Record<string,unknown>)[key]!==undefined)integer((policy as Record<string,unknown>)[key],1,max);if(policy.ownHelper!==undefined&&typeof policy.ownHelper!=='boolean')throw new ConfigurationError('INVALID_CONFIG');if(policy.requireCapabilities!==undefined&&(!Array.isArray(policy.requireCapabilities)||policy.requireCapabilities.length>4||policy.requireCapabilities.some((v:unknown)=>!['conditionalWrites','counters','namespaceClear','bulkAtomicity'].includes(v as string))))throw new ConfigurationError('INVALID_CONFIG');}
  if(config.cache){if(config.cache.connector!==undefined)text(config.cache.connector);if(config.cache.options!==undefined)record(config.cache.options);if(config.cache.prefix!==undefined){text(config.cache.prefix);if(Buffer.byteLength(config.cache.prefix)>(config.cache.policy?.maxKeyBytes??1024))throw new ConfigurationError('INVALID_CONFIG');}if(config.cache.startupTimeoutMs!==undefined)integer(config.cache.startupTimeoutMs,1,600000);if(config.cache.defaultTtlSeconds!==undefined&&(typeof config.cache.defaultTtlSeconds!=='number'||!Number.isFinite(config.cache.defaultTtlSeconds*1000)||config.cache.defaultTtlSeconds<=0))throw new ConfigurationError('INVALID_NUMBER');}
  if(config.files){list(config.files.stores);for(const store of config.files.stores){keys(store,['name','type','root','options','allowedBuckets','allowedTypes','readonly','maxBytes','keyPrefix']);text(store.name);if(!['local','s3'].includes(store.type))throw new ConfigurationError('INVALID_STORAGE_TYPE');}}
  if(config.email){if(config.email.accounts!==undefined)list(config.email.accounts);if(config.email.receive!==undefined)record(config.email.receive);}
  if(config.queue)for(const key of ['enabled','required'] as const)if(config.queue[key]!==undefined&&typeof config.queue[key]!=='boolean')throw new ConfigurationError('INVALID_BOOLEAN');
  if(config.queue&&'selection' in config.queue){keys(config.queue,['enabled','required','selection']);try{validateQueueSelection(config.queue.selection);}catch(error){throw new ConfigurationError('INVALID_QUEUE_SELECTION',error);}}
  else if(config.queue?.enabled===true){record(config.queue.redis);list(config.queue.queues);}
  if(config.services!==undefined)record(config.services);
  if(config.serviceDefinitions!==undefined)list(config.serviceDefinitions);
  if(config.reports?.enabled===true&&typeof config.reports.authorize!=='function')throw new ConfigurationError('MISSING_AUTHORIZER');
  if(config.queue&&'dashboard' in config.queue&&config.queue.dashboard)for(const name of ['authorize','verifyCsrf','csrfToken'] as const)if(typeof config.queue.dashboard[name]!=='function')throw new ConfigurationError('MISSING_AUTHORIZER');
}
/** Reject functions, credentials-by-key and non-JSON objects in explicitly public settings. */
export function publicSettings(value:unknown,privateKeysAllowed=false):unknown{
  let nodes=0;const copy=(item:unknown,depth:number):unknown=>{
    if(++nodes>4096||depth>12)throw new ConfigurationError('PUBLIC_CONFIG_LIMIT');
    if(item===null||typeof item==='boolean')return item;
    if(typeof item==='string'){if(item.length>16384)throw new ConfigurationError('PUBLIC_CONFIG_LIMIT');return item;}
    if(typeof item==='number'&&Number.isFinite(item))return item;
    if(Array.isArray(item)){list(item);return item.map(value=>copy(value,depth+1));}
    record(item);if(![null,Object.prototype].includes(Object.getPrototypeOf(item)))throw new ConfigurationError('NON_SERIALIZABLE_PUBLIC_CONFIG');
    const result:Record<string,unknown>=Object.create(null);
    for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))){if(forbidden.has(key)||(!privateKeysAllowed&&/(password|secret|token|credential|authorization|private|salt|key|dsn|connectionstring)/i.test(key))||!('value'in descriptor))throw new ConfigurationError('PRIVATE_FIELD_IN_PUBLIC_CONFIG');result[key]=copy(descriptor.value,depth+1);}
    return result;
  };return copy(value,0);
}
export async function prepareConfiguration(config:ZeruxConfig):Promise<{config:ZeruxConfig;definitions:readonly ServiceDefinition[];services:PreparedService[];publicConfig:Record<string,unknown>}>{
  config=snapshotConfig(config);validateCoreConfig(config);const definitions=orderServices(config.serviceDefinitions??[]);
  const declared=new Set(definitions.map(definition=>definition.namespace));for(const key of Object.keys(config.services??{}))if(!declared.has(key))throw new ConfigurationError('UNREGISTERED_SERVICE_NAMESPACE');
  const services:PreparedService[]=[],published:Record<string,unknown>=Object.create(null);
  for(const definition of definitions){const raw=config.services?.[definition.namespace];if(raw===undefined){services.push({definition,enabled:false,settings:undefined,privateOptions:undefined});continue;}
    keys(raw,['enabled','settings','privateOptions']);if(raw.enabled!==undefined&&typeof raw.enabled!=='boolean')throw new ConfigurationError('INVALID_BOOLEAN');
    let parsed;try{parsed=await definition.schema['~standard'].validate(snapshotConfig(raw.settings));}catch(error){throw new ConfigurationError('CUSTOM_SCHEMA_FAILED',error);}
    if(!parsed||parsed.issues!==undefined)throw new ConfigurationError('CUSTOM_SCHEMA_FAILED');
    const settings=publicSettings(snapshotConfig(parsed.value),true);record(settings);
    const fields:Record<string,unknown>=Object.create(null);for(const name of definition.publicFields??[])if(Object.hasOwn(settings,name))fields[name]=settings[name];published[definition.namespace]=publicSettings(fields);
    services.push({definition,enabled:raw.enabled!==false,settings,privateOptions:raw.privateOptions});
  }
  const exposed:Record<string,unknown>={type:config.type??'fix',multisite:config.multisite??false};
  if(config.server)exposed.server={...(config.server.port!==undefined?{port:config.server.port}:{}),...(config.server.devPort!==undefined?{devPort:config.server.devPort}:{})};
  if(config.publicSettings!==undefined)exposed.publicSettings=publicSettings(config.publicSettings);
  if(definitions.length)exposed.services=published;
  const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}};freeze(exposed);
  return {config,definitions,services,publicConfig:exposed};
}
export interface ConfigLayers {defaults?:Partial<ZeruxConfig>;file?:Partial<ZeruxConfig>;environment?:Partial<ZeruxConfig>;overrides?:Partial<ZeruxConfig>}
/** Plain objects merge recursively; arrays/scalars/functions replace; undefined does not override. */
export async function resolveApplicationConfig(layers:ConfigLayers):Promise<ZeruxConfig>{
  record(layers);let config:Record<string,any>={};
  const merge=(target:Record<string,any>,source:Record<string,any>)=>{for(const key of Object.keys(source)){if(forbidden.has(key))throw new ConfigurationError('UNSAFE_CONFIG_KEY');const value=source[key];if(value===undefined)continue;const plain=value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));if(plain&&key!=='serviceDefinitions'){const old=target[key];target[key]=merge(old&&typeof old==='object'&&!Array.isArray(old)?{...old}:{},value);}else target[key]=value;}return target;};
  for(const layer of [layers.defaults,layers.file,layers.environment,layers.overrides])if(layer!==undefined){record(layer);config=merge(config,snapshotConfig(layer));}
  const result=config as ZeruxConfig;await prepareConfiguration(result);return result;
}
/** No automatic application restart. Only declared custom settings fields may change. */
export function assertConfigReloadable(previous:ZeruxConfig,next:ZeruxConfig):void{
  const changed:string[]=[];
  if(previous.lifecycleHooks!==next.lifecycleHooks)changed.push('lifecycleHooks');
  if(previous.observability?.adapter!==undefined||next.observability?.adapter!==undefined)changed.push('observability.adapter');
  const oldDefs=previous.serviceDefinitions??[],newDefs=next.serviceDefinitions??[];
  if(oldDefs.length!==newDefs.length||oldDefs.some((definition,index)=>definition!==newDefs[index]))changed.push('serviceDefinitions');
  for(const key of new Set([...Object.keys(previous),...Object.keys(next)])){if(key==='services'||key==='serviceDefinitions')continue;if(!isDeepStrictEqual(previous[key],next[key]))changed.push(key);}
  for(const namespace of new Set([...Object.keys(previous.services??{}),...Object.keys(next.services??{})])){
    const before=previous.services?.[namespace],after=next.services?.[namespace],definition=oldDefs.find(def=>def.namespace===namespace);
    if(!before||!after||before.enabled!==after.enabled||!isDeepStrictEqual(before.privateOptions,after.privateOptions)){if(!isDeepStrictEqual(before,after))changed.push(`services.${namespace}`);continue;}
    for(const field of new Set([...Object.keys(before.settings??{}),...Object.keys(after.settings??{})]))if(!isDeepStrictEqual(before.settings?.[field],after.settings?.[field])&&!definition?.reloadable?.includes(field))changed.push(`services.${namespace}.settings.${field}`);
  }
  if(changed.length)throw new RestartRequiredError(Object.freeze(changed.sort()));
}
