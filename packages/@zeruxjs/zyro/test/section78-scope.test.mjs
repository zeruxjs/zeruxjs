import test from 'node:test';import assert from 'node:assert/strict';
import {createObservable,createZyroSubscriptionScope,toExternalStore} from '../dist/index.js';
test('route mount/unmount owns exactly one observable subscription and unmount is idempotent',()=>{
 const state=createObservable(1);const scope=createZyroSubscriptionScope();const received=[];
 const stop=scope.observe(state,value=>received.push(value));assert.deepEqual(received,[1]);
 state.set(2);assert.deepEqual(received,[1,2]);stop();stop();state.set(3);
 assert.deepEqual(received,[1,2]);scope.destroy();scope.destroy();
 assert.equal(scope.destroyed,true);assert.throws(()=>scope.observe(state,()=>{}),/destroyed/);
});
test('Zyro scope closes when the initial listener throws',()=>{
 const state=createObservable(1);const scope=createZyroSubscriptionScope();let count=0;
 assert.throws(()=>scope.observe(state,()=>{count++;throw new Error('bad')},{immediate:true}),/bad/);
 assert.doesNotThrow(()=>state.set(2));assert.equal(count,1);scope.destroy();
});
test('bridge works with external-store snapshots and reactive cleanup',()=>{
 const state=createObservable('initial');const store=toExternalStore(state),scope=createZyroSubscriptionScope();
 const read=[];scope.observe({get:store.getSnapshot,subscribe(fn){return store.subscribe(()=>fn(store.getSnapshot()))}},v=>read.push(v));
 state.set('ready');scope.destroy();state.set('done');assert.deepEqual(read,['initial','ready']);
});
test('synchronous source emission during subscribe does not double-fire initial notification',()=>{
 const events=[];const scope=createZyroSubscriptionScope();
 const source={get:()=>42,subscribe(fn){fn(42);return()=>{}}};
 scope.observe(source,v=>events.push(v));assert.deepEqual(events,[42]);scope.destroy();
});
test('destroy drains other route disposers even when one fails',()=>{
 const scope=createZyroSubscriptionScope(),calls=[];
 scope.add(()=>calls.push('first'));
 scope.add(()=>{calls.push('second');throw Error('cleanup failed')});
 scope.add(()=>calls.push('third'));
 assert.throws(()=>scope.destroy(),AggregateError);
 assert.deepEqual(calls,['third','second','first']);
 assert.doesNotThrow(()=>scope.destroy());
});
