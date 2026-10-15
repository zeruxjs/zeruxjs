import {test} from 'node:test';import assert from 'node:assert/strict';
import {CommandRegistry,parseArguments,validateOptions} from '../dist/index.js';
test('typed flags validate defaults, aliases, choices and rejected values',async()=>{
 const flags={port:{type:'number',required:true,alias:'p'},env:{type:'string',choices:['dev','prod'],default:'dev'},verbose:{type:'boolean',default:false}};
 const registry=new CommandRegistry();let captured;
 registry.register('app','serve',(_args,ctx)=>{captured=ctx.options;},{flags});
 assert.equal((await registry.dispatch('app',['serve','-p','4300','--env','prod'])).exitCode,0);
 assert.deepEqual({...captured},{port:4300,env:'prod',verbose:false});
 assert.equal((await registry.dispatch('app',['serve','--port','abc'])).exitCode,1);
 assert.equal((await registry.dispatch('app',['serve','--port','2','--env','stage'])).exitCode,1);
 assert.equal((await registry.dispatch('app',['serve','--port','2','--unexpected'])).exitCode,1);
 assert.equal((await registry.dispatch('app',['serve'])).exitCode,1);
});
