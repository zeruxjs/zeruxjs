import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as React from 'react';
import {createReactBindings,createReactStore,selectReactStore} from '../dist/index.js';
import {renderReactToString,renderReactToStaticMarkup,getReactServerCapabilities} from '../dist/server.js';
import {createReactHydrationState,readReactHydrationState} from '../dist/hydration.mjs';
const bindings=createReactBindings(React),validateState=input=>{if(!input||typeof input.text!=='string')throw Error('private schema error');return{text:input.text}};

test('real server rendering escapes output, uses request snapshots and reports installed capabilities',async()=>{
 function View({store}){const state=bindings.useStore(store);return React.createElement('p',null,state.text)}
 const outputs=await Promise.all(['one','two'].map(async text=>{
  const state=createReactHydrationState({text},{identifierPrefix:text,validateState});
  try{const html=await renderReactToString(React.createElement(View,{store:state.store}),{identifierPrefix:state.identifierPrefix});return{html,data:state.data}}finally{state.dispose()}
 }));
 assert.deepEqual(outputs.map(x=>x.html),['<p>one</p>','<p>two</p>']);assert.notEqual(outputs[0].data,outputs[1].data);
 assert.equal(await renderReactToStaticMarkup(React.createElement('b',null,'<script>')),'<b>&lt;script&gt;</b>');
 const caps=await getReactServerCapabilities();assert.equal(caps.version,React.version);assert.equal(caps.streaming,false);
 function Broken(){throw Error('private dependency failed')}
 await assert.rejects(renderReactToString(React.createElement(Broken)),e=>e.code==='REACT_RENDER_FAILED'&&e.cause.message==='private dependency failed');
 await assert.rejects(renderReactToString(React.createElement('p',null,'large'),{maxBytes:1}),e=>e.code==='HTML_BYTE_LIMIT');
 const controller=new AbortController();controller.abort('private reason');await assert.rejects(renderReactToString(null,{signal:controller.signal}),e=>e.code==='RENDER_ABORTED'&&e.cause==='private reason');
});

test('public state codec matches script-breaking payloads without serializing executable/private data',()=>{
 const value={text:'</script><script>bad()</script>\u2028\u2029&'},state=createReactHydrationState(value,{identifierPrefix:'safe',validateState});
 assert.doesNotMatch(state.data,/<|>|&|\u2028|\u2029/);
 const restored=readReactHydrationState(state.data,{validateState});assert.deepEqual(JSON.parse(JSON.stringify(restored.store.getServerSnapshot())),value);
 assert.equal(restored.store.getServerSnapshot(),restored.store.getSnapshot());assert.ok(Object.isFrozen(restored.store.getServerSnapshot()));
 assert.throws(()=>readReactHydrationState(state.data,{validateState:x=>({text:x.text+'changed'})}),e=>e.code==='HYDRATION_STATE_CHANGED');
 for(const input of [{password:'private'}, {x:new Date()}, {x:()=>1}, {x:undefined}, {x:NaN}, {x:[,1]}])assert.throws(()=>createReactHydrationState(input,{identifierPrefix:'safe',validateState:x=>x}));
 let invoked=0;const input={};Object.defineProperty(input,'x',{enumerable:true,get(){invoked++;return 'private'}});assert.throws(()=>createReactHydrationState(input,{identifierPrefix:'safe',validateState:x=>x}));assert.equal(invoked,0);
 assert.throws(()=>createReactHydrationState({text:'x'.repeat(50)},{identifierPrefix:'safe',validateState,maxBytes:10}),e=>e.code==='STATE_BYTE_LIMIT');
 state.dispose();restored.dispose();
});

test('server import/render never reads DOM globals',()=>{
 execFileSync(process.execPath,['--input-type=module','-e',`for(const key of ['window','document','HTMLElement'])Object.defineProperty(globalThis,key,{get(){throw Error('DOM global read')}});const React=await import('react');const {renderReactToString}=await import('@zeruxjs/react/server');const html=await renderReactToString(React.createElement('p',null,'safe'));if(html!=='<p>safe</p>')throw Error('SSR failed');`],{cwd:process.cwd(),stdio:'pipe'});
});

test('server selector override is cached and failed selectors do not poison client/server snapshots',()=>{
 const state=createReactStore({x:1});let pass=true;
 const selected=selectReactStore(state,value=>{if(!pass)throw Error('selector failed');return{x:value.x}},(a,b)=>a.x===b.x);
 state.set({x:2});pass=false;assert.throws(()=>selected.getSnapshot(),/selector failed/);assert.throws(()=>selected.getSnapshot(),/selector failed/);pass=true;assert.equal(selected.getSnapshot().x,2);
 const server={x:9},selector=x=>({x:x.x});let memo,deps=[];
 const runtime={useSyncExternalStore:(_subscribe,_get,server)=>server(),useMemo(create,next){if(!memo||next.some((x,i)=>x!==deps[i])){memo=create();deps=next}return memo}};
 const override=()=>server,hook=createReactBindings(runtime);const a=hook.useSelector(state,selector,{serverSnapshot:override}),b=hook.useSelector(state,selector,{serverSnapshot:override});assert.equal(a,b);
});

test('peer capability policy rejects mixed, unsupported and prerelease versions',async()=>{
 const {validateReactVersions}=await import('../dist/render-errors.js');
 for(const pair of [['19.3.1','19.2.0'],['17.0.2','17.0.2'],['18.0.0','18.0.0'],['19.4.0-canary','19.4.0-canary']])assert.throws(()=>validateReactVersions(...pair),e=>e.code==='REACT_PEER_VERSION_MISMATCH');
 assert.equal(validateReactVersions('18.3.1','18.3.1'),18);assert.equal(validateReactVersions(React.version,React.version),19);
});

test('incomplete native SSR cannot return a development template with a private cause',async()=>{
 function Failure(){throw Error('PRIVATE_SUSPENSE_DETAIL')}
 const view=React.createElement(React.Suspense,{fallback:React.createElement('p',null,'unavailable')},React.createElement(Failure));
 await assert.rejects(renderReactToString(view),error=>error.code==='REACT_INCOMPLETE_SSR'&&!JSON.stringify(error).includes('PRIVATE_SUSPENSE_DETAIL'));
});
