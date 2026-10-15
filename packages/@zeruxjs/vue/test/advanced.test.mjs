import test from 'node:test';import assert from 'node:assert/strict';
import {createVueRef,combineVueRefs,syncVueRef,observableToVueRef} from '../dist/index.js';
test('combined refs keep latest tuple and detach',()=>{
 const a=createVueRef(1),b=createVueRef('b'),combined=combineVueRefs([a,b]);let notices=0;combined.subscribe(()=>notices++);
 a.value=2;assert.deepEqual(combined.value,[2,'b']);assert.equal(notices,1);const frozen=combined.value;
 combined.stop();b.value='changed';assert.equal(combined.value,frozen);assert.throws(()=>{combined.value=[]},TypeError);
});
test('two-way binding prevents feedback loops and cleans up',()=>{
 let state=0;const callbacks=new Set();const store={getSnapshot:()=>state,subscribe(fn){callbacks.add(fn);return()=>callbacks.delete(fn)},set(v){state=v;for(const fn of callbacks)fn()}};
 const ref=createVueRef(5);const stop=syncVueRef(ref,store);assert.equal(ref.value,0);ref.value=2;assert.equal(state,2);
 store.set(3);assert.equal(ref.value,3);stop();store.set(4);assert.equal(ref.value,3);assert.equal(callbacks.size,0);
});
test('observable adapter exposes a readonly ref and stop',()=>{
 let listener;const ref=observableToVueRef({get:()=>1,subscribe(fn){listener=fn;return()=>{listener=undefined}}});
 listener(2);assert.equal(ref.value,2);assert.throws(()=>{ref.value=3},TypeError);
 ref.stop();assert.equal(listener,undefined);
});
