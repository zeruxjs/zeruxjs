import type {StoredMedia} from './types.js';
import type {MediaStore} from './store.js';
import {mediaRequestBody} from './request-body.js';
export interface MediaRequestUploadOptions {name?:string;maxBytes?:number;expiresInMs?:number}
/** Raw bounded request upload; the host authenticates/authorizes before invoking it. */
export async function uploadMediaRequest(store:MediaStore,request:Request,options:MediaRequestUploadOptions={}):Promise<StoredMedia>{
 try{const body=mediaRequestBody(request,options);return await store.uploadStream(body.source,{name:options.name??'upload',contentType:body.contentType,maxBytes:options.maxBytes,expiresInMs:options.expiresInMs});}
 catch(error){await request.body?.cancel().catch(()=>{});throw error;}
}
