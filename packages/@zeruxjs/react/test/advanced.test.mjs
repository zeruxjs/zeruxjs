import test from 'node:test';import assert from 'node:assert/strict';
import {createReactStore,selectReactStore,useReactSelector,observableToReactStore,reactStoreToObservable} from '../dist/index.js';
test('batches notify once; all updates retain snapshot state',()=>{
 const store=createReactStore(0);let notifications=0;store.subscribe(()=>notifications++);
 store.batch(()=>{store.set(1);store.update(n=>n+1);assert.equal(store.getSnapshot(),2)});
 assert.equal(notifications,1);assert.equal(store.getSnapshot(),2);
});
test('derived store references are stable and updates are filtered',()=>{
 const store=createReactStore({visible:1,hidden:1});const selected=selectReactStore(store,s=>({value:s.visible}),(a,b)=>a.value===b.value);
 const first=selected.getSnapshot();let count=0;selected.subscribe(()=>count++);
 store.set({visible:1,hidden:2});assert.equal(count,0);assert.equal(selected.getSnapshot(),first);
 store.set({visible:2,hidden:2});assert.equal(count,1);assert.notEqual(selected.getSnapshot(),first);
});
test('injected React selector and observable bridges work in SSR',()=>{
 const store=createReactStore({name:'a'});const result=useReactSelector((_sub,get,getServer)=>getServer(),store,s=>s.name,{serverSnapshot:()=>({name:'server'})});
 assert.equal(result,'server');const observable=reactStoreToObservable(store);const linked=observableToReactStore(observable);
 let count=0;const stop=linked.subscribe(()=>count++);store.set({name:'b'});assert.equal(linked.getSnapshot().name,'b');assert.equal(count,1);stop();
});
test('hook bindings use injected React memoization instead of recreating stores on each render',async()=>{
 const {createReactBindings}=await import('../dist/index.js');
 const store=createReactStore({a:1});let dep=[],cached,createCount=0;
 const hooks=createReactBindings({useSyncExternalStore:(_subscribe,get)=>get(),useMemo(create,next){
  if(!cached||next.some((x,i)=>!Object.is(x,dep[i]))){cached=create();createCount++;dep=next}return cached
 }});
 const select=state=>state.a;
 assert.equal(hooks.useSelector(store,select),1);assert.equal(hooks.useSelector(store,select),1);assert.equal(createCount,1);
 store.set({a:2});assert.equal(hooks.useSelector(store,select),2);
});
