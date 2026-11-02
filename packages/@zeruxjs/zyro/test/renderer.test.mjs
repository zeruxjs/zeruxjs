import test from 'node:test';
import assert from 'node:assert/strict';
import * as Zyro from 'zyrojs/component';
import {render,unmount,renderToString} from 'zyrojs/dom';
import {createObservable,mapObservable,createAsyncObservable,createZyroSubscriptionScope} from '../dist/index.js';
import {createZyroRendererBridge,useZyroRendererBridge} from '../dist/renderer.js';
import {root} from '../../../zyrojs/test/dom-fixture.mjs';
const tracked=initial=>{
 const source=createObservable(initial);let active=0;
 return {...source,subscribe(fn){active++;const stop=source.subscribe(fn);return()=>{active--;stop();}},get active(){return active}};
};

test('explicit selected snapshots, one render per batch, read-only and write-through policies',()=>{
 const source=tracked({count:0,other:0}), bridge=createZyroRendererBridge(Zyro), values=[];
 const count=bridge.select(source,s=>({count:s.count}),(a,b)=>a.count===b.count);
 const initial=count.peek();const stop=Zyro.effect(()=>values.push(count.value));
 source.set({count:0,other:1});assert.equal(count.peek(),initial);assert.equal(values.length,1);
 source.batch(()=>{source.set({count:1,other:1});source.set({count:2,other:1});});
 assert.equal(values.length,2);assert.equal(count.peek().count,2);
 bridge.batch(()=>{source.set({count:3,other:1});source.set({count:4,other:1});});
 assert.equal(values.length,3);assert.equal(count.peek().count,4);
 assert.throws(()=>{count.value={count:9}},/Read-only/);
 const mutable=createObservable(1), writable=bridge.write(mutable);writable.value=4;assert.equal(mutable.get(),4);
 const original=()=>1,next=()=>2,functions=createObservable(original), functionValue=bridge.write(functions);
 functionValue.value=next;assert.equal(functions.get(),next);
 stop();count.dispose();assert.equal(source.active,0);bridge.destroy();assert.equal(bridge.activeConnections,0);
 assert.throws(()=>writable.value,/destroyed/);mutable.set(6);assert.equal(mutable.get(),6);
});

test('component setup owns conversion and async resources through nested updates/unmount',async()=>{
 const container=root(), source=tracked(0), jobs=[];let bridge, resource, selected, renders=0;
 const View=Zyro.defineComponent(()=>{
  bridge=useZyroRendererBridge(Zyro);
  selected=bridge.read(source);
  resource=bridge.resource(signal=>new Promise(resolve=>jobs.push({signal,resolve})));
  const state=bridge.read(resource);
  return ()=>{renders++;return Zyro.h('button',{onClick:()=>source.set(n=>n+1)},String(selected.value),()=>state.value.status);};
 });
 render(Zyro.h(View,{}),container);assert.equal(source.active,1);assert.equal(container.textContent,'0idle');
 source.batch(()=>{source.set(1);source.set(2);});assert.equal(renders,2);
 const pending=resource.refresh();assert.equal(container.textContent,'2loading');
 unmount(container);assert.equal(bridge.destroyed,true);assert.equal(source.active,0);assert.equal(jobs[0].signal.aborted,true);
 jobs[0].resolve('stale');assert.equal(await pending,'stale');assert.equal(resource.get().data,undefined);
 assert.equal(container.childNodes.length,0);source.set(3);assert.equal(container.childNodes.length,0);
});

test('async replacement/AbortSignal fences stale results and bounds unsettled loaders',async()=>{
 const parent=new AbortController(), bridge=createZyroRendererBridge(Zyro,{signal:parent.signal}), jobs=[];
 const resource=bridge.resource(signal=>new Promise(resolve=>jobs.push({signal,resolve})),{maxPending:2});
 const one=resource.refresh(), two=resource.refresh();assert.equal(jobs[0].signal.aborted,true);
 await assert.rejects(resource.refresh(),/pending limit/);
 jobs[1].resolve(2);await two;assert.equal(resource.get().data,2);
 jobs[0].resolve(1);await one;assert.equal(resource.get().data,2);
 const third=resource.refresh();parent.abort(Error('request closed'));assert.equal(jobs[2].signal.aborted,true);assert.equal(bridge.destroyed,true);
 jobs[2].resolve(3);await third;assert.equal(resource.get().data,2);await assert.rejects(resource.refresh(),/destroyed/);
 const external=new AbortController(),direct=createAsyncObservable(signal=>new Promise(resolve=>jobs.push({signal,resolve})),{signal:external.signal});
 const work=direct.refresh();external.abort('owner stopped');assert.equal(jobs[3].signal.reason,'owner stopped');
 jobs[3].resolve(4);await work;assert.equal(direct.get().status,'idle');assert.equal(direct.get().data,undefined);
 await assert.rejects(direct.refresh(),e=>e.name==='AbortError'&&e.cause==='owner stopped');direct.destroy();
});

test('timeout leaves loading without claiming forced cancellation; producer failures retry',async()=>{
 let finish, signal;const resource=createAsyncObservable(s=>{signal=s;return new Promise(resolve=>finish=resolve)},{timeoutMs:5,maxPending:1});
 const pending=resource.refresh();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
 assert.equal(resource.get().status,'idle');await assert.rejects(resource.refresh(),/pending limit/);
 finish('late');await pending;assert.equal(resource.get().data,undefined);resource.destroy();
 let calls=0;const bridge=createZyroRendererBridge(Zyro),failure=Error('dependency unavailable');
 const retry=bridge.resource(async()=>{if(calls++===0)throw failure;return 'ready'});
 await assert.rejects(retry.refresh(),error=>error===failure);assert.equal(retry.get().status,'error');
 assert.equal(await retry.refresh(),'ready');bridge.destroy();
});

test('denied inputs, connection bounds, initial failure rollback and all cleanup attempts',()=>{
 assert.throws(()=>createZyroRendererBridge({}),/primitives/);
 const bridge=createZyroRendererBridge(Zyro,{maxConnections:1});assert.throws(()=>bridge.read(Zyro.signal(0)),/get\/subscribe/);
 const first=bridge.read(createObservable(0));assert.throws(()=>bridge.read(createObservable(1)),/limit/);first.dispose();
 assert.throws(()=>bridge.read({get:()=>1,subscribe(){throw Error('subscribe unavailable')}}),/subscribe unavailable/);assert.equal(bridge.activeConnections,0);
 const stopped=[];
 bridge.read({get:()=>1,subscribe(){return()=>{stopped.push(1);throw Error('cleanup failed')}}});
 assert.throws(()=>bridge.destroy(),AggregateError);assert.deepEqual(stopped,[1]);assert.equal(bridge.activeConnections,0);
 const scope=createZyroSubscriptionScope();let native=0;
 assert.throws(()=>scope.observe({get:()=>1,subscribe(fn){native++;fn(1);return()=>native--}},()=>{throw Error('initial failed')}),/initial failed/);
 assert.equal(native,0);scope.destroy();
 assert.throws(()=>useZyroRendererBridge(Zyro),/active scope/);
});

test('failed selectors retry a snapshot instead of poisoning memoization',()=>{
 const source=createObservable(0);let permitted=true,attempts=0;
 const selected=mapObservable(source,value=>{attempts++;if(!permitted)throw Error('denied');return value});
 source.set(1);permitted=false;assert.throws(()=>selected.get(),/denied/);assert.throws(()=>selected.get(),/denied/);
 permitted=true;assert.equal(selected.get(),1);assert.equal(attempts,4);
});

test('SSR instances create independent bridge scopes and release subscriptions on success/failure',async()=>{
 const stores=[],bridges=[];
 const View=Zyro.defineComponent(props=>{
  const source=tracked(props.name);stores.push(source);
  const bridge=useZyroRendererBridge(Zyro);bridges.push(bridge);const view=bridge.read(source);
  return ()=>Zyro.h('p',{},view.value);
 });
 const results=await Promise.all(['one','two'].map(name=>Promise.resolve().then(()=>renderToString(Zyro.h(View,{name})))));
 assert.deepEqual(results,['<p>one</p>','<p>two</p>']);assert.ok(stores.every(store=>store.active===0));assert.ok(bridges.every(bridge=>bridge.destroyed));
 const source=tracked(0), Broken=Zyro.defineComponent(()=>{const bridge=useZyroRendererBridge(Zyro);bridge.read(source);return()=>{throw Error('render failed')}});
 assert.throws(()=>renderToString(Zyro.h(Broken,{})),/render failed/);assert.equal(source.active,0);
});

test('bridge projections remain untracked and invalid render-time registration is denied',()=>{
 const source=createObservable(0),incidental=Zyro.signal(0),trigger=Zyro.signal(0),bridge=createZyroRendererBridge(Zyro);let runs=0;
 const selected=bridge.select(source,n=>{incidental.value;return n});
 const stop=Zyro.effect(()=>{runs++;source.set(trigger.value)});
 trigger.value=1;assert.equal(selected.peek(),1);const before=runs;incidental.value++;
 assert.equal(runs,before);stop();bridge.destroy();
 const Bad=()=>{useZyroRendererBridge(Zyro);return null};const container=root();
 assert.throws(()=>render(Zyro.h(Bad,{}),container),/during render/);assert.equal(container.childNodes.length,0);
});

test('abort-listener reentrancy cannot give two loaders the same active generation',async()=>{
 const jobs=[];let nested;
 const resource=createAsyncObservable(signal=>new Promise(resolve=>jobs.push({signal,resolve})));
 const initial=resource.refresh();jobs[0].signal.addEventListener('abort',()=>{nested=resource.refresh()},{once:true});
 await assert.rejects(resource.refresh(),error=>error.name==='AbortError');assert.equal(jobs.length,2);
 jobs[1].resolve('newest');await nested;jobs[0].resolve('old');await initial;
 assert.equal(resource.get().data,'newest');resource.destroy();
});

test('initial source failure retains both its cause and unsubscribe failure',()=>{
 const scope=createZyroSubscriptionScope(),read=Error('dependency read failed'),cleanup=Error('dependency cleanup failed');
 assert.throws(()=>scope.observe({get(){throw read},subscribe(){return()=>{throw cleanup}}},()=>{}),error=>error instanceof AggregateError&&error.errors[0]===read&&error.errors[1]===cleanup);
 scope.destroy();
});
