import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DecipherGCM } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, link, rename, unlink, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { FileAddress, FileInfo, FileSource, ListFileOptions, FileListing, PutFileOptions, ReadFileOptions, StorageDriver } from '../types.js';
import { chunks, ensureNotExpired, validateAddress, validateBucket, validateKey, validatePut, validateRange } from '../validation.js';
export interface LocalStorageOptions {
  root: string;
  /** 32-byte application-owned AES-256-GCM key; binary or base64-encoded. */
  encryptionKey?: Uint8Array | string;
}
function failNotFound(): Error {return Object.assign(new Error('File not found'),{code:'ENOENT'});}
export function createLocalStorage(options:LocalStorageOptions):StorageDriver {
  if(!options?.root)throw new TypeError('Local storage root required');
  const root=resolve(options.root), objects=join(root,'objects'), metadata=join(root,'metadata');
  const key=options.encryptionKey === undefined ? undefined : typeof options.encryptionKey==='string' ? Buffer.from(options.encryptionKey,'base64') : Buffer.from(options.encryptionKey);
  if(key && key.byteLength!==32)throw new TypeError('AES-256-GCM requires 32-byte encryption key');
  async function secureDir(path:string,create=false){
    if(!(path===root||path.startsWith(root+sep)))throw new Error('Unsafe storage directory');
    if(create){
      if(path!==root) await secureDir(dirname(path),true);
      await mkdir(path,{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});
    }
    const current=await lstat(path);if(!current.isDirectory()||current.isSymbolicLink()||await realpath(path)!==path)throw new Error('Unsafe storage directory');
    // Check root separately even when requesting a nested directory.
    if(path!==root)await secureDir(root);
  }
  function paths(address:FileAddress){validateAddress(address);const dest=join(objects,address.bucket,...address.key.split('/'));const id=createHash('sha256').update(address.key).digest('hex');return {dest,sidecar:join(metadata,address.bucket,id+'.json')};}
  async function metadataOf(a:FileAddress):Promise<FileInfo|null>{
    const {sidecar,dest}=paths(a);
    try{
      await secureDir(dirname(sidecar));const handle=await open(sidecar,constants.O_RDONLY|constants.O_NOFOLLOW);
      try {
        const st=await handle.stat();if(!st.isFile()||st.size>16384)throw new Error('Invalid file metadata');
        const info=JSON.parse(await handle.readFile({encoding:'utf8'})) as FileInfo;
        if(info.bucket!==a.bucket||info.key!==a.key||!Number.isSafeInteger(info.size)||info.size<0||typeof info.etag!=='string'||!/^"[a-f0-9]{64}"$/.test(info.etag)||!['private','public'].includes(info.visibility)||typeof info.contentType!=='string'||typeof info.modifiedAt!=='string'||!info.metadata||typeof info.metadata!=='object')throw new Error('Corrupted file metadata');
        await secureDir(dirname(dest));const file=await open(dest,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{const physical=await file.stat();if(!physical.isFile()||physical.size!==info.size) {if(!info.encryption||physical.size!==info.size)throw new Error('File size mismatch');}}finally{await file.close();}
        return info;
      }finally{await handle.close();}
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  }
  async function atomicJson(path:string,data:unknown){
    await secureDir(dirname(path),true);
    const tmp=path+'.tmp-'+randomUUID();
    try{const handle=await open(tmp,'wx',0o600);try{await handle.writeFile(JSON.stringify(data));await handle.sync();}finally{await handle.close();}await rename(tmp,path);}
    finally{await unlink(tmp).catch(()=>{});}
  }
  const driver:StorageDriver={
    kind:'local-s3-lite',
    async put(address:FileAddress,source:FileSource,options:PutFileOptions={}){
      validatePut(options);const {dest,sidecar}=paths(address);await secureDir(dirname(dest),true);await secureDir(dirname(sidecar),true);
      if(options.ifNoneMatch!==false && await metadataOf(address))throw Object.assign(new Error('File exists'),{code:'FILE_EXISTS'});
      const tmp=dest+'.tmp-'+randomUUID();const handle=await open(tmp,'wx',0o600);
      let length=0;const hash=createHash('sha256');const iv=key?randomBytes(12):undefined;
      const cipher=key&&iv?createCipheriv('aes-256-gcm',key,iv):undefined;
      try{
        for await(const part of chunks(source,options.signal)){
          length+=part.byteLength;if(!Number.isSafeInteger(length)||length>(options.maxBytes??Number.MAX_SAFE_INTEGER))throw new RangeError('File size exceeds limit');
          hash.update(part);const encoded=cipher?cipher.update(part):part;
          if(encoded.byteLength)await handle.writeFile(encoded);
        }
        if(cipher){const tail=cipher.final();if(tail.byteLength)await handle.writeFile(tail);}
        await handle.sync();await handle.close();
        if(options.ifNoneMatch!==false){await link(tmp,dest);await unlink(tmp);}else await rename(tmp,dest);
        const info:FileInfo={bucket:address.bucket,key:address.key,size:length,etag:'"'+hash.digest('hex')+'"',contentType:options.contentType??'application/octet-stream',visibility:options.visibility??'private',modifiedAt:new Date().toISOString(),metadata:{...options.metadata},...(options.cacheControl?{cacheControl:options.cacheControl}:{}),...(options.contentDisposition?{contentDisposition:options.contentDisposition}:{}),...(options.expiresAt?{expiresAt:options.expiresAt}:{}),...(cipher&&iv?{encryption:'AES-256-GCM',rangeSupported:false,versionId:iv.toString('base64url')+'.'+cipher.getAuthTag().toString('base64url')}: {})};
        await atomicJson(sidecar,info);return info;
      }catch(err){await handle.close().catch(()=>{});throw err;}
      finally{await unlink(tmp).catch(()=>{});}
    },
    stat(address){return metadataOf(address);},
    async read(address:FileAddress,opts:ReadFileOptions={}){
      validateRange(opts);const info=await metadataOf(address);if(!info)throw failNotFound();ensureNotExpired(info);
      if(info.encryption && (opts.start!==undefined||opts.end!==undefined))throw new Error('Ranges unsupported for encrypted local objects');
      const {dest}=paths(address);await secureDir(dirname(dest));const handle=await open(dest,constants.O_RDONLY|constants.O_NOFOLLOW);
      const st=await handle.stat();if(!st.isFile()||st.size!==info.size){await handle.close();throw new Error('File size changed');}
      if(info.encryption){
        // Verify the entire AES-GCM authentication tag BEFORE emitting any bytes.
        // This is an extra streaming pass over the private file, bounded in memory.
        try{
          if(!key||!info.versionId)throw new Error('Storage encryption key unavailable');
          const [iv,tag]=info.versionId.split('.');
          const verifier=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url')) as DecipherGCM;
          verifier.setAuthTag(Buffer.from(tag,'base64url'));
          let checkOffset=0;
          while(checkOffset<info.size){
            if(opts.signal?.aborted)throw opts.signal.reason;
            const buf=Buffer.allocUnsafe(Math.min(64*1024,info.size-checkOffset));
            const {bytesRead}=await handle.read(buf,0,buf.length,checkOffset);
            if(!bytesRead)throw new Error('File truncated during decryption');
            verifier.update(buf.subarray(0,bytesRead));checkOffset+=bytesRead;
          }
          verifier.final();
        }catch(error){await handle.close();throw error;}
      }
      const start=opts.start??0;const end=Math.min(opts.end??Math.max(0,info.size-1),Math.max(0,info.size-1));
      async function* reader(){
        try{
          let decipher:DecipherGCM|undefined;
          if(info!.encryption){if(!key||!info!.versionId)throw new Error('Storage encryption key unavailable');const [iv,tag]=info!.versionId.split('.');decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url')) as DecipherGCM;decipher.setAuthTag(Buffer.from(tag,'base64url'));}
          let offset=start;while(offset<=end&&info!.size){if(opts.signal?.aborted)throw opts.signal.reason;const buf=Buffer.allocUnsafe(Math.min(64*1024,end-offset+1));const {bytesRead}=await handle.read(buf,0,buf.length,offset);if(!bytesRead)throw new Error('File truncated during read');offset+=bytesRead;const part=decipher?decipher.update(buf.subarray(0,bytesRead)):buf.subarray(0,bytesRead);if(part.byteLength)yield part;}
          if(decipher){const final=decipher.final();if(final.byteLength)yield final;}
        }finally{await handle.close();}
      }
      return reader();
    },
    async delete(a){const info=await metadataOf(a);if(!info)return false;const {dest,sidecar}=paths(a);
      for(const path of [dest,sidecar]){const item=await lstat(path);if(!item.isFile()||item.isSymbolicLink())throw new Error('Unsafe storage entry');}
      await unlink(sidecar);await unlink(dest);return true;
    },
    async list(bucket:string,options:ListFileOptions={}):Promise<FileListing>{
      validateBucket(bucket);const limit=options.limit??100;if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new RangeError('Invalid limit');
      const location=join(metadata,bucket);try{await secureDir(location);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {items:[]};throw e;}
      const all:FileInfo[]=[];for(const name of (await readdir(location)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
        try{const path=join(location,name),handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let info:FileInfo;
          try{if((await handle.stat()).size>16384)continue;info=JSON.parse(await handle.readFile({encoding:'utf8'})) as FileInfo;}finally{await handle.close();}
          if(info.bucket!==bucket||typeof info.key!=='string')continue;validateKey(info.key);
          if(options.prefix&&!info.key.startsWith(options.prefix))continue;
          const valid=await metadataOf(info);if(valid && !valid.expiresAt || valid && Date.parse(valid.expiresAt!)>Date.now())all.push(valid!);
        }catch{/* exclude broken records */}
      }
      all.sort((a,b)=>a.key.localeCompare(b.key));
      const filtered=all.filter(item=>!options.cursor||item.key>options.cursor);
      const items=filtered.slice(0,limit);return {items,nextCursor:filtered.length>limit?items.at(-1)!.key:undefined};
    }
  };
  return driver;
}
export const createS3LiteStorage=createLocalStorage;
