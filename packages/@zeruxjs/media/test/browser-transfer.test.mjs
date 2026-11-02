import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMediaTransfers} from '../dist/browser.mjs';
const baseUrl='https://media.test/api/',allowedOrigins=['https://media.test'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('stream downloads honor lengths/progress/backpressure; Blob verification and URL revocation are explicit',async()=>{
 const bytes=new TextEncoder().encode('hello'),events=[],revoked=[];let created=0;
 const client=createMediaTransfers({baseUrl,allowedOrigins,fetch:async(url,init)=>{assert.equal(init.redirect,'error');assert.equal(init.credentials,'same-origin');return new Response(bytes,{headers:{'content-length':'5'}});},objectUrls:{createObjectURL(){return 'blob:fixture-'+(++created);},revokeObjectURL(url){revoked.push(url);}}});
 try{
  const parts=[];const result=await client.downloadTo('document',new WritableStream({async write(chunk){await Promise.resolve();parts.push(chunk);}}),{onProgress:p=>events.push(p)});assert.equal(result.loaded,5);assert.equal(parts.length,1);assert.deepEqual(events,[{loaded:5,total:5}]);
  const blob=await client.downloadBlob('document',{maxBytes:5,sha256:sha(bytes)});assert.equal(await blob.text(),'hello');
  const owned=client.objectUrl(blob);owned.revoke();owned.revoke();const other=client.objectUrl(blob);client.close();other.revoke();assert.deepEqual(revoked,['blob:fixture-1','blob:fixture-2']);assert.throws(()=>client.objectUrl(blob),/closed/);
 }finally{client.close();}
});
test('cancelled/failed downloads cancel readers and abort sinks; size/hash/progress failures expose no Blob',async()=>{
 let cancelled=0,aborted=0;const source=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}});
 const client=createMediaTransfers({baseUrl,allowedOrigins,fetch:async()=>new Response(source)}),controller=new AbortController();
 const work=client.downloadTo('slow',new WritableStream({abort(){aborted++;}}),{signal:controller.signal});await new Promise(r=>setTimeout(r,10));controller.abort();await assert.rejects(work,/cancelled/);assert.equal(cancelled,1);assert.equal(aborted,1);assert.equal(source.locked,false);client.close();
 for(const [headers,input,pattern] of [[{'content-length':'50'},{maxBytes:4},/limit/],[{'content-length':'5'},{maxBytes:5,sha256:'0'.repeat(64)},/integrity/],[{'content-length':'6'},{maxBytes:6},/length/]]){
  const next=createMediaTransfers({baseUrl,allowedOrigins,fetch:async()=>new Response('hello',{headers})});try{await assert.rejects(next.downloadBlob('file',input),pattern);}finally{next.close();}
 }
 let cancelledProgress=0;const progress=createMediaTransfers({baseUrl,allowedOrigins,fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelledProgress++;}}))});
 try{await assert.rejects(progress.downloadTo('file',new WritableStream(),{onProgress(){throw new Error('observer failed');}}),/observer failed/);assert.equal(cancelledProgress,1);}finally{progress.close();}
});
test('stream upload progress is consumed bytes; network failure and cancellation release source ownership',async()=>{
 const payload=new Blob(['hello']),progress=[];
 const client=createMediaTransfers({baseUrl,allowedOrigins,fetch:async(url,init)=>{const request=new Request(url,init);assert.equal(await request.text(),'hello');return new Response('ok');}});
 try{const response=await client.upload('upload',payload,{size:5,contentType:'text/plain',onProgress:p=>progress.push(p)});assert.equal(await response.text(),'ok');assert.equal(progress.at(-1).loaded,5);}finally{client.close();}
 let cleanup=0;const source=new ReadableStream({cancel(){cleanup++;}}),failed=createMediaTransfers({baseUrl,allowedOrigins,fetch:async()=>{throw new Error('network outage');}});
 try{await assert.rejects(failed.upload('upload',source,{size:1,contentType:'text/plain'}),/network outage/);assert.equal(cleanup,1);assert.equal(source.locked,false);}finally{failed.close();}
 const stalled=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cleanup++;}}),controller=new AbortController();
 const cancelled=createMediaTransfers({baseUrl,allowedOrigins,fetch:async(url,init)=>{await new Request(url,init).arrayBuffer();return new Response();}});
 const work=cancelled.upload('upload',stalled,{size:1,contentType:'text/plain',signal:controller.signal});await new Promise(r=>setTimeout(r,10));controller.abort();await assert.rejects(work);assert.equal(stalled.locked,false);cancelled.close();
});
test('destination policy rejects traversal/redirect destinations; attachment uses a native link without buffering',()=>{
 assert.throws(()=>createMediaTransfers({baseUrl:'https://other.test',allowedOrigins}),/denied/);
 let fetched=0,clicked=0,removed=0;const client=createMediaTransfers({baseUrl,allowedOrigins,fetch:async()=>{fetched++;return new Response();}});
 const anchor={click(){clicked++;},remove(){removed++;}},document={createElement:()=>anchor,body:{append(){}}};
 client.downloadAttachment('document','report.pdf',document);assert.equal(clicked,1);assert.equal(removed,1);assert.equal(fetched,0);assert.equal(anchor.href,baseUrl+'document');assert.equal(anchor.download,'report.pdf');
 assert.throws(()=>client.downloadAttachment('../escape','x',document),/denied/);assert.throws(()=>client.downloadAttachment('document','x\nInjected',document),/unavailable/);client.close();
});
test('close cancels and drains active readers; unavailable object-URL support fails explicitly',async()=>{
 let released=0;const source=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){released++;}}),client=createMediaTransfers({baseUrl,allowedOrigins,fetch:async()=>new Response(source)});
 const work=client.downloadTo('file',new WritableStream());await new Promise(r=>setTimeout(r,10));const closing=client.close();await assert.rejects(work,/cancelled/);await closing;assert.equal(released,1);assert.equal(source.locked,false);await client.close();
 const missing=createMediaTransfers({baseUrl,allowedOrigins,objectUrls:{}});assert.throws(()=>missing.objectUrl(new Blob(['data'])),/unavailable/);await missing.close();
});
