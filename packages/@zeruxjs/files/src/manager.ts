import type { FileAddress, FileInfo, FileSource, PutFileOptions, ReadFileOptions, ListFileOptions, StorageManager, StorageManagerOptions, StorageDefinition, StorageDriver } from './types.js';
import { chunks, validateAddress, validateBucket, validateKey, validatePut, validateRange, ensureNotExpired } from './validation.js';
import { FileByteCache } from './cache.js';
export function createFileManager(options: StorageManagerOptions): StorageManager {
  if (!options?.stores?.length) throw new TypeError('At least one storage connection required');
  const stores = new Map<string,StorageDefinition>();
  for (const store of options.stores) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(store.name) || stores.has(store.name) || !store.driver) throw new TypeError('Invalid or duplicate storage connection');
    if(store.allowedBuckets && (!store.allowedBuckets.length||store.allowedBuckets.some(b=>{try{validateBucket(b);return false;}catch{return true;}})))throw new TypeError('Invalid bucket policy');
    if(store.keyPrefix!==undefined && store.keyPrefix!=='' && !store.keyPrefix.endsWith('/'))throw new TypeError('Key prefix must end with /');
    stores.set(store.name,store);
  }
  const fallback = options.defaultStorage ?? options.stores[0].name;
  if (!stores.has(fallback)) throw new TypeError('Unknown default storage');
  const cache = options.cache ? new FileByteCache(options.cache.maxEntries,options.cache.maxBytes,options.cache.ttlMs) : null;
  let closed = false;
  function resolve(address: FileAddress) {
    if (closed) throw new Error('File manager closed');
    validateAddress(address);
    const name=address.storage ?? fallback;
    const connection=stores.get(name);
    if(!connection)throw new Error(`Unknown storage: ${name}`);
    if(connection.allowedBuckets && !connection.allowedBuckets.includes(address.bucket))throw new Error('Bucket not allowed by storage policy');
    if(connection.keyPrefix && !address.key.startsWith(connection.keyPrefix))throw new Error('Key not allowed by storage policy');
    return {name,connection,address:{...address,storage:name}};
  }
  const cacheKey=(a:FileAddress)=>`${a.storage ?? fallback}\0${a.bucket}\0${a.key}`;
  const invalidate=(a?:FileAddress)=>a?cache?.deletePrefix(cacheKey(a)+':'):cache?.clear();
  const manager:StorageManager = {
    getDriver(name?:string):StorageDriver { if(closed) throw new Error('File manager closed'); const result=stores.get(name??fallback); if(!result) throw new Error('Unknown storage');return result.driver; },
    async put(address:FileAddress,data:FileSource,opts:PutFileOptions={}) {
      const {name,connection,address:a}=resolve(address); validatePut(opts);
      if (connection.readonly) throw new Error('Storage is read-only');
      if (connection.allowedTypes?.length && !connection.allowedTypes.some(pattern=>pattern.endsWith('/*') ? opts.contentType?.startsWith(pattern.slice(0,-1)) : opts.contentType===pattern)) throw new Error('Content type not allowed');
      const max=Math.min(opts.maxBytes??Number.MAX_SAFE_INTEGER,connection.maxBytes??Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('Invalid storage size limit');
      async function* bounded(){let count=0;for await(const part of chunks(data,opts.signal)){count+=part.byteLength;if(!Number.isSafeInteger(count)||count>max)throw new RangeError('File size exceeds limit');yield part;}}
      const stored=await connection.driver.put(a,bounded(),{...opts,maxBytes:max});invalidate(a);return {...stored,storage:name};
    },
    async stat(address:FileAddress){const {name,connection,address:a}=resolve(address);const info=await connection.driver.stat(a);if(!info)return null;ensureNotExpired(info);return {...info,storage:name};},
    async read(address:FileAddress, opts:ReadFileOptions={}){validateRange(opts);const {connection,address:a}=resolve(address); const info=await manager.stat(a);if(!info)throw Object.assign(new Error('File not found'),{code:'ENOENT'});return connection.driver.read(a,opts);},
    async get(address:FileAddress,maxBytes=16*1024*1024){
      if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new RangeError('Invalid read limit');
      const info=await manager.stat(address);if(!info)throw Object.assign(new Error('File not found'),{code:'ENOENT'});
      if(info.size>maxBytes)throw new RangeError('File exceeds read limit');
      const key=cacheKey(address)+':'+info.etag;
      if(cache && info.visibility==='public' && !info.encryption){const found=cache.get(key);if(found)return found;}
      const iterable=await manager.read(address);let size=0;const parts:Uint8Array[]=[];
      for await(const part of iterable){size+=part.byteLength;if(size>maxBytes)throw new RangeError('File exceeds read limit');parts.push(part);}
      const result=Buffer.concat(parts,size);if(size!==info.size)throw new Error('File changed during read');
      if(cache && info.visibility==='public' && !info.encryption)cache.set(key,result);
      return result;
    },
    async exists(address:FileAddress){return (await manager.stat(address))!==null;},
    async setVisibility(address:FileAddress,visibility:'private'|'public'){
      if(!['private','public'].includes(visibility))throw new TypeError('Invalid visibility');
      return manager.copy(address,address,{visibility,ifNoneMatch:false});
    },
    async move(from:FileAddress,to:FileAddress,opts:PutFileOptions={}){
      if(cacheKey(from)===cacheKey(to))throw new TypeError('Cannot move a file onto itself');
      const result=await manager.copy(from,to,opts);
      // Not an atomic transaction across stores: if source deletion fails,
      // the copied destination is preserved and the error is propagated.
      await manager.delete(from);
      return result;
    },
    async delete(address:FileAddress){const {connection,address:a}=resolve(address);if(connection.readonly)throw new Error('Storage is read-only');const result=await connection.driver.delete(a);invalidate(a);return result;},
    async list(bucket:string,opts:ListFileOptions&{storage?:string}={}){
      validateBucket(bucket);if(closed)throw new Error('File manager closed');
      const name=opts.storage??fallback,connection=stores.get(name);
      if(!connection)throw new Error('Unknown storage');
      if(connection.allowedBuckets&&!connection.allowedBuckets.includes(bucket))throw new Error('Bucket not allowed by storage policy');
      if(opts.prefix)validateKey(opts.prefix.endsWith('/')?opts.prefix.slice(0,-1):opts.prefix);
      if(opts.limit!==undefined&&(!Number.isSafeInteger(opts.limit)||opts.limit<1||opts.limit>1000))throw new RangeError('Invalid list limit');
      if(connection.keyPrefix && opts.prefix && !opts.prefix.startsWith(connection.keyPrefix))throw new Error('Prefix not allowed by storage policy');
      const listed=await connection.driver.list(bucket,{...opts,prefix:opts.prefix??connection.keyPrefix});
      return {...listed,items:listed.items.filter(i=>(!i.expiresAt||Date.parse(i.expiresAt)>Date.now())&&(!connection.keyPrefix||i.key.startsWith(connection.keyPrefix))).map(i=>({...i,storage:name}))};
    },
    async copy(from:FileAddress,to:FileAddress,opts:PutFileOptions={}){
      validatePut(opts);const src=resolve(from),dst=resolve(to);if(dst.connection.readonly)throw new Error('Storage is read-only');
      const info=await manager.stat(from);if(!info)throw Object.assign(new Error('File not found'),{code:'ENOENT'});
      // Streaming fallback across different drivers; never materializes the full object.
      if(src.name===dst.name && src.connection.driver.copy){const result=await src.connection.driver.copy(src.address,dst.address,opts);invalidate(dst.address);return result;}
      const stream=await manager.read(from);return manager.put(to,stream,{contentType:info.contentType,visibility:info.visibility,cacheControl:info.cacheControl,metadata:info.metadata,...opts});
    },
    async signedUrl(method,address,seconds,opts){const {connection,address:a}=resolve(address);if(!Number.isSafeInteger(seconds)||seconds<1||seconds>604800)throw new RangeError('Invalid signing lifetime');if(!connection.driver.signedUrl)throw new Error('Signed URL unsupported by storage');return connection.driver.signedUrl(method,a,seconds,opts);},
    publicUrl(address){const {connection,address:a}=resolve(address);return connection.driver.publicUrl?.(a);},
    cacheStats(){return cache?.stats()??{entries:0,bytes:0,hits:0,misses:0};}, invalidate,
    async close(){if(closed)return;closed=true;invalidate();await Promise.all([...new Set([...stores.values()].map(s=>s.driver))].map(s=>s.close?.()));}
  };
  return manager;
}
