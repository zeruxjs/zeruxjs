import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {watchDirectory,activeWatcherCount} from '../dist/index.js';
test('invalid watcher options are rejected before resource allocation',()=>{
 assert.throws(()=>watchDirectory('',()=>{}),/root/);
 assert.throws(()=>watchDirectory('/tmp',()=>{},{debounceMs:-1}),/debounceMs/);
 assert.throws(()=>watchDirectory('/tmp',()=>{},{pollIntervalMs:0}),/pollIntervalMs/);
 assert.throws(()=>watchDirectory('/tmp',()=>{},{pollIntervalMs:Infinity}),/pollIntervalMs/);
 assert.equal(activeWatcherCount(),0);
});
test('missing watcher root reports its native error and disposes cleanly',async()=>{
 const root=await mkdtemp(join(tmpdir(),'zwatch-options-'));const errors=[];
 const handle=watchDirectory(join(root,'missing'),()=>{},{onError:err=>errors.push(err)});
 try {await handle.ready;assert.ok(errors.length>0);}
 finally {handle.close();await rm(root,{recursive:true,force:true});}
 assert.equal(activeWatcherCount(),0);
});
