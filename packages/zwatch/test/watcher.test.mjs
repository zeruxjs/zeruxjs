import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startWatcher,activeWatcherCount,diff} from '../dist/index.js';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
test('diff classifies changes',()=>{const before=new Map([['a',{mtimeMs:1,size:1}],['b',{mtimeMs:1,size:1}]]); const after=new Map([['a',{mtimeMs:2,size:1}],['c',{mtimeMs:1,size:1}]]);assert.deepEqual(diff(before,after).map(x=>x.type),['update','delete','new']);});
test('watchers share resources and dispose',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'zwatch-'));const first=[];const second=[];const opts={pollIntervalMs:100,debounceMs:20};const a=startWatcher(dir,e=>first.push(e),opts);const b=startWatcher(dir,e=>second.push(e),opts);try{assert.equal(activeWatcherCount(),1);await sleep(200);await writeFile(path.join(dir,'hello.txt'),'hello');for(let i=0;i<25 && !first.some(e=>e.type==='new');i++) await sleep(50);assert.ok(first.some(e=>e.type==='new'));assert.ok(second.some(e=>e.type==='new'));a();assert.equal(activeWatcherCount(),1);b();assert.equal(activeWatcherCount(),0);} finally {a();b();await rm(dir,{recursive:true,force:true});}});
