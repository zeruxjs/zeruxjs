import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFileManager,createLocalStorage,createFileResponse,createFileHttpHandler,createFileTokenAuthorizer,createFilesClient} from '../dist/index.js';
async function setup(fn){const root=await mkdtemp(join(tmpdir(),'zx-files-http-'));const manager=createFileManager({stores:[{name:'local',driver:createLocalStorage({root})}]});try{await fn(manager);}finally{await manager.close();await rm(root,{recursive:true,force:true});}}
const address={bucket:'my-bucket',key:'document.txt'};
test('HTTP downloads: private auth, HEAD, ETag, suffix range, unsatisfiable range and cache headers',()=>setup(async manager=>{
 await manager.put(address,Buffer.from('0123456789'),{visibility:'private',contentType:'text/plain'});
 const req=(method='GET',headers={})=>new Request('https://files.example/document.txt',{method,headers});
 assert.equal((await createFileResponse(manager,address,req())).status,403);
 const authorize=()=>true;
 const response=await createFileResponse(manager,address,req(),{authorize});
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(await response.text(),'0123456789');
 const etag=response.headers.get('etag');assert.equal((await createFileResponse(manager,address,req('GET',{'If-None-Match':etag}),{authorize})).status,304);
 const head=await createFileResponse(manager,address,req('HEAD'),{authorize});assert.equal(head.headers.get('content-length'),'10');assert.equal(head.body,null);
 const range=await createFileResponse(manager,address,req('GET',{Range:'bytes=-4'}),{authorize});assert.equal(range.status,206);assert.equal(await range.text(),'6789');
 const invalid=await createFileResponse(manager,address,req('GET',{Range:'bytes=100-105'}),{authorize});assert.equal(invalid.status,416);
}));
test('HTTP handler streams arbitrary binary, requires writes authorization and prevents encoded bodies',()=>setup(async manager=>{
 const authorize=(req,a,action)=>req.headers.get('authorization')==='Bearer good';
 const handler=createFileHttpHandler(manager,{bucket:'my-bucket',authorize,maxUploadBytes:2*1024*1024,allowDelete:true});
 const content=Buffer.alloc(1024*1024+55,213);
 const fail=await handler(new Request('https://files.example/data.bin',{method:'PUT',body:content}));assert.equal(fail.status,403);
 const headers={Authorization:'Bearer good','Content-Type':'application/octet-stream'};
 const uploaded=await handler(new Request('https://files.example/data.bin',{method:'PUT',headers,body:content}));assert.equal(uploaded.status,201);
 assert.equal((await uploaded.json()).size,content.length);
 const read=await handler(new Request('https://files.example/data.bin',{headers}));assert.equal(read.status,200);assert.deepEqual(Buffer.from(await read.arrayBuffer()),content);
 assert.equal((await handler(new Request('https://files.example/data.bin',{method:'DELETE',headers}))).status,204);
 assert.equal((await handler(new Request('https://files.example/data.bin',{headers}))).status,404);
 const encoded=await handler(new Request('https://files.example/data.bin',{method:'PUT',headers:{...headers,'Content-Encoding':'gzip'},body:'abc'}));assert.equal(encoded.status,400);
}));
test('token authorizer uses scoped bearer tokens and optional public reads',async()=>{
 const verifier={verify(token,scope){return token==='zx_demo'&&scope==='files:read:my-bucket'?{subject:'alice',scopes:[scope]}:null;}};
 const auth=createFileTokenAuthorizer(verifier);
 assert.equal(await auth(new Request('https://x',{}),address,'read'),false);
 assert.equal(await auth(new Request('https://x',{headers:{Authorization:'Bearer zx_demo'}}),address,'read'),true);
 assert.equal(await auth(new Request('https://x',{headers:{Authorization:'Bearer zx_demo'}}),address,'write'),false);
 assert.equal(await createFileTokenAuthorizer(verifier,{publicRead:true})(new Request('https://x'),address,'read',{visibility:'public'}),true);
});
test('browser Fetch client supports upload/download/ranges with mocked Fetch routes',()=>setup(async manager=>{
 const handler=createFileHttpHandler(manager,{bucket:'my-bucket',authorize:()=>true});
 const client=createFilesClient({baseUrl:'https://files.example/',fetch:(url,init)=>handler(new Request(url,init))});
 const bytes=Buffer.from([0,255,1,2]);
 const created=await client.upload('folder/data.bin',bytes);assert.equal(created.size,4);
 const response=await client.download('folder/data.bin',{range:'bytes=1-2'});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from([255,1]));
 assert.deepEqual(Buffer.from(await client.bytes('folder/data.bin')),bytes);
 assert.equal(client.head('folder/data.bin') instanceof Promise,true);
}));
test('stream Content-Length mismatch rejects before creating an object',()=>setup(async manager=>{
 const {uploadFileRequest}=await import('../dist/index.js');
 const id={bucket:'my-bucket',key:'mismatch.bin'};
 for(const [declared,payload] of [['4','abc'],['2','abc']]){
  const req=new Request('https://files.example/mismatch.bin',{method:'PUT',headers:{'Content-Length':declared},body:payload});
  await assert.rejects(uploadFileRequest(manager,id,req),/length mismatch/i);
  assert.equal(await manager.stat(id),null,'length errors must not commit a file');
 }
 const existing=await manager.put(id,Buffer.from('untouched'));
 const req=new Request('https://files.example/mismatch.bin',{method:'PUT',headers:{'Content-Length':'99'},body:'abc'});
 await assert.rejects(uploadFileRequest(manager,id,req),/length mismatch|exists/i);
 assert.equal((await manager.get(id)).toString(),'untouched','failed writes never delete a pre-existing object');
}));
