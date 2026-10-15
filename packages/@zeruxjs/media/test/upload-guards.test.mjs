import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MediaStore,uploadMediaRequest,createMediaResponse} from '../dist/index.js';
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'media-guard-'));const store=new MediaStore(root);try{await fn(store,root)}finally{await rm(root,{recursive:true,force:true})}}
test('stream declared length errors roll back before final metadata commit',()=>fixture(async(store,root)=>{
 for(const [length,data] of [['2','abc'],['4','abc']]){
  const req=new Request('https://example.test/upload',{method:'POST',headers:{'content-length':length},body:data});
  await assert.rejects(uploadMediaRequest(store,req),/length mismatch/i);
  assert.deepEqual(await readdir(root),[]);
 }
 const req=new Request('https://example.test/upload',{method:'PUT',body:'abc'});
 const media=await uploadMediaRequest(store,req);assert.equal(media.size,3);
 assert.equal((await store.list()).length,1);
}));
test('inline display allows inert content types but forces unknown HTML to download',()=>fixture(async store=>{
 const html=await store.upload(Buffer.from('<script>oops</script>'),{name:'index.html',contentType:'text/html'});
 const response=await createMediaResponse(store,html.id,{inline:true});
 assert.match(response.headers.get('content-disposition'),/^attachment;/);
 const png=await store.upload(Buffer.from('PNG'),{name:'image.png',contentType:'image/png'});
 const inline=await createMediaResponse(store,png.id,{inline:true,request:new Request('https://example.test/image')});
 assert.match(inline.headers.get('content-disposition'),/^inline;/);
}));
