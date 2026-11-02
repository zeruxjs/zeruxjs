import test from 'node:test';import assert from 'node:assert/strict';
import {initializeRuntimeServices} from '../dist/bootstrap/services.js';
import {prepareConfiguration} from '../dist/bootstrap/config-validation.js';
import {selectQueueBackend} from '@zeruxjs/queue/neutral';
import {memcacheQBackend} from '@zeruxjs/queue/backends';
const providers=log=>({database:async()=>({close(){log.push('database');}}),cache:async()=>({close(){log.push('cache');}})});
test('explicit registered backend starts through real framework selection, stays private and closes before dependencies',async()=>{
 const log=[];let opened=0;const factory=memcacheQBackend(options=>{assert.equal(options.host,'private-host');opened++;return {async add(){return;},async take(){},close(){log.push('worker');}};},['jobs']);
 const selection=selectQueueBackend(factory,{host:'private-host'});const prepared=await prepareConfiguration({queue:{enabled:true,selection}});assert.equal(prepared.config.queue.selection.factory,factory);assert.doesNotMatch(JSON.stringify(prepared.publicConfig),/private-host|factory|queue/);
 const scope=await initializeRuntimeServices({queue:{enabled:true,required:true,selection}},process.cwd(),providers(log));const service=scope.get('queue');await service.publish('jobs','task',{});assert.equal(service.name,'memcacheq');assert.ok(service.extension(factory));assert.equal(opened,1);await scope.close();await scope.close();assert.deepEqual(log,['worker','cache','database']);
});
test('invalid unknown options are rejected before database/cache factories, even for optional service',async()=>{
 let calls=0;const factory=memcacheQBackend(()=>{calls++;throw Error('must not open');},['jobs']);
 const p={database:async()=>{calls++;},cache:async()=>{calls++;}};
 for(const queue of [{enabled:true,selection:{factory,options:{unknown:'SECRET'}}},{enabled:true,selection:{factory,options:{},requireCapabilities:['scheduler']}},{enabled:true,selection:{factory,options:{}},redis:{password:'SECRET'}}])await assert.rejects(initializeRuntimeServices({queue},process.cwd(),p),error=>!error.message.includes('SECRET'));
 assert.equal(calls,0);
});
test('required partial startup rolls back in reverse order; optional backend failures log no secret details',async()=>{
 const log=[],base=memcacheQBackend(()=>{throw Error('unused');},['jobs']);const factory={...base,open(_options,scope){scope.onCleanup(()=>log.push('channel'));throw Error('SECRET url/password');}};
 await assert.rejects(initializeRuntimeServices({queue:{enabled:true,required:true,selection:{factory,options:{}}}},process.cwd(),providers(log)),error=>error.code==='START_FAILED'&&!error.message.includes('SECRET'));assert.deepEqual(log,['channel','cache','database']);log.length=0;
 const warnings=[],saved=console.warn;console.warn=(...args)=>warnings.push(args.join(' '));try{const scope=await initializeRuntimeServices({queue:{enabled:true,selection:{factory,options:{}}}},process.cwd(),providers(log));assert.equal(scope.status().find(s=>s.name==='queue').state,'degraded');assert.ok(scope.errors().has('queue'));await scope.close();assert.doesNotMatch(warnings.join(' '),/SECRET|password/);assert.deepEqual(log,['channel','cache','database']);}finally{console.warn=saved;}
});
