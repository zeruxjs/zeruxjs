import { randomUUID } from 'node:crypto';
import { createFileResponse, uploadFileRequest } from '@zeruxjs/files';
import type { StorageManager, FileInfo, FileAddress } from '@zeruxjs/files';

export interface MediaFilesOptions {
  storage?: string;
  bucket: string;
  /** Files are stored as <prefix>/<random UUID>. No user-provided path is trusted. */
  prefix?: string;
  maxUploadBytes?: number;
  /** Default visibility is private, even for images. */
  visibility?: 'private'|'public';
  authorize?: (request: Request, address: FileAddress, action: 'read'|'write'|'delete', info?: FileInfo) => boolean|Promise<boolean>;
}
/**
 * Modern media backend: stores bytes with @zeruxjs/files (local S3-lite or any S3 connection).
 * The original MediaStore is retained for legacy on-disk IDs and file layout.
 * The framework must authenticate the calling user before invoking upload/delete.
 */
export function createMediaFilesService(manager: StorageManager, options: MediaFilesOptions) {
  if(!options?.bucket)throw new TypeError('Media storage bucket required');
  const prefix=options.prefix??'media/';
  if(prefix && (!/^[A-Za-z0-9_/-]+\/$/.test(prefix)||prefix.includes('..')||prefix.startsWith('/')))throw new TypeError('Invalid media prefix');
  const address=(id:string):FileAddress=>{
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new TypeError('Invalid media ID');
    return {storage:options.storage,bucket:options.bucket,key:prefix+id};
  };
  return {
    async upload(request:Request, uploadOptions:{name?:string;maxBytes?:number;expiresAt?:string}={}) {
      const id=randomUUID(), target=address(id);
      if(!options.authorize||!await options.authorize(request,target,'write'))throw Object.assign(new Error('Media upload forbidden'),{code:'FORBIDDEN'});
      const rawName=uploadOptions.name??'upload';
      if(rawName.length>180||/[\x00-\x1f\x7f]/.test(rawName))throw new TypeError('Unsafe upload name');
      const info=await uploadFileRequest(manager,target,request,{
        maxBytes:Math.min(uploadOptions.maxBytes??Number.MAX_SAFE_INTEGER,options.maxUploadBytes??16*1024*1024),
        metadata:{originalName:rawName},visibility:options.visibility??'private',expiresAt:uploadOptions.expiresAt
      });
      return {id,info};
    },
    // Trusted server-side operations; use statAuthorized/listAuthorized for
    // request-facing APIs so private metadata cannot be enumerated.
    async stat(id:string){return manager.stat(address(id));},
    async statAuthorized(id:string,request:Request){
      const target=address(id);const info=await manager.stat(target);
      if(!info)return null;
      if(!options.authorize||!await options.authorize(request,target,'read',info))
        throw Object.assign(new Error('Media read forbidden'),{code:'FORBIDDEN'});
      return info;
    },
    async download(id:string,request:Request,opts:{inline?:boolean;downloadName?:string}={}){
      return createFileResponse(manager,address(id),request,{...opts,authorize:options.authorize});
    },
    async remove(id:string,request:Request){
      const target=address(id);
      if(!options.authorize||!await options.authorize(request,target,'delete'))throw Object.assign(new Error('Media delete forbidden'),{code:'FORBIDDEN'});
      return manager.delete(target);
    },
    async list(opts:{limit?:number;cursor?:string}={}){
      const result=await manager.list(options.bucket,{storage:options.storage,prefix,limit:opts.limit,cursor:opts.cursor});
      return {...result,items:result.items.map(info=>({...info,id:info.key.slice(prefix.length)}))};
    },
    async listAuthorized(request:Request,opts:{limit?:number;cursor?:string}={}){
      if(!options.authorize)throw Object.assign(new Error('Media listing forbidden'),{code:'FORBIDDEN'});
      const result=await manager.list(options.bucket,{storage:options.storage,prefix,limit:opts.limit,cursor:opts.cursor});
      const visible=[];let denied=false;
      for(const info of result.items){
        if(await options.authorize(request,{storage:options.storage,bucket:options.bucket,key:info.key},'read',info))
          visible.push({...info,id:info.key.slice(prefix.length)});
        else denied=true;
      }
      // Backend page cursors can contain the last raw object key. Suppress
      // them when that page contained unauthorized objects, rather than
      // disclosing another tenant's key via pagination metadata.
      return {items:visible,...(!denied&&result.nextCursor?{nextCursor:result.nextCursor}:{})};
    },
    address
  };
}
