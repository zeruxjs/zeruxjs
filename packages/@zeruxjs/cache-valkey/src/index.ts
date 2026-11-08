import type {CacheHelperFactory} from '@zeruxjs/cache';
import {createValkeyCacheHelper,helperPolicy,helperKeys,integer,keys,fail} from './helper.js';
import type {ValkeyClient,ValkeyConnectionOptions} from './types.js';
export * from './types.js';
export {ValkeyCacheHelper,ValkeyCacheError,createValkeyCacheHelper} from './helper.js';
export interface ValkeyClientConstructors {
 standalone(options:Record<string,unknown>,url?:string):ValkeyClient&{connect():Promise<unknown>};
 cluster(nodes:{host:string;port:number}[],options:Record<string,unknown>):ValkeyClient&{connect():Promise<unknown>};
}
const connectionKeys=['client','url','host','port','username','password','db','tls','cluster','connectTimeoutMs','maxReconnectAttempts'];
// eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
const host=(value:unknown)=>{if(typeof value!=='string'||!value.length||value.length>253||/[\s\x00-\x1f\x7f]/.test(value))throw fail('VALKEY_INVALID_CONNECTION');return value;};
function tls(value:ValkeyConnectionOptions['tls']){
 if(value===undefined)return;keys(value,['ca','cert','key','servername']);for(const key of ['ca','cert','key'] as const){const entries=value[key]===undefined?[]:Array.isArray(value[key])?value[key]:[value[key]];if(entries.length>8||entries.some(text=>typeof text!=='string'||!text.length||Buffer.byteLength(text)>65536))throw fail('VALKEY_INVALID_TLS');}if(value.servername!==undefined)host(value.servername);return {...value,...(Array.isArray(value.ca)?{ca:[...value.ca]}:{}),rejectUnauthorized:true};
}
/** Lazy driver import; no client/socket exists until this explicitly configured factory is invoked. */
export async function createCacheHelper(raw:ValkeyConnectionOptions={},injected?:ValkeyClientConstructors){
 keys(raw,[...helperKeys,...connectionKeys]);const helper=Object.fromEntries(helperKeys.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,(raw as Record<string,unknown>)[key]]));helperPolicy(helper);
 const connectTimeout=integer(raw.connectTimeoutMs??3000,1,120000),reconnect=integer(raw.maxReconnectAttempts??0,0,3);
 if(raw.client){if(connectionKeys.some(key=>!['client','connectTimeoutMs','maxReconnectAttempts'].includes(key)&&Object.hasOwn(raw,key)))throw fail('VALKEY_CONFLICTING_CONNECTION');return createValkeyCacheHelper(raw.client,helper);}
 if(raw.ownClient===false)throw fail('VALKEY_CONFLICTING_OWNERSHIP');
 const nativeTls=tls(raw.tls);let url:string|undefined;
 // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
 if(raw.url!==undefined){if(typeof raw.url!=='string'||raw.url.length>4096||/[\x00-\x1f\x7f]/.test(raw.url))throw fail('VALKEY_INVALID_URL');let parsed:URL;try{parsed=new URL(raw.url);}catch{throw fail('VALKEY_INVALID_URL');}if(!['redis:','rediss:'].includes(parsed.protocol)||!parsed.hostname||parsed.search||parsed.hash||!/^\/(?:\d{1,10})?$/.test(parsed.pathname||'/')||Number(parsed.pathname.slice(1)||0)>2147483647)throw fail('VALKEY_INVALID_URL');if(['host','port','username','password','db','cluster'].some(key=>Object.hasOwn(raw,key)))throw fail('VALKEY_CONFLICTING_CONNECTION');if(nativeTls&&parsed.protocol!=='rediss:')throw fail('VALKEY_INVALID_TLS');url=raw.url;}
 // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
 if(raw.host!==undefined)host(raw.host);if(raw.port!==undefined)integer(raw.port,1,65535);if(raw.db!==undefined)integer(raw.db,0,2147483647);for(const field of ['username','password'] as const)if(raw[field]!==undefined&&(typeof raw[field]!=='string'||raw[field]!.length>4096||/[\x00-\x1f\x7f]/.test(raw[field]!)))throw fail('VALKEY_INVALID_CONNECTION');
 let nodes:{host:string;port:number}[]|undefined;
 if(raw.cluster){keys(raw.cluster,['nodes']);if(['url','host','port','db'].some(key=>Object.hasOwn(raw,key)))throw fail('VALKEY_CONFLICTING_CONNECTION');if(!Array.isArray(raw.cluster.nodes)||!raw.cluster.nodes.length||raw.cluster.nodes.length>32)throw fail('VALKEY_INVALID_CLUSTER');nodes=raw.cluster.nodes.map(node=>{keys(node,['host','port']);return {host:host(node.host),port:integer(node.port,1,65535)};});}
 let constructors=injected;
 if(!constructors){try{const module=await import('iovalkey');constructors={standalone(options,url){return (url?new module.Valkey(url,options):new module.Valkey(options)) as unknown as ReturnType<ValkeyClientConstructors['standalone']>;},cluster(nodes,options){return new module.Cluster(nodes,options) as unknown as ReturnType<ValkeyClientConstructors['cluster']>;}};}catch(cause){throw fail('VALKEY_DRIVER_UNAVAILABLE',cause);}}
 let attempts=0,clusterAttempts=0;
 const connection={...(raw.username!==undefined?{username:raw.username}:{}),...(raw.password!==undefined?{password:raw.password}:{}),...(raw.db!==undefined?{db:raw.db}:{}),...(nativeTls?{tls:nativeTls}:{}),connectTimeout,lazyConnect:true,enableOfflineQueue:false,maxRetriesPerRequest:0,autoResendUnfulfilledCommands:false,reconnectOnError:null,stringNumbers:true,retryStrategy:()=>++attempts<=reconnect?Math.min(attempts*50,250):null};
 let client:ValkeyClient&{connect():Promise<unknown>};try{client=nodes?constructors.cluster(nodes,{lazyConnect:true,enableOfflineQueue:false,maxRedirections:0,scaleReads:'master',redisOptions:connection,clusterRetryStrategy:()=>++clusterAttempts<=reconnect?Math.min(clusterAttempts*50,250):null}):constructors.standalone({...connection,...(!url?{host:raw.host??'127.0.0.1',port:raw.port??6379}:{})},url);}catch(cause){throw fail('VALKEY_CONNECT_FAILED',cause);}
 const silent=()=>{};client.on('error',silent);let adapter:ReturnType<typeof createValkeyCacheHelper>|undefined;
 try{adapter=createValkeyCacheHelper(client,{...helper,ownClient:true});let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([client.connect(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{client.disconnect(false);reject(fail('VALKEY_CONNECT_DEADLINE'));},connectTimeout);})]);}finally{if(timer)clearTimeout(timer);}client.off('error',silent);return adapter;}
 catch(cause){client.disconnect(false);try{await adapter?.close();}catch{/* Original initialization cause retained privately. */}client.off('error',silent);throw fail('VALKEY_CONNECT_FAILED',cause);}
}
export default createCacheHelper;
const factory:CacheHelperFactory=createCacheHelper;void factory;
