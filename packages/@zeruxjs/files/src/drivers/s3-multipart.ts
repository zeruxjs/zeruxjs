import {createHash} from 'node:crypto';
import type {NativeMultipartOperations} from '../multipart-types.js';
import {validateAddress,validatePut} from '../validation.js';
/** Native SDK boundary; the resumable coordinator owns identity, journal, ordering and retries. */
export function createNativeS3Multipart(
  client:()=>Promise<{send(command:any, options?:{abortSignal?:AbortSignal}):Promise<any>}>,
  encryption:(read?:boolean)=>Record<string,unknown>,
  createOnly:boolean
):NativeMultipartOperations {
  const digest=/^[a-f0-9]{64}$/;
  function address(value:Parameters<NativeMultipartOperations['initiate']>[0],id?:string){validateAddress(value);if(id!==undefined&&(typeof id!=='string'||!id||id.length>2048||/[\x00-\x1f\x7f]/.test(id)))throw new TypeError('Invalid native upload ID');return {Bucket:value.bucket,Key:value.key,UploadId:id};}
  return Object.freeze({
    minPartBytes:5*1024*1024,createOnly,
    async initiate(value,options){
      validatePut(options);const sdk=await import('@aws-sdk/client-s3');
      const result=await(await client()).send(new sdk.CreateMultipartUploadCommand({...address(value),ContentType:options.contentType??'application/octet-stream',ContentDisposition:options.contentDisposition,CacheControl:options.cacheControl,Metadata:{...options.metadata,'zfiles-visibility':options.visibility??'private',...(options.expiresAt?{'zfiles-expires':options.expiresAt}:{})},ChecksumAlgorithm:'SHA256',ChecksumType:'COMPOSITE',...encryption()}));
      address(value,result.UploadId);if(!result.UploadId)throw new Error('Missing native upload ID');return result.UploadId;
    },
    async upload(value,id,part,bytes,signal){
      if(!Number.isSafeInteger(part.number)||part.number<1||part.number>1000||!digest.test(part.sha256)||!(bytes instanceof Uint8Array)||bytes.byteLength!==part.size||part.size<1||createHash('sha256').update(bytes).digest('hex')!==part.sha256||part.size>64*1024*1024)throw new TypeError('Invalid native upload part');
      if(signal?.aborted)throw new Error('Upload cancelled');
      const sdk=await import('@aws-sdk/client-s3');
      const checksum=Buffer.from(part.sha256,'hex').toString('base64');
      const result=await(await client()).send(new sdk.UploadPartCommand({...address(value,id),PartNumber:part.number,Body:bytes,ContentLength:part.size,ChecksumSHA256:checksum,...encryption(true)}),{abortSignal:signal});
      if(typeof result.ETag!=='string'||!result.ETag||result.ETag.length>1024||result.ChecksumSHA256!==checksum)throw new Error('Native upload integrity confirmation missing');return result.ETag;
    },
    async list(value,id,maxParts){
      if(!Number.isSafeInteger(maxParts)||maxParts<1||maxParts>1000)throw new RangeError('Invalid native part limit');
      const sdk=await import('@aws-sdk/client-s3');const result=await(await client()).send(new sdk.ListPartsCommand({...address(value,id),MaxParts:maxParts,...encryption(true)}));
      if(result.IsTruncated||(result.Parts?.length??0)>maxParts)throw new RangeError('Native part limit exceeded');
      return (result.Parts??[]).map((part:any)=>{
        if(!Number.isSafeInteger(part.PartNumber)||part.PartNumber<1||part.PartNumber>maxParts||!Number.isSafeInteger(part.Size)||part.Size<1||typeof part.ETag!=='string'||typeof part.ChecksumSHA256!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(part.ChecksumSHA256))throw new Error('Invalid native part receipt');
        return {number:part.PartNumber,size:part.Size,etag:part.ETag,sha256:Buffer.from(part.ChecksumSHA256,'base64').toString('hex')};
      });
    },
    async complete(value,id,parts,conditional,signal){
      if(typeof conditional!=='boolean'||conditional&&!createOnly)throw new Error('Native conditional multipart unsupported');
      if(!Array.isArray(parts)||!parts.length||parts.length>1000||parts.some((p,i)=>p.number!==i+1||!digest.test(p.sha256)||typeof p.etag!=='string'||!p.etag||!Number.isSafeInteger(p.size)||p.size<1||(i<parts.length-1&&p.size<5*1024*1024)))throw new TypeError('Invalid native completion parts');
      const sdk=await import('@aws-sdk/client-s3');
      try{await(await client()).send(new sdk.CompleteMultipartUploadCommand({...address(value,id),MultipartUpload:{Parts:parts.map(p=>({PartNumber:p.number,ETag:p.etag,ChecksumSHA256:Buffer.from(p.sha256,'hex').toString('base64')}))},ChecksumType:'COMPOSITE',...(conditional?{IfNoneMatch:'*'}:{}),...encryption(true)}),{abortSignal:signal});}
      catch(cause){if((cause as any)?.name==='PreconditionFailed'||(cause as any)?.$metadata?.httpStatusCode===412)throw Object.assign(new Error('File exists'),{code:'FILE_EXISTS'});throw cause;}
    },
    async abort(value,id){
      const sdk=await import('@aws-sdk/client-s3');const request=address(value,id);
      try{await(await client()).send(new sdk.AbortMultipartUploadCommand(request));}
      catch(error){if((error as any)?.name==='NoSuchUpload')return;throw error;}
      // No part writers are active under the coordinator lease; require provider confirmation.
      try{const result=await(await client()).send(new sdk.ListPartsCommand({...request,MaxParts:1}));if(result.IsTruncated||result.Parts?.length)throw new Error('Native abort is not yet complete');}
      catch(error){if((error as any)?.name!=='NoSuchUpload')throw error;}
    }
  } satisfies NativeMultipartOperations);
}
