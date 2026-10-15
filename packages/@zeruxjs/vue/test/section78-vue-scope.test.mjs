import test from 'node:test';import assert from 'node:assert/strict';
import {createVueBindings,createVueRef,fromVueRef} from '../dist/index.js';
function harness(){const callbacks=new Set();let scope=true;let watches=0;return{
 callbacks,leave(){scope=false;for(const stop of [...callbacks])stop();callbacks.clear()},
 runtime:{shallowRef(value){return{value}},getCurrentScope(){return scope},onScopeDispose(stop){callbacks.add(stop)},
  readonly(ref){return{get value(){return ref.value}}},
  watch(read,notify,options){assert.equal(options.flush,'sync');let before=read();
   const cb=()=>{const next=read();if(!Object.is(next,before)){before=next;notify(next)}};
   watches++;return()=>{watches--};}}
}}
test('Vue scoped store is readonly and updates synchronously, scope cleanup is idempotent',()=>{
 const h=harness(),b=createVueBindings(h.runtime);let value=1;const ls=new Set();
 const store={getSnapshot:()=>value,subscribe(fn){ls.add(fn);return()=>ls.delete(fn)}};
 const state=b.useStore(store);assert.equal(state.value,1);
 value=2;for(const fn of ls)fn();assert.equal(state.value,2);
 h.leave();h.leave();value=3;for(const fn of ls)fn();assert.equal(state.value,2);assert.equal(ls.size,0);
});
test('Vue adapter refuses scope-less subscriptions and manual connections must stop',()=>{
 const h=harness(),b=createVueBindings(h.runtime);let value=1,ls=new Set();
 const source={getSnapshot:()=>value,subscribe(fn){ls.add(fn);return()=>ls.delete(fn)}};
 h.leave();assert.throws(()=>b.useStore(source),/scope/);
 const connected=b.connect(source);value=8;for(const fn of ls)fn();assert.equal(connected.ref.value,8);
 connected.stop();connected.stop();assert.equal(ls.size,0);
});
test('Vue native watch integration demands explicit watch for changes',()=>{
 const h=harness(),b=createVueBindings(h.runtime);
 const ref=createVueRef(1);const store=b.fromRef(ref);
 // Use an actual synchronous fake Vue watch (not the standalone ref notifications)
 assert.equal(store.getSnapshot(),1);
 const noWatch=createVueBindings({shallowRef:x=>({value:x}),getCurrentScope:()=>true,onScopeDispose:()=>{}});
 assert.throws(()=>noWatch.fromRef(ref),/watch/);
});
test('Vue SSR route setup can read a one-shot snapshot without subscribing',()=>{
 const h=harness();const b=createVueBindings(h.runtime);let subscribers=0;
 const store={getSnapshot:()=>42,subscribe(){subscribers++;return()=>{subscribers--}}};
 const value=b.useStore(store,{ssr:true});assert.equal(value.value,42);assert.equal(subscribers,0);h.leave();
});
test('real-like Vue ref watch forwards change and unwatch stops notifications',()=>{
 const ref=createVueRef(1);let count=0;
 const runtime={shallowRef:x=>({value:x}),getCurrentScope:()=>true,onScopeDispose:()=>{},
  watch(read,notify,opts){assert.equal(opts.flush,'sync');return ref.subscribe(()=>notify(read()))}};
 const bridge=createVueBindings(runtime);
 const store=bridge.fromRef(ref);
 const stop=store.subscribe(()=>count++);ref.value=2;assert.equal(store.getSnapshot(),2);assert.equal(count,1);
 stop();ref.value=3;assert.equal(count,1);
});
