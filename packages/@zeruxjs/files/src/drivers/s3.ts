import { Readable } from 'node:stream';
import { resolveAwsCredentials, validateAwsCredentialOptions } from '../aws-credentials.js';
import type { AwsCredentialOptions } from '../aws-credentials.js';
import { createHash } from 'node:crypto';
import type { FileAddress, FileInfo, FileSource, PutFileOptions, ReadFileOptions, StorageDriver, ListFileOptions } from '../types.js';
import { chunks, validateAddress, validateBucket, validatePut, validateRange } from '../validation.js';

export type S3Encryption =
  | { mode: 'AES256' }
  | { mode: 'aws:kms'; keyId?: string; bucketKeyEnabled?: boolean }
  | { mode: 'SSE-C'; customerKeyBase64: string };
export interface S3StorageDriver extends StorageDriver {
  readonly kind: 'aws-s3';
  /** Trusted-server escape hatch for S3-specific lifecycle, versioning, policy and KMS commands. */
  getClient(): Promise<{ send(command:any):Promise<any>; destroy?():void }>;
}
export interface S3StorageOptions extends AwsCredentialOptions {
  /** AWS region, or signing region for MinIO/RustFS/S3-compatible endpoints. */
  region?: string;
  endpoint?: string;
  /** Defaults true for custom S3 endpoints (MinIO, RustFS, R2, Ceph), false for AWS. */
  forcePathStyle?: boolean;
  /** Opt into HTTP for trusted on-premise S3 endpoints. Never use over untrusted networks. */
  allowInsecureHttp?: boolean;
  /** AWS S3 access-point ARN region support; not available on all third-party endpoints. */
  useArnRegion?: boolean;
  /** Controls optional AWS SDK retry behavior. */
  maxAttempts?: number;

  encryption?: S3Encryption;
  /** Public custom domain / CloudFront domain. Never makes an object public by itself. */
  publicBaseUrl?: string;
  cloudFrontSigning?: { keyPairId: string; privateKey: string };
  /** CloudFront distributions may map a single bucket to their origin root. */
  publicPathStyle?: 'bucket-key'|'key-only';
  /** Use dependency-injected AWS SDK compatible client for tests or shared clients. */
  client?: { send(command: any): Promise<any>; destroy?(): void };
  /** Default false; if true, close() also destroys an injected client. */
  ownClient?: boolean;
  multipart?: { partSize?: number; queueSize?: number };
}
export function createS3Storage(options:S3StorageOptions):S3StorageDriver {
  const region=options?.region??'us-east-1';
  if(!/^[A-Za-z0-9-]{1,64}$/.test(region))throw new TypeError('Invalid S3 region');
  validateAwsCredentialOptions(options);
  if(options.maxAttempts!==undefined && (!Number.isSafeInteger(options.maxAttempts)||options.maxAttempts<1||options.maxAttempts>20))throw new RangeError('Invalid S3 retry count');
  if(options.endpoint){const parsed=new URL(options.endpoint);
    if(!['https:','http:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password||parsed.search||parsed.hash)throw new TypeError('Invalid S3 endpoint');
    if(parsed.protocol==='http:'&&!options.allowInsecureHttp)throw new TypeError('HTTP S3 endpoints require allowInsecureHttp');
    if(options.encryption?.mode==='SSE-C'&&parsed.protocol==='http:')throw new TypeError('SSE-C customer keys require HTTPS');
  }
  if(options.publicBaseUrl && (!/^https:\/\//.test(options.publicBaseUrl)||new URL(options.publicBaseUrl).username||new URL(options.publicBaseUrl).password||new URL(options.publicBaseUrl).search))throw new TypeError('Public CDN URL must use HTTPS');
  if(options.publicPathStyle&&!['bucket-key','key-only'].includes(options.publicPathStyle))throw new TypeError('Invalid CDN path style');
  if(options.cloudFrontSigning&&!options.publicBaseUrl)throw new TypeError('CloudFront signing requires publicBaseUrl');
  if(options.cloudFrontSigning&&(!options.cloudFrontSigning.keyPairId||!options.cloudFrontSigning.privateKey))throw new TypeError('CloudFront signing keys required');
  if(options.encryption?.mode==='SSE-C' && options.publicBaseUrl)throw new TypeError('SSE-C objects cannot use public CDN URLs');
  if(options.multipart?.partSize!==undefined && (!Number.isSafeInteger(options.multipart.partSize)||options.multipart.partSize<5*1024*1024||options.multipart.partSize>512*1024*1024))throw new RangeError('Invalid S3 multipart part size');
  if(options.multipart?.queueSize!==undefined && (!Number.isSafeInteger(options.multipart.queueSize)||options.multipart.queueSize<1||options.multipart.queueSize>32))throw new RangeError('Invalid S3 multipart concurrency');
  if(options.encryption?.mode==='SSE-C' && Buffer.from(options.encryption.customerKeyBase64,'base64').length!==32)throw new TypeError('SSE-C requires a base64-encoded 32-byte key');
  let client: S3StorageOptions['client']|undefined = options.client;
  let creating:Promise<NonNullable<S3StorageOptions['client']>>|undefined;
  let closed=false;
  async function getClient(){
    if(closed)throw new Error('S3 connection closed');
    if(client)return client;
    return creating??=Promise.all([import('@aws-sdk/client-s3'),resolveAwsCredentials(options,region)]).then(([{S3Client},credentials])=>client=new S3Client({region,endpoint:options.endpoint,forcePathStyle:options.forcePathStyle??!!options.endpoint,useArnRegion:options.useArnRegion,maxAttempts:options.maxAttempts,...(credentials?{credentials}:{})})).catch(error=>{creating=undefined;throw error;});
  }
  async function send(command:any){return (await getClient()).send(command);}
  function encryptionHeaders(forRead=false):Record<string,unknown>{
    switch(options.encryption?.mode){
      case 'AES256': return forRead?{}:{ServerSideEncryption:'AES256'};
      case 'aws:kms':return forRead?{}:{ServerSideEncryption:'aws:kms',SSEKMSKeyId:options.encryption.keyId,BucketKeyEnabled:options.encryption.bucketKeyEnabled};
      case 'SSE-C': {const customer=options.encryption.customerKeyBase64;return {SSECustomerAlgorithm:'AES256',SSECustomerKey:customer,SSECustomerKeyMD5:createHash('md5').update(Buffer.from(customer,'base64')).digest('base64')};}
      default:return {};
    }
  }
  function url(a:FileAddress){validateAddress(a);if(!options.publicBaseUrl)return undefined;return options.publicBaseUrl.replace(/\/$/,'')+'/' + (options.publicPathStyle==='key-only'?'':encodeURIComponent(a.bucket)+'/') + a.key.split('/').map(encodeURIComponent).join('/');}
  function metadata(meta:Record<string,string>|undefined,visibility:'private'|'public'){
    return {...meta,'zfiles-visibility':visibility};
  }
  function result(a:FileAddress,head:any):FileInfo {
    const data=head.Metadata??{};
    const user={...data};delete user['zfiles-visibility'];delete user['zfiles-expires'];
    const visibility=data['zfiles-visibility']==='public'?'public':'private';
    return {bucket:a.bucket,key:a.key,size:Number(head.ContentLength??head.Size??0),etag:String(head.ETag??'').replace(/^\"|\"$/g,'')?String(head.ETag):'',contentType:head.ContentType??'application/octet-stream',modifiedAt:(head.LastModified instanceof Date?head.LastModified:new Date(head.LastModified??Date.now())).toISOString(),visibility,metadata:user,cacheControl:head.CacheControl,contentDisposition:head.ContentDisposition,versionId:head.VersionId,rangeSupported:true,encryption:options.encryption?.mode==='SSE-C'?'SSE-C':head.ServerSideEncryption,expiresAt:data['zfiles-expires']};
  }
  async function stat(a:FileAddress):Promise<FileInfo|null>{
    validateAddress(a);const {HeadObjectCommand}=await import('@aws-sdk/client-s3');
    try{return result(a,await send(new HeadObjectCommand({Bucket:a.bucket,Key:a.key,...encryptionHeaders(true)})));}
    catch(e){const err=e as {name?:string,$metadata?:{httpStatusCode?:number}};if(['NotFound','NoSuchKey'].includes(err.name??'')||err.$metadata?.httpStatusCode===404)return null;throw e;}
  }
  const driver:S3StorageDriver={
    kind:'aws-s3',
    getClient,
    async put(a:FileAddress,source:FileSource,opts:PutFileOptions={}){
      validateAddress(a);validatePut(opts);
      if(opts.signal?.aborted)throw opts.signal.reason;
      // Streaming/unknown-length bodies require multipart upload. Conditional
      // create is best-effort here (preflight HEAD is not atomic across writers).
      const max=opts.maxBytes??Number.MAX_SAFE_INTEGER;
      if(source instanceof Uint8Array){
        if(source.byteLength>max)throw new RangeError('File size exceeds limit');
        const {PutObjectCommand}=await import('@aws-sdk/client-s3');
        const userMetadata={...opts.metadata};if(opts.expiresAt)userMetadata['zfiles-expires']=opts.expiresAt;
        try {await send(new PutObjectCommand({Bucket:a.bucket,Key:a.key,Body:source,ContentType:opts.contentType??'application/octet-stream',ContentDisposition:opts.contentDisposition,CacheControl:opts.cacheControl,Metadata:metadata(userMetadata,opts.visibility??'private'),...encryptionHeaders(),...(opts.ifNoneMatch!==false?{IfNoneMatch:'*'}:{})}));}
        catch(error){const code=(error as {name?:string;$metadata?:{httpStatusCode?:number}});if(code.name==='PreconditionFailed'||code.$metadata?.httpStatusCode===412)throw Object.assign(new Error('File exists'),{code:'FILE_EXISTS'});throw error;}
        const info=await stat(a);if(!info)throw new Error('S3 object not visible after upload');return info;
      }
      const {Upload}=await import('@aws-sdk/lib-storage');
      async function* bounded(){let bytes=0;for await(const piece of chunks(source,opts.signal)){bytes+=piece.byteLength;if(!Number.isSafeInteger(bytes)||bytes>max)throw new RangeError('File size exceeds limit');yield Buffer.from(piece);}}
      const userMetadata={...opts.metadata};if(opts.expiresAt)userMetadata['zfiles-expires']=opts.expiresAt;
      if(opts.ifNoneMatch!==false && await stat(a))throw Object.assign(new Error('File exists'),{code:'FILE_EXISTS'});
      const request={Bucket:a.bucket,Key:a.key,Body:Readable.from(bounded()),ContentType:opts.contentType??'application/octet-stream',ContentDisposition:opts.contentDisposition,CacheControl:opts.cacheControl,Metadata:metadata(userMetadata,opts.visibility??'private'),...encryptionHeaders(),...(opts.ifNoneMatch!==false?{IfNoneMatch:'*'}:{})};
      const uploader=new Upload({client:await getClient() as any,params:request,leavePartsOnError:false,partSize:options.multipart?.partSize,queueSize:options.multipart?.queueSize});
      const abort=()=>uploader.abort();opts.signal?.addEventListener('abort',abort,{once:true});
      try{await uploader.done();}finally{opts.signal?.removeEventListener('abort',abort);}
      const found=await stat(a);if(!found)throw new Error('S3 object not visible after upload');return found;
    },
    stat,
    async read(a:FileAddress,opts:ReadFileOptions={}){
      validateAddress(a);validateRange(opts);const {GetObjectCommand}=await import('@aws-sdk/client-s3');
      const Range=opts.start!==undefined||opts.end!==undefined?`bytes=${opts.start??0}-${opts.end??''}`:undefined;
      const response=await send(new GetObjectCommand({Bucket:a.bucket,Key:a.key,Range,...encryptionHeaders(true)}));
      if(!response.Body)throw new Error('Missing S3 response body');
      const body=response.Body as AsyncIterable<Uint8Array>;
      async function* iterable(){for await(const part of body){if(opts.signal?.aborted)throw opts.signal.reason;yield part;}}
      return iterable();
    },
    async delete(a){validateAddress(a);const {DeleteObjectCommand}=await import('@aws-sdk/client-s3');const present=await stat(a);if(!present)return false;await send(new DeleteObjectCommand({Bucket:a.bucket,Key:a.key}));return true;},
    async list(bucket:string,opts:ListFileOptions={}){
      validateBucket(bucket);const {ListObjectsV2Command}=await import('@aws-sdk/client-s3');
      const limit=opts.limit??100;if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new RangeError('Invalid limit');
      const page=await send(new ListObjectsV2Command({Bucket:bucket,Prefix:opts.prefix,MaxKeys:limit,ContinuationToken:opts.cursor}));
      const items:FileInfo[]=[];
      for(const item of page.Contents??[]){if(item.Key){const info=await stat({bucket,key:item.Key});if(info)items.push(info);}}
      return {items,nextCursor:page.NextContinuationToken};
    },
    async copy(from,to,opts={}){
      validateAddress(from);validateAddress(to);validatePut(opts);
      const {CopyObjectCommand}=await import('@aws-sdk/client-s3');
      const source=await stat(from);if(!source)throw new Error('Source missing');
      const userMetadata={...source.metadata,...opts.metadata};if(opts.expiresAt)userMetadata['zfiles-expires']=opts.expiresAt;
      if(opts.ifNoneMatch!==false && await stat(to))throw Object.assign(new Error('File exists'),{code:'FILE_EXISTS'});
      await send(new CopyObjectCommand({Bucket:to.bucket,Key:to.key,CopySource:`${encodeURIComponent(from.bucket)}/${from.key.split('/').map(encodeURIComponent).join('/')}`,MetadataDirective:'REPLACE',ContentType:opts.contentType??source.contentType,CacheControl:opts.cacheControl??source.cacheControl,Metadata:metadata(userMetadata,opts.visibility??source.visibility),...encryptionHeaders()}));
      const found=await stat(to);if(!found)throw new Error('S3 copy failed');return found;
    },
    async signedUrl(method,a,seconds,opts){
      validateAddress(a);if(!Number.isSafeInteger(seconds)||seconds<1||seconds>604800)throw new RangeError('Invalid signing lifetime');
      if(method==='GET'&&options.cloudFrontSigning){
        const {getSignedUrl}=await import('@aws-sdk/cloudfront-signer');const cf=options.cloudFrontSigning;
        return getSignedUrl({url:url(a)!,keyPairId:cf.keyPairId,privateKey:cf.privateKey,dateLessThan:new Date(Date.now()+seconds*1000).toISOString()});
      }
      const s3=await import('@aws-sdk/client-s3');const {getSignedUrl}=await import('@aws-sdk/s3-request-presigner');
      const command=method==='GET'?new s3.GetObjectCommand({Bucket:a.bucket,Key:a.key,...encryptionHeaders(true)}):new s3.PutObjectCommand({Bucket:a.bucket,Key:a.key,ContentType:opts?.contentType,...encryptionHeaders()});
      return getSignedUrl(await getClient() as any,command,{expiresIn:seconds});
    },
    publicUrl:url,
    async close(){closed=true;const existing=client??await creating?.catch(()=>undefined);if((!options.client||options.ownClient)&&existing?.destroy)existing.destroy();}
  };
  return driver;
}
