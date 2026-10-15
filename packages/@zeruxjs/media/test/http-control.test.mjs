import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaStore, createMediaResponse } from '../dist/index.js';

async function temp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'zerux-media-http-'));
  try { await fn(dir); } finally { await rm(dir, {recursive:true,force:true}); }
}
test('GET, HEAD, ETag 304, suffix/standard byte ranges and 416', async () => temp(async dir => {
  const store = createMediaStore(dir);
  const meta = await store.upload(Buffer.from('0123456789'), {name:'a".txt',contentType:'text/plain'});
  const base = { request: new Request('https://example.test/download') };
  const response = await createMediaResponse(store,meta.id,base);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-length'),'10');
  assert.match(response.headers.get('content-disposition'), /attachment/);
  assert.doesNotMatch(response.headers.get('content-disposition'), /\r|\n/);
  assert.equal(await response.text(),'0123456789');
  const etag = response.headers.get('etag');
  const fresh = await createMediaResponse(store,meta.id,{request:new Request('https://example.test', {headers:{'if-none-match':etag}})});
  assert.equal(fresh.status,304);
  const head = await createMediaResponse(store,meta.id,{request:new Request('https://example.test',{method:'HEAD'})});
  assert.equal(head.status,200); assert.equal(head.body,null);
  for (const [header,expected] of [['bytes=2-5','2345'],['bytes=-3','789'],['bytes=9-','9']]) {
    const range = await createMediaResponse(store,meta.id,{request:new Request('https://example.test',{headers:{range:header}})});
    assert.equal(range.status,206); assert.equal(await range.text(),expected);
  }
  const bad = await createMediaResponse(store,meta.id,{request:new Request('https://example.test',{headers:{range:'bytes=999-1000'}})});
  assert.equal(bad.status,416); assert.equal(bad.headers.get('content-range'),'bytes */10');
  const noRange = await createMediaResponse(store,meta.id,{request:new Request('https://example.test',{headers:{range:'bytes=3-5','if-range':'"stale"'}})});
  assert.equal(noRange.status,200); assert.equal(await noRange.text(),'0123456789');
  const disallowed = await createMediaResponse(store,meta.id,{request:new Request('https://example.test',{method:'POST'})});
  assert.equal(disallowed.status,405);
}));
test('symlink replacement rejected for media content and metadata', async () => temp(async dir => {
  const store = createMediaStore(dir);
  const first = await store.upload(Buffer.from('hello'),{name:'sample',contentType:'text/plain'});
  const outside = join(dir,'outside'); await writeFile(outside,'sensitive');
  const path = join(dir,first.id);
  await rm(path); await symlink(outside,path);
  await assert.rejects(store.download(first.id), /ELOOP|symbolic|not permitted/i);
  await assert.rejects(async () => { for await (const chunk of store.stream(first.id)) void chunk; }, /ELOOP|symbolic|not permitted/i);
  await assert.rejects(store.remove(first.id),/Unsafe/);
  assert.equal(await readFile(outside,'utf8'),'sensitive');
  const second = await store.upload(Buffer.from('ok'),{name:'second',contentType:'text/plain'});
  await rm(join(dir,second.id+'.json'));
  await symlink(outside,join(dir,second.id+'.json'));
  await assert.rejects(store.info(second.id),/ELOOP|symbolic|not permitted/i);
}));
test('HTTP streaming supports empty bodies and caller-supplied Cache-Control', async () => temp(async dir => {
  const store=createMediaStore(dir); const media=await store.upload(Buffer.alloc(0),{name:'empty',contentType:'application/octet-stream'});
  const response=await createMediaResponse(store,media.id,{cacheControl:'public, max-age=60'});
  assert.equal(response.headers.get('cache-control'),'public, max-age=60');
  assert.equal(await response.arrayBuffer().then(a=>a.byteLength),0);
}));
test('Request stream upload is bounded and validates Content-Length',async()=>temp(async dir=>{
 const {uploadMediaRequest}=await import('../dist/index.js');
 const store=createMediaStore(dir,20);
 const req=new Request('https://example.test/media',{method:'POST',body:'hello',duplex:'half',headers:{'content-type':'text/plain','content-length':'5'}});
 const meta=await uploadMediaRequest(store,req,{name:'request.txt'});
 assert.equal((await store.download(meta.id)).data.toString(),'hello');
 const tooLarge=new Request('https://example.test/media',{method:'PUT',body:'big data',duplex:'half'});
 await assert.rejects(uploadMediaRequest(store,tooLarge,{maxBytes:3}),/size exceeds limit/);
 const mismatch=new Request('https://example.test/media',{method:'POST',body:'actual',duplex:'half',headers:{'content-length':'9'}});
 await assert.rejects(uploadMediaRequest(store,mismatch),/length mismatch/);
 assert.equal((await store.list()).length,1);
}));

test('list can opt into validated expired metadata, while reads reject expiry',async()=>temp(async dir=>{
 const store=createMediaStore(dir);
 const media=await store.upload(Buffer.from('expires'),{name:'soon',contentType:'text/plain',expiresInMs:1});
 await new Promise(r=>setTimeout(r,15));
 assert.equal((await store.list()).length,0);
 assert.equal((await store.list({includeExpired:true})).length,1);
 await assert.rejects(store.info(media.id),/expired/);
 const result=await store.cleanupExpired();assert.equal(result.removed,1);
 assert.equal((await store.list({includeExpired:true})).length,0);
}));
