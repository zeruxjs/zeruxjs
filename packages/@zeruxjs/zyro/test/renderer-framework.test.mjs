import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createApplicationLifecycle} from 'zeruxjs';
import {createZyroRenderer} from 'zeruxjs/renderers';
import * as Zyro from 'zyrojs/component';
import {renderToString} from 'zyrojs/dom';
import {createObservable} from '../dist/index.js';
import {useZyroRendererBridge} from '../dist/renderer.js';

test('concurrent framework requests retain separate observable sources and dispose SSR bridges',async()=>{
 const root=await mkdtemp(join(tmpdir(),'zyro-renderer-'));
 let application,server;
 const bridges=[],sources=[];
 try{
  application=await createApplicationLifecycle({rootDir:root,config:{},providers:{database:async()=>null,cache:async()=>null}});
  const api=application.runtime().asPluginApi();
  const renderer=api.renderers().register(createZyroRenderer(renderToString));
  const View=Zyro.defineComponent(props=>{
   const source=createObservable(props.name);sources.push(source);Zyro.onScopeDispose(()=>source.destroy());
   const bridge=useZyroRendererBridge(Zyro);bridges.push(bridge);const selected=bridge.read(source);
   return ()=>Zyro.h('p',{},selected.value);
  });
  api.addRoute({pattern:'/bridge',handler:context=>context.render(renderer,Zyro.h(View,{name:context.query.get('name')}))});
  server=createServer((req,res)=>void application.handle(req,res).catch(()=>res.destroy()));server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}/bridge`;
  const results=await Promise.all(['one','two'].map(async name=>(await fetch(`${url}?name=${name}`)).text()));
  assert.deepEqual(results,['<p>one</p>','<p>two</p>']);assert.notEqual(sources[0],sources[1]);
  assert.equal(bridges.length,2);assert.ok(bridges.every(bridge=>bridge.destroyed&&bridge.activeConnections===0));
 }finally{
  try{await application?.close()}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}await rm(root,{recursive:true,force:true})}
 }
});
