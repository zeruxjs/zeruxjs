import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CommandRegistry,ZeruxCLI} from '../dist/index.js';
test('supports multiple keyword registries, alias dispatch, help, docs and completion',async()=>{
 const registry=new CommandRegistry();const messages=[];
 registry.registerKey('zerux','Framework');registry.register('zerux','build',async(args,ctx)=>{assert.equal(args.namedArgs.out,'dist');assert.equal(ctx.command,'build');return 0;},{aliases:['b'],description:'Compile',docs:'Detailed docs',example:'zerux build'});
 registry.register('zyro','render',()=>0);
 assert.deepEqual(registry.keywords(),['zerux','zyro']);
 assert.deepEqual(registry.complete('zerux','b'),['b','build']);
 assert.equal((await registry.dispatch('zerux',['b','--out','dist'])).exitCode,0);
 assert.equal((await registry.dispatch('zerux',['build','--help'],s=>messages.push(s))).exitCode,0);
 assert.match(messages[0],/Compile/);
 assert.equal((await registry.dispatch('zerux',['missing'])).exitCode,2);
 assert.equal(registry.docs('zerux','build'),'Detailed docs');
});
test('invalid command and conflicting alias rejected',()=>{
 const registry=new CommandRegistry(); registry.register('app','run',()=>{}, {aliases:['r']});
 assert.throws(()=>registry.register('app','r',()=>{}));
 assert.throws(()=>registry.register('app','../../escape',()=>{}));
 assert.throws(()=>registry.register('app','serve',()=>{},{aliases:['r']}));
});
test('handler exceptions return errors without forcing process exit',async()=>{
 const registry=new CommandRegistry(); registry.register('demo','fail',()=>{throw new Error('boom');});
 const result=await registry.dispatch('demo',['fail']);assert.equal(result.exitCode,1);assert.match(result.message,/boom/);
});
test('legacy addKey and addCommand retains registry compatibility',()=>{
 const cli=new ZeruxCLI(['dev','--port','4000']);let value;
 cli.addCommand('zerux','dev',args=>{value=args.namedArgs.port;});
 cli.registry.registerKey('zerux');assert.ok(cli.registry.lookup('zerux','dev'));
});
