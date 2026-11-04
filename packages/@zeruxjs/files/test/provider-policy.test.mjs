import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createS3Storage,createLocalStorage,createFileManager,monitorAwsCredentials,resolveAwsCredentials,validateAwsCredentialOptions,createFileResponse} from '../dist/index.js';
const address={bucket:'test-bucket',key:'tenant/document.txt'};
const credentials={accessKeyId:'EXAMPLE',secretAccessKey:'FIXTURE_ONLY'};
test('Roles Anywhere selects only a trusted process profile and remains inert until called',async()=>{
 assert.equal(typeof await resolveAwsCredentials({rolesAnywhere:{profile:'roles-anywhere'}},'us-east-1'),'function');
 for(const other of [{profile:'default'},{credentials},{assumeRole:{roleArn:'arn:aws:iam::123456789012:role/Test'}},{webIdentity:{roleArn:'arn:aws:iam::123456789012:role/Test',tokenFile:'/unused'}}]){
  assert.throws(()=>validateAwsCredentialOptions({rolesAnywhere:{profile:'trusted'},...other}),/one top-level/);
 }
 assert.throws(()=>validateAwsCredentialOptions({rolesAnywhere:{profile:'../untrusted'}}),/profile/);
});
test('credential refresh results retain expiry and report only fixed diagnostics, allowing retry after failure',async()=>{
 let calls=0;const events=[];
 const provider=monitorAwsCredentials(async()=>{if(++calls===2)throw new Error('PRIVATE_SECRET');return {...credentials,expiration:new Date(Date.now()+60000)};},event=>events.push(event));
 assert.ok((await provider()).expiration instanceof Date);
 await assert.rejects(provider(),error=>error.code==='CREDENTIALS_FAILED'&&error.message==='AWS credential resolution failed'&&error.cause.message==='PRIVATE_SECRET');
 assert.ok(await provider());assert.equal(calls,3);
 assert.deepEqual(events.map(e=>e.status),['expiring','failed','expiring']);
 assert.doesNotMatch(JSON.stringify(events),/PRIVATE|EXAMPLE|FIXTURE/);
 await assert.rejects(monitorAwsCredentials(async()=>({...credentials,expiration:new Date(0)}))(),{code:'CREDENTIALS_EXPIRED'});
 await assert.rejects(monitorAwsCredentials(async()=>({...credentials,expiration:'bad'}))(),{code:'CREDENTIALS_FAILED'});
 assert.ok(await monitorAwsCredentials(async()=>credentials,()=>{throw new Error('observer');})());
});
test('capability checks deny unverified endpoints and unsafe create-only copy/multipart before dispatch',async()=>{
 let sends=0;const client={send:async()=>{sends++;throw new Error('must not dispatch');}};
 const storage=createS3Storage({endpoint:'https://objects.example',client});
 assert.equal(storage.capabilities.range,'unknown');assert.ok(Object.isFrozen(storage.capabilities));
 await assert.rejects(storage.put(address,new Uint8Array([1])),{code:'UNSUPPORTED_CAPABILITY'});
 await assert.rejects(storage.read(address,{start:0}),{code:'UNSUPPORTED_CAPABILITY'});
 await assert.rejects(storage.signedUrl('GET',address,10),{code:'UNSUPPORTED_CAPABILITY'});
 await assert.rejects(storage.copy(address,{...address,key:'other'}),{code:'UNSUPPORTED_CAPABILITY'});
 const aws=createS3Storage({client});
 await assert.rejects(aws.put(address,(async function*(){yield new Uint8Array([1]);})()),{code:'UNSUPPORTED_CAPABILITY'});
 await assert.rejects(aws.signedUrl('POST',address,1),/signed method/);
 assert.equal(sends,0);await storage.close();await aws.close();
});
test('endpoint approvals, encryption modes and CDN fragments reject at configuration',()=>{
 assert.throws(()=>createS3Storage({endpoint:'https://other.example',allowedEndpointOrigins:['https://approved.example']}),/not approved/);
 assert.throws(()=>createS3Storage({endpoint:'https://approved.example/path'}),/paths/);
 assert.throws(()=>createS3Storage({encryption:{mode:'ROT13'}}),/encryption/);
 assert.throws(()=>createS3Storage({publicBaseUrl:'https://cdn.example/#private'}),/HTTPS/);
 assert.throws(()=>createS3Storage({providerCapabilities:{range:'maybe'}}),/capabilities/);
 for(const endpoint of ['', 'https://objects.\nexample', 'PRIVATE_SECRET'])assert.throws(()=>createS3Storage({endpoint}),error=>error.message==='Invalid S3 endpoint'&&!error.message.includes('PRIVATE'));
 assert.throws(()=>createS3Storage({client:{send:async()=>({})},credentials}),/own their credential/);
});
test('owned SDK clients pin endpoints/region redirects and close once; injected clients stay borrowed',async()=>{
 const owned=createS3Storage({credentials,endpoint:'https://objects.example',allowedEndpointOrigins:['https://objects.example']});
 const client=await owned.getClient();assert.equal(client.config.followRegionRedirects,false);
 assert.equal((await client.config.endpoint()).hostname,'objects.example');
 let destroyed=0;const original=client.destroy.bind(client);client.destroy=()=>{destroyed++;original();};
 await Promise.all([owned.close(),owned.close()]);assert.equal(destroyed,1);
 await assert.rejects(owned.getClient(),/closed/);
 assert.throws(()=>owned.publicUrl(address),/closed/);
 const injected={send:async()=>({}),destroy(){destroyed++;}};
 await createS3Storage({client:injected}).close();assert.equal(destroyed,1);
 const transferred=createS3Storage({client:injected,ownClient:true});await Promise.all([transferred.close(),transferred.close()]);assert.equal(destroyed,2);
});
test('expiry-aware signing rejects expired credentials; signing still requires application route authorization',async()=>{
 const expired=createS3Storage({credentials:{...credentials,expiration:new Date(0)}});
 await assert.rejects(expired.signedUrl('GET',address,60),{code:'CREDENTIALS_EXPIRED'});await expired.close();
 const root=await mkdtemp(join(tmpdir(),'zx-files-policy-'));
 const local=createLocalStorage({root});const manager=createFileManager({stores:[{name:'local',driver:local,allowedBuckets:['test-bucket'],keyPrefix:'tenant/'}]});
 try{
  assert.equal(local.capabilities.signedUrls,false);
  await manager.put(address,new Uint8Array([1]));
  await assert.rejects(manager.stat({...address,bucket:'other-bucket'}),/Bucket not allowed/);
  await assert.rejects(manager.stat({...address,key:'another/secret'}),/Key not allowed/);
  let authorized=0;
  const response=await createFileResponse(manager,address,new Request('https://app.example/document?X-Amz-Signature=own-signature&X-Amz-Expires=1'),{authorize:()=>{authorized++;return false;}});
  assert.equal(response.status,403);assert.equal(authorized,1);
  await assert.rejects(manager.signedUrl('GET',address,0),/lifetime/);
  await assert.rejects(manager.signedUrl('GET',address,60),/unsupported/);
 }finally{await manager.close();await rm(root,{recursive:true,force:true});}
 await assert.rejects(manager.stat(address),/closed/);
});
test('signed PUT cannot bypass read-only or manager type/size policies',async()=>{
 let calls=0;const driver={kind:'fixture',signedUrl:async()=>{calls++;return 'unused';}};
 for(const policy of [{readonly:true},{maxBytes:100},{allowedTypes:['text/plain']}]){
  const manager=createFileManager({stores:[{name:'test',driver,...policy}]});
  await assert.rejects(manager.signedUrl('PUT',address,60));await manager.close();
 }
 assert.equal(calls,0);
});
test('official presigner encodes bounded lifetime and create-only PUT headers without network',async()=>{
 const storage=createS3Storage({credentials});
 try{
  const signed=new URL(await storage.signedUrl('GET',address,1));
  assert.equal(signed.searchParams.get('X-Amz-Expires'),'1');
  const put=new URL(await storage.signedUrl('PUT',address,60,{contentType:'text/plain'}));
  assert.match(put.searchParams.get('X-Amz-SignedHeaders'),/if-none-match/);
  await assert.rejects(storage.signedUrl('PUT',address,60,{maxBytes:1024}),/cannot enforce/);
  await assert.rejects(storage.put(address,new Uint8Array([1]),{ifNoneMatch:'false'}),/condition/);
 }finally{await storage.close();}
 const racing=createS3Storage({credentials});const creating=racing.getClient();
 const closing=racing.close();await assert.rejects(creating,/closed/);await closing;
});
