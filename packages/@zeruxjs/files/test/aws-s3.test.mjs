import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createS3Storage,createFileManager,validateAwsCredentialOptions,resolveAwsCredentials} from '../dist/index.js';
const addr={bucket:'demo-bucket',key:'pictures/example.webp'};
function sdkClient(){
 const files=new Map(),requests=[];let closed=false;
 return {
   requests,files,
   get closed(){return closed;},destroy(){closed=true;},
   async send(cmd){const name=cmd.constructor.name,params=cmd.input;requests.push({name,params});const k=`${params.Bucket}/${params.Key}`;
     if(name==='HeadObjectCommand') {if(!files.has(k))throw {name:'NotFound',$metadata:{httpStatusCode:404}};const f=files.get(k);return {ContentLength:f.body.length,ContentType:f.ContentType,Metadata:f.Metadata,ETag:'"etag"',LastModified:new Date(),ServerSideEncryption:f.ServerSideEncryption};}
     if(name==='PutObjectCommand'){if(params.IfNoneMatch==='*'&&files.has(k))throw {name:'PreconditionFailed',$metadata:{httpStatusCode:412}};files.set(k,{...params,body:Buffer.from(params.Body)});return {ETag:'"etag"'};}
     if(name==='GetObjectCommand'){if(!files.has(k))throw {name:'NotFound'};const file=files.get(k).body;const match=params.Range&&/^bytes=(\d+)-(\d*)$/.exec(params.Range);const bytes=match?file.subarray(Number(match[1]),match[2]?Number(match[2])+1:undefined):file;return {Body:(async function*(){yield bytes;})()};}
     if(name==='DeleteObjectCommand'){files.delete(k);return {};}
     if(name==='ListObjectsV2Command')return {Contents:[...files].filter(([key])=>key.startsWith(params.Bucket+'/')).map(([key])=>({Key:key.split('/').slice(1).join('/')}))};
     if(name==='CopyObjectCommand'){const source=decodeURIComponent(params.CopySource);const original=files.get(source);if(!original)throw new Error('Copy source missing');files.set(k,{...original,...params,body:Buffer.from(original.body)});return {};}
     throw new Error(`Unexpected S3 command ${name}`);
   }
 };
}
test('S3-compatible endpoint and credential configuration is validated offline',async()=>{
 assert.equal(validateAwsCredentialOptions({}),undefined);
 assert.equal(await resolveAwsCredentials({},'us-east-1'),undefined);
 const creds={accessKeyId:'EXAMPLE',secretAccessKey:'SECRET'};
 assert.deepEqual(await resolveAwsCredentials({credentials:creds},'eu-west-1'),creds);
 assert.throws(()=>createS3Storage({endpoint:'http://rustfs.internal:9000'}),/HTTP S3 endpoints/);
 assert.equal(createS3Storage({region:'us-east-1',endpoint:'http://127.0.0.1:9000',allowInsecureHttp:true,credentials:creds}).kind,'aws-s3');
 assert.throws(()=>createS3Storage({endpoint:'https://admin:secret@host/'}),/Invalid S3 endpoint/);
 assert.throws(()=>createS3Storage({endpoint:'https://host:9000/?token=abc'}),/Invalid S3 endpoint/);
 assert.throws(()=>createS3Storage({credentials:creds,profile:'dev'}),/Choose exactly one/);
 assert.throws(()=>createS3Storage({assumeRole:{roleArn:'arn:aws:iam::123:role/Bad'}}),/valid IAM role ARN/);
 assert.throws(()=>createS3Storage({webIdentity:{roleArn:'invalid',tokenFile:'/tmp/token'}}),/valid IAM role ARN/);
 assert.throws(()=>createS3Storage({encryption:{mode:'SSE-C',customerKeyBase64:Buffer.alloc(32).toString('base64')},endpoint:'http://localhost:9000',allowInsecureHttp:true}),/HTTPS/);
 assert.equal(createS3Storage({assumeRole:{roleArn:'arn:aws:iam::123456789012:role/StorageReader',externalId:'tenant-id'}}).kind,'aws-s3');
});
test('S3 PutObject conditional writes, metadata, HEAD/ranges and delete use SDK commands',async()=>{
 const client=sdkClient(),storage=createS3Storage({region:'us-east-1',endpoint:'https://minio.example.com',forcePathStyle:true,client,encryption:{mode:'aws:kms',keyId:'alias/files'}});
 const manager=createFileManager({stores:[{name:'s3',driver:storage}]});
 const a={...addr,storage:'s3'};
 const info=await manager.put(a,Buffer.from('hello world'),{contentType:'text/plain',visibility:'public',cacheControl:'public, max-age=60'});
 assert.equal(info.size,11);assert.equal(info.visibility,'public');
 const request=client.requests.find(r=>r.name==='PutObjectCommand');
 assert.equal(request.params.ServerSideEncryption,'aws:kms');assert.equal(request.params.SSEKMSKeyId,'alias/files');assert.equal(request.params.IfNoneMatch,'*');
 await assert.rejects(manager.put(a,Buffer.from('overwrite')),{code:'FILE_EXISTS'});
 const parts=[];for await (const chunk of await manager.read(a,{start:6,end:10}))parts.push(chunk);assert.equal(Buffer.concat(parts).toString(),'world');
 assert.equal((await manager.list('demo-bucket')).items.length,1);
 const other={...a,key:'copy.txt'};await manager.copy(a,other,{visibility:'private'});assert.equal((await manager.stat(other)).visibility,'private');
 assert.equal(await manager.delete(a),true);assert.equal(await manager.stat(a),null);
 await manager.close();assert.equal(client.closed,false);
});
test('S3 CloudFront/public URL generation and endpoint safety do not change access policy',async()=>{
 const client=sdkClient();const storage=createS3Storage({region:'us-east-1',client,publicBaseUrl:'https://cdn.example.net/assets'});
 const url=storage.publicUrl(addr);assert.equal(url,'https://cdn.example.net/assets/demo-bucket/pictures/example.webp');
 assert.throws(()=>createS3Storage({publicBaseUrl:'http://cdn.invalid'}),/HTTPS/);
 assert.throws(()=>createS3Storage({cloudFrontSigning:{keyPairId:'abc',privateKey:'abc'}}),/requires publicBaseUrl/);
 assert.throws(()=>createS3Storage({multipart:{partSize:5,queueSize:0}}),/part size/);
 await storage.close();assert.equal(client.closed,false);
});
