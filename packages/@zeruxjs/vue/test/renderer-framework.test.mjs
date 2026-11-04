import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import * as Vue from '@vue/runtime-dom';
import {createApplicationLifecycle} from 'zeruxjs';
import {createVueRenderer} from 'zeruxjs/renderers';
import {createVueView} from '../dist/rendering.js';
import {renderVueToString} from '../dist/server.js';
test('real Vue SSR is opt-in through the framework registry and keeps requests separate',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'vue-framework-'));let app,server;
 try{
  app=await createApplicationLifecycle({rootDir:directory,config:{},providers:{database:async()=>null,cache:async()=>null}});
  const api=app.runtime().asPluginApi(),token=api.renderers().register(createVueRenderer(renderVueToString));
  const Component=Vue.defineComponent({props:['label'],setup:props=>()=>Vue.h('p',null,props.label)});
  api.addRoute({pattern:'/vue',handler:context=>context.render(token,createVueView(Component,{label:context.query.get('name')}))});
  server=createServer((req,res)=>void app.handle(req,res).catch(()=>res.destroy()));server.listen(0,'127.0.0.1');await once(server,'listening');
  const results=await Promise.all(['one','two'].map(async name=>(await fetch(`http://127.0.0.1:${server.address().port}/vue?name=${name}`)).text()));assert.deepEqual(results,['<p>one</p>','<p>two</p>']);
 }finally{try{await app?.close()}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}await rm(directory,{recursive:true,force:true})}}
});
