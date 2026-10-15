import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaStore, createSignedMediaToken, verifySignedMediaToken } from '../dist/index.js';
test('streamed uploads, integrity, expiry cleanup and metadata', async () => {
 const dir=await mkdtemp(join(tmpdir(),'zerux-media-'));
 try {
   const store=createMediaStore(dir,100);
   const meta=await store.uploadStream((async function*(){yield Buffer.from('abc');yield Buffer.from('123');})(),{name:'test.txt',contentType:'text/plain'});
   assert.equal(meta.size,6); assert.equal((await store.download(meta.id)).data.toString(),'abc123');
   assert.equal((await store.list()).length,1); assert.equal((await store.exists(meta.id)),true);
   let streamed=''; for await (const chunk of store.stream(meta.id)) streamed+=chunk.toString(); assert.equal(streamed,'abc123');
   await assert.rejects(()=>store.uploadStream([Buffer.from('123456')],{name:'too-big.txt',contentType:'text/plain',maxBytes:3}),RangeError);
   const exp=await store.upload(Buffer.from('x'),{name:'exp',contentType:'text/plain',expiresInMs:1});
   await new Promise(resolve=>setTimeout(resolve,5)); assert.equal(await store.exists(exp.id),false);
   const cleanup=await store.cleanupExpired(); assert.equal(cleanup.removed,1);
   await store.remove(meta.id); assert.equal(await store.exists(meta.id),false);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('signed tokens detect tampering and expiration', async () => {
 const id='0c949a20-8e3c-42fe-a108-889114145172'; const secret='secret-with-at-least-16-characters';
 const token=createSignedMediaToken(id,secret,Date.now()+50000);
 assert.equal(verifySignedMediaToken(token,secret),id);
 assert.equal(verifySignedMediaToken(token.slice(0,-2)+'ab',secret),null);
 assert.equal(verifySignedMediaToken(token,secret,Date.now()+60000),null);
});
