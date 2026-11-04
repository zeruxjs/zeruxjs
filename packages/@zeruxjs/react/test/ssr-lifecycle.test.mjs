import test from 'node:test';import assert from 'node:assert/strict';
import {createReactStore,selectReactStore,createReactBindings,useReactStore} from '../dist/index.js';

test('server snapshot stays deterministic while the browser snapshot changes',()=>{
 const source=createReactStore({count:1},{serverSnapshot:{count:0}});
 source.set({count:5});assert.equal(source.getSnapshot().count,5);
 assert.equal(source.getServerSnapshot().count,0);
 const derived=selectReactStore(source,s=>s.count);
 assert.equal(derived.getServerSnapshot(),0);assert.equal(derived.getSnapshot(),5);
 assert.equal(useReactStore((_sub,_get,server)=>server(),source).count,0);
 source.destroy();
});
test('React hooks never substitute client snapshots for an absent SSR contract',()=>{
 const fakeHook=(_sub,_get,server)=>Boolean(server);
 const store={getSnapshot:()=>1,subscribe:()=>()=>{}};
 assert.equal(useReactStore(fakeHook,store),false);
});
test('strict-mode subscription unmount/remount never duplicates listeners',()=>{
 const source=createReactStore(0);let count=0;
 const stop1=source.subscribe(()=>count++);stop1();stop1();
 const stop2=source.subscribe(()=>count++);source.set(1);assert.equal(count,1);
 stop2();source.set(2);assert.equal(count,1);
});
test('memoized selector binding supports hydration and committed updates',()=>{
 const source=createReactStore({count:1,hidden:0},{serverSnapshot:{count:0,hidden:0}});
 let memo,memoDeps=[];
 const runtime={useSyncExternalStore:(_subscribe,get,server)=>({client:get(),server:server?.()}),
  useMemo(factory,deps){if(!memo||deps.some((x,i)=>!Object.is(x,memoDeps[i]))){memo=factory();memoDeps=deps}return memo}};
 const bindings=createReactBindings(runtime),selector=s=>s.count;
 assert.deepEqual(bindings.useSelector(source,selector),{client:1,server:0});
 source.set({count:2,hidden:1});assert.deepEqual(bindings.useSelector(source,selector),{client:2,server:0});
});
test('SSR selected objects are referentially stable across repeated reads',()=>{
 const source=createReactStore({value:1});
 const selected=selectReactStore(source,s=>({n:s.value}),(a,b)=>a.n===b.n);
 const a=selected.getServerSnapshot();const b=selected.getServerSnapshot();
 assert.equal(a,b);source.set({value:2});assert.equal(selected.getServerSnapshot(),a);
});
