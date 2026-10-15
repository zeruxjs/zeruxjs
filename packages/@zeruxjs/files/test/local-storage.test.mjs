import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,symlink,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createLocalStorage,createFileManager} from '../dist/index.js';
async function temporary(fn){const root=await mkdtemp(join(tmpdir(),'zx-files-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
const address=(key,storage='private')=>({storage,bucket:'my-bucket',key});
test('S3-lite preserves arbitrary binary files, ranges, listing and private mode',async()=>temporary(async root=>{
 const manager=createFileManager({stores:[{name:'private',driver:createLocalStorage({root})}]});
 const bytes=Buffer.from([0,1,2,3,4,255]);const a=address('nested/binary.bin');
 const info=await manager.put(a,bytes,{contentType:'application/octet-stream'});
 assert.equal(info.size,6);assert.equal(info.visibility,'private');assert.deepEqual(await manager.get(a),bytes);
 const stream=await manager.read(a,{start:1,end:3});const parts=[];for await(const chunk of stream)parts.push(chunk);
 assert.deepEqual(Buffer.concat(parts),Buffer.from([1,2,3]));
 await assert.rejects(manager.put(a,bytes),{code:'FILE_EXISTS'});
 const page=await manager.list('my-bucket');assert.equal(page.items.length,1);assert.equal(page.items[0].storage,'private');
 assert.equal(await manager.delete(a),true);assert.equal(await manager.stat(a),null);
 await manager.close();await assert.rejects(manager.stat(a),/closed/);
}));
test('multiple independent local stores, prefix and bucket policies, streaming cross-store copy',async()=>temporary(async root=>{
 const a=createLocalStorage({root:join(root,'a')}),b=createLocalStorage({root:join(root,'b')});
 const m=createFileManager({defaultStorage:'first',stores:[{name:'first',driver:a,allowedBuckets:['my-bucket'],keyPrefix:'tenant/'},{name:'second',driver:b}]});
 const source=address('tenant/file.txt','first'),target=address('second-file.txt','second');
 async function* bytes(){yield Buffer.from('hello ');yield Buffer.from('world');}
 await m.put(source,bytes(),{contentType:'text/plain',visibility:'public'});
 await m.copy(source,target);
 assert.equal((await m.get(target)).toString(),'hello world');
 await assert.rejects(m.get(address('other/file','first')),/Key not allowed/);
 await assert.rejects(m.get({storage:'first',bucket:'other-bucket',key:'tenant/file.txt'}),/Bucket not allowed/);
 assert.equal((await m.list('my-bucket',{storage:'first'})).items.length,1);
 await m.close();
}));
test('cache version/invalidation prevents stale data after overwrite and protects private reads',async()=>temporary(async root=>{
 const m=createFileManager({stores:[{name:'private',driver:createLocalStorage({root})}],cache:{maxEntries:2,maxBytes:2000,ttlMs:60000}});const a=address('cache/item');
 await m.put(a,Buffer.from('before'),{visibility:'public'});assert.equal((await m.get(a)).toString(),'before');assert.equal(m.cacheStats().entries,1);
 await m.put(a,Buffer.from('after'),{visibility:'public',ifNoneMatch:false});assert.equal(m.cacheStats().entries,0);
 assert.equal((await m.get(a)).toString(),'after');assert.equal(m.cacheStats().entries,1);
 await m.delete(a);assert.equal(m.cacheStats().entries,0);
 await m.put(a,Buffer.from('secret'),{visibility:'private'});await m.get(a);assert.equal(m.cacheStats().entries,0);
 await m.close();
}));
test('encrypted local files are physically opaque and tag tampering is detected',async()=>temporary(async root=>{
 const secret=randomBytes(32);const m=createFileManager({stores:[{name:'private',driver:createLocalStorage({root,encryptionKey:secret})}]});const a=address('secret/file.txt');
 await m.put(a,Buffer.from('confidential document'),{visibility:'private'});
 const raw=await readFile(join(root,'objects','my-bucket','secret','file.txt'));
 assert.equal(raw.includes(Buffer.from('confidential')),false);assert.equal((await m.get(a)).toString(),'confidential document');
 raw[0]^=1;await writeFile(join(root,'objects','my-bucket','secret','file.txt'),raw);
 await assert.rejects(m.get(a),/authenticat|decrypt|Unsupported state/i);
 await m.close();
}));
test('storage path traversal, symlinks, content types, invalid configuration rejected',async()=>temporary(async root=>{
 const m=createFileManager({stores:[{name:'private',driver:createLocalStorage({root}),allowedTypes:['image/*'],maxBytes:8}]});
 for(const bad of ['../etc/passwd','/root','a//b','a/./b','a/../b','foo\\bar'])await assert.rejects(m.put(address(bad),Buffer.from('x')));
 await assert.rejects(m.put(address('content.jpg'),Buffer.from('data'),{contentType:'text/plain'}),/not allowed/);
 await assert.rejects(m.put(address('photo.jpg'),Buffer.alloc(9),{contentType:'image/jpeg'}),/size/);
 await m.put(address('photo.jpg'),Buffer.from('data'),{contentType:'image/jpeg'});
 const file=join(root,'objects','my-bucket','photo.jpg');await rm(file);await symlink('/etc/passwd',file);
 await assert.rejects(m.stat(address('photo.jpg')),/Unsafe|symbolic|mismatch|file/i);
 await m.close();
}));
