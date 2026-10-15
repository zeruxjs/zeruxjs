import test from 'node:test';import assert from 'node:assert/strict';
import {createObservable,mapObservable,combineObservables,createAsyncObservable,awaitObservable} from '../dist/index.js';
test('observable batches retain state and emit one notification',()=>{
 const store=createObservable(1);let values=[];store.subscribe(v=>values.push(v));store.batch(()=>{store.set(2);store.set(3);assert.equal(store.get(),3)});assert.deepEqual(values,[3]);
});
test('mapped selectors cache references across repeated reads',()=>{
 const store=createObservable({a:1,b:1});const selected=mapObservable(store,s=>({a:s.a}),(x,y)=>x.a===y.a);const first=selected.get();
 let count=0;selected.subscribe(()=>count++);store.set({a:1,b:2});assert.equal(selected.get(),first);assert.equal(count,0);
 store.set({a:2,b:2});assert.equal(count,1);assert.notEqual(selected.get(),first);
});
test('combined state keeps stable tuple when unchanged',()=>{
 const a=createObservable(1),b=createObservable(2);const combined=combineObservables([a,b]);const first=combined.get();
 assert.equal(combined.get(),first);a.set(1);assert.equal(combined.get(),first);a.set(3);assert.deepEqual(combined.get(),[3,2]);
});
test('awaitObservable handles synchronous emission from subscribe',async()=>{
 let stopped=false;const source={get:()=>0,subscribe(fn){fn(10);return()=>{stopped=true}}};
 assert.equal(await awaitObservable(source,x=>x===10),10);assert.equal(stopped,true);
});
test('async resources ignore stale completions and support cancellation',async()=>{
 const pending=[];const res=createAsyncObservable(async signal=>new Promise(resolve=>pending.push({resolve,signal})));
 const one=res.refresh(),two=res.refresh();assert.equal(pending[0].signal.aborted,true);
 pending[1].resolve(2);assert.equal(await two,2);assert.equal(res.get().data,2);pending[0].resolve(1);
 await one;assert.equal(res.get().data,2);
 res.cancel();res.destroy();await assert.rejects(res.refresh(),/destroyed/);
});
test('async resources report failures and reset state',async()=>{
 const res=createAsyncObservable(async()=>{throw new Error('bad')});await assert.rejects(res.refresh(),/bad/);
 assert.equal(res.get().status,'error');res.reset();assert.equal(res.get().status,'idle');res.destroy();
});
