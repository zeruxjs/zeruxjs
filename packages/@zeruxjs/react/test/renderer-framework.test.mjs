import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import * as React from 'react';
import {createApplicationLifecycle} from 'zeruxjs';
import {createReactRenderer} from 'zeruxjs/renderers';
import {createReactBindings} from '../dist/index.js';
import {renderReactToString} from '../dist/server.js';
import {createReactHydrationState} from '../dist/hydration.mjs';
const bindings=createReactBindings(React);
test('framework registry uses real React SSR with isolated request snapshots',async()=>{
 const root=await mkdtemp(join(tmpdir(),'react-framework-'));let app,server;
 try{
  app=await createApplicationLifecycle({rootDir:root,config:{},providers:{database:async()=>null,cache:async()=>null}});
  const api=app.runtime().asPluginApi(),token=api.renderers().register(createReactRenderer(renderReactToString));
  function View({store}){return React.createElement('p',null,bindings.useStore(store).label)}
  api.addRoute({pattern:'/react',handler:async context=>{
   const state=createReactHydrationState({label:context.query.get('name')},{identifierPrefix:'request',validateState:value=>{if(typeof value.label!=='string')throw Error('invalid');return{label:value.label}}});
   try{return await context.render(token,React.createElement(View,{store:state.store}))}finally{state.dispose()}
  }});
  server=createServer((req,res)=>void app.handle(req,res).catch(()=>res.destroy()));server.listen(0,'127.0.0.1');await once(server,'listening');
  const results=await Promise.all(['one','two'].map(async name=>(await fetch(`http://127.0.0.1:${server.address().port}/react?name=${name}`)).text()));
  assert.deepEqual(results,['<p>one</p>','<p>two</p>']);
 }finally{try{await app?.close()}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}await rm(root,{recursive:true,force:true})}}
});
