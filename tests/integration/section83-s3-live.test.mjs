/** Opt-in real S3-compatible endpoint. Uses a precreated lab bucket or (explicitly opted in) creates a disposable random bucket.
 * Never lists outside the unique prefix or deletes preexisting data.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createS3Storage,createFileManager} from '../../packages/@zeruxjs/files/dist/index.js';
const ready=['LAB_S3_ENDPOINT','LAB_S3_BUCKET','LAB_S3_ACCESS_KEY','LAB_S3_SECRET_KEY'].every(k=>process.env[k]);
test('LIVE S3-compatible: upload, range, metadata, scoped copy and cleanup', {skip:!ready,timeout:80000},async()=>{
 const endpoint=new URL(process.env.LAB_S3_ENDPOINT);
 if(endpoint.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))throw Error('Untrusted plaintext S3 endpoint');
 const ephemeral=process.env.LAB_S3_EPHEMERAL_BUCKET==='1';
 if(ephemeral&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))throw Error('Ephemeral bucket creation requires loopback S3 endpoint');
 const bucket=ephemeral?`zerux-lab-${randomUUID().slice(0,12)}`:process.env.LAB_S3_BUCKET;
 const keyPrefix=`zerux-section83/${randomUUID()}/`;
 const store=createS3Storage({endpoint:endpoint.toString(),region:process.env.LAB_S3_REGION||'us-east-1',forcePathStyle:true,
  ...(endpoint.protocol==='http:'?{allowInsecureHttp:true}:{}),credentials:{accessKeyId:process.env.LAB_S3_ACCESS_KEY,secretAccessKey:process.env.LAB_S3_SECRET_KEY}});
 const manager=createFileManager({stores:[{name:'s3',driver:store,allowedBuckets:[bucket],keyPrefix,maxBytes:65536,allowedTypes:['text/plain']}],defaultStorage:'s3'});
 const original={storage:'s3',bucket,key:keyPrefix+'original.txt'};
 const duplicate={storage:'s3',bucket,key:keyPrefix+'copied.txt'};
 const payload=Buffer.from('Zerux package-only storage acceptance.');
 let createdBucket=false;
 try{
  if(ephemeral){const {CreateBucketCommand}=await import('@aws-sdk/client-s3');await (await store.getClient()).send(new CreateBucketCommand({Bucket:bucket}));createdBucket=true;}
  const created=await manager.put(original,payload,{visibility:'private',contentType:'text/plain',metadata:{run:'section83'}});
  assert.equal(created.size,payload.length);
  assert.equal((await manager.stat(original))?.visibility,'private');
  assert.equal(Buffer.from(await manager.get(original)).toString(),payload.toString());
  const chunks=[];for await(const chunk of await manager.read(original,{start:0,end:4}))chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(),'Zerux');
  await assert.rejects(manager.put(original,payload,{contentType:'text/plain'}),e=>e.code==='FILE_EXISTS');
  await manager.copy(original,duplicate,{visibility:'private'});
  assert.equal(Buffer.from(await manager.get(duplicate)).toString(),payload.toString());
  assert.equal((await manager.list(bucket,{prefix:keyPrefix})).items.length,2);
  await assert.rejects(manager.put({storage:'s3',bucket,key:'other-tenant/blocked.txt'},payload,{contentType:'text/plain'}));
 }finally{
  let cleanupError;
  for(const item of [duplicate,original])try{await manager.delete(item);}catch(error){cleanupError??=error;}
  if(createdBucket){try{const {DeleteBucketCommand}=await import('@aws-sdk/client-s3');await (await store.getClient()).send(new DeleteBucketCommand({Bucket:bucket}));}catch(error){cleanupError??=error;}}
  try{await manager.close();}catch(error){cleanupError??=error;}
  if(cleanupError)throw cleanupError;
 }
});
