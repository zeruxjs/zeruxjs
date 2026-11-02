import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as React from 'react';
import {createReactStore,createReactBindings} from '../dist/index.js';
import {mountReact,hydrateReact} from '../dist/browser.js';
import {renderReactToString} from '../dist/server.js';
import {createReactHydrationState,readReactHydrationState} from '../dist/hydration.mjs';
const bindings=createReactBindings(React);
async function environment(run){
 const dom=new JSDOM('<!doctype html><main id="app"></main>',{url:'https://app.test/'}),saved=new Map();
 const globals={window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true};
 for(const [key,value]of Object.entries(globals)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})}
 try{await run(dom.window.document.querySelector('#app'),dom.window)}finally{dom.window.close();for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
}
const tracked=source=>{let live=0,starts=0,stops=0;return{...source,subscribe(fn){live++;starts++;let active=true;const stop=source.subscribe(fn);return()=>{if(active){active=false;live--;stops++;stop()}}},get live(){return live},get starts(){return starts},get stops(){return stops}}};
const validateState=value=>{if(!value||typeof value.count!=='number'||typeof value.name!=='string'||Object.keys(value).some(k=>!['count','name'].includes(k)))throw Error('invalid state');return{count:value.count,name:value.name}};

test('actual React Strict Mode cleans probes/subscriptions; selection and explicit root ownership remain stable',()=>environment(async container=>{
 const source=tracked(createReactStore({count:0,hidden:0}));let renders=0,disposed=0;
 const selector=s=>({count:s.count}),equal=(a,b)=>a.count===b.count;
 function Counter(){const selected=bindings.useSelector(source,selector,{equal});renders++;return React.createElement('button',{onClick:()=>source.update(s=>({...s,count:s.count+1}))},selected.count)}
 const view=React.createElement(React.StrictMode,null,React.createElement(Counter));let handle;
 await React.act(async()=>{handle=await mountReact(view,container,{onDispose(){disposed++;source.destroy()}})});
 assert.equal(container.textContent,'0');assert.equal(source.live,1);assert.ok(source.starts>=2);assert.ok(source.stops>=1);
 const before=renders;
 await React.act(async()=>source.update(s=>({...s,hidden:1})));assert.equal(renders,before);
 await React.act(async()=>source.batch(()=>{source.update(s=>({...s,count:1}));source.update(s=>({...s,count:2}));}));assert.equal(container.textContent,'2');
 await assert.rejects(mountReact(view,container),e=>e.code==='ROOT_ALREADY_OWNED');
 await React.act(async()=>handle.update(React.createElement('p',null,'updated')));assert.equal(container.textContent,'updated');assert.equal(source.live,0);
 await React.act(async()=>handle.unmount());handle.unmount();assert.equal(disposed,1);assert.equal(container.childNodes.length,0);assert.equal(handle.closed,true);
 assert.throws(()=>handle.update(view),e=>e.code==='ROOT_CLOSED');
}));

test('actual React SSR hydrates with the exact pinned snapshot/prefix and preserves existing input edits',()=>environment(async container=>{
 const serverState=createReactHydrationState({count:2,name:'initial'},{identifierPrefix:'counter',validateState});
 const selector=s=>s.count;
 function View({store}){const count=bindings.useSelector(store,selector),id=React.useId();return React.createElement('section',null,React.createElement('label',{htmlFor:id},'Name'),React.createElement('input',{id,defaultValue:'initial'}),React.createElement('b',null,count))}
 const html=await renderReactToString(React.createElement(View,{store:serverState.store}),{identifierPrefix:serverState.identifierPrefix});serverState.dispose();
 container.innerHTML=html;const input=container.querySelector('input'),bold=container.querySelector('b'),id=input.id;
 input.value='edited before hydration';input.focus();input.setSelectionRange(1,4);
 const restored=readReactHydrationState(serverState.data,{validateState}),source=tracked(restored.store);
 source.set({count:3,name:'initial'});assert.equal(source.getServerSnapshot().count,2);
 let handle;await React.act(async()=>{handle=await hydrateReact(React.createElement(View,{store:source}),container,{identifierPrefix:restored.identifierPrefix,onDispose:restored.dispose})});
 assert.equal(container.querySelector('input'),input);assert.equal(container.querySelector('b'),bold);assert.equal(input.value,'edited before hydration');assert.equal(input.id,id);assert.equal(container.querySelector('label').htmlFor,id);
 assert.equal(container.textContent,'Name3');assert.equal(handle.errors.length,0);assert.equal(source.live,1);
 await React.act(async()=>handle.unmount());assert.equal(source.live,0);assert.equal(container.childNodes.length,0);
}));

test('hydration mismatches record fixed diagnostics; cancellation and render failure release subscriptions',()=>environment(async container=>{
 container.innerHTML='<p>PRIVATE_SERVER_VALUE</p>';let handle;
 await React.act(async()=>{handle=await hydrateReact(React.createElement('p',null,'client'),container)});
 assert.equal(container.textContent,'client');assert.ok(handle.errors.some(e=>e.code==='REACT_RECOVERABLE_ERROR'));
 assert.doesNotMatch(JSON.stringify(handle.errors),/PRIVATE_SERVER_VALUE/);
 await React.act(async()=>handle.unmount());
 const signal=new AbortController(),source=tracked(createReactStore(1));let disposed=0;
 function Good(){return React.createElement('p',null,bindings.useStore(source))}
 await React.act(async()=>{handle=await mountReact(React.createElement(Good),container,{signal:signal.signal,onDispose(){disposed++;source.destroy()}})});
 assert.equal(source.live,1);await React.act(async()=>signal.abort());assert.equal(source.live,0);assert.equal(disposed,1);assert.equal(handle.closed,true);
 function Broken(){throw Error('PRIVATE_RENDER_CAUSE')}
 let notify;const reported=new Promise(resolve=>notify=resolve);let timer;
 globalThis.IS_REACT_ACT_ENVIRONMENT=false;
 try{
  handle=await mountReact(React.createElement(Broken),container,{onError:error=>notify(error)});
  await Promise.race([reported,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('React error callback timed out')),1000)})]);
 }finally{clearTimeout(timer);globalThis.IS_REACT_ACT_ENVIRONMENT=true;}
 assert.ok(handle.errors.some(e=>e.code==='REACT_UNCAUGHT_ERROR'&&e.cause.message==='PRIVATE_RENDER_CAUSE'));
 assert.doesNotMatch(JSON.stringify(handle.errors),/PRIVATE_RENDER_CAUSE/);await React.act(async()=>handle.unmount());
}));

test('pending root abort, invalid input, observer and cleanup errors have explicit ownership',()=>environment(async container=>{
 let disposed=0;const controller=new AbortController();const pending=mountReact(React.createElement('p',null,'x'),container,{signal:controller.signal,onDispose:()=>disposed++});controller.abort();
 await assert.rejects(pending,e=>e.code==='RENDER_ABORTED');assert.equal(disposed,1);assert.equal(container.childNodes.length,0);
 await assert.rejects(mountReact(null,{}),e=>e.code==='INVALID_CONTAINER');
 let handle;await React.act(async()=>{handle=await mountReact(React.createElement('p',null,'ok'),container,{onDispose:()=>{throw Error('cleanup dependency failed')}})});
 await React.act(async()=>assert.throws(()=>handle.unmount(),e=>e.code==='REACT_UNMOUNT_FAILED'));
 assert.equal(handle.closed,true);assert.equal(container.childNodes.length,0);
 // A previous failed owner cannot remove a new one.
 let next;await React.act(async()=>{next=await mountReact(React.createElement('p',null,'new'),container)});handle.unmount();assert.equal(container.textContent,'new');await React.act(async()=>next.unmount());
}));

test('throwing diagnostic observers remain visible without preventing root cleanup',()=>environment(async container=>{
 container.innerHTML='<p>server</p>';const failure=Error('PRIVATE_OBSERVER_DETAIL');let handle;
 await React.act(async()=>{handle=await hydrateReact(React.createElement('p',null,'client'),container,{onError(){throw failure}})});
 assert.ok(handle.errors.some(error=>error.code==='REACT_OBSERVER_FAILED'&&error.cause===failure));
 assert.doesNotMatch(JSON.stringify(handle.errors),/PRIVATE_OBSERVER_DETAIL/);
 await React.act(async()=>handle.unmount());assert.equal(container.childNodes.length,0);
}));
