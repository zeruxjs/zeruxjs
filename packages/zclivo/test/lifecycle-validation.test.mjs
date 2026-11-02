import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry, loadPlugins, stripTerminalCodes, formatError, parseArguments } from 'zclivo';

test('typed aliases, repeated values, booleans and separator retain positionals', async () => {
  const registry = new CommandRegistry(); let captured;
  registry.register('app', 'build', (args, context) => { captured = {args, options:context.options}; }, { aliases:['b'], flags:{verbose:{type:'boolean',alias:'v'},tag:{type:'string'},count:{type:'number'}} });
  assert.equal((await registry.dispatch('app', ['b','-v','file','--tag=a','--tag=b','--count','-2','--','--help','-d'])).exitCode, 0);
  assert.deepEqual(captured.args.positionalArgs, ['file','--help','-d']);
  assert.deepEqual({...captured.options}, {verbose:true,tag:['a','b'],count:-2});
});

test('usage errors and conflict diagnostics do not execute handlers', async () => {
  const registry = new CommandRegistry(); let calls = 0;
  registry.register('app','build',()=>{calls++;}, {flags:{mode:{type:'string',conflicts:['watch']},watch:{type:'boolean'},workers:{type:'number'}}});
  assert.match((await registry.dispatch('app',['biuld'])).message,/build/);
  assert.match((await registry.dispatch('app',['build','--worker','3'])).message,/Did you mean workers/);
  for (const args of [['build','--mode'],['build','--mode=x','--watch'],['build','--workers=NaN'],['build','--bad!'],['build','-workers=2']]) assert.equal((await registry.dispatch('app',args)).exitCode,2);
  assert.equal(calls,0);assert.throws(()=>parseArguments(['--x\r\nInjected=value']));
  assert.equal((await registry.dispatch('app',[null])).exitCode,2);
});

test('registration validates before mutation and snapshots nested definitions', () => {
  const registry = new CommandRegistry();
  assert.throws(()=>registry.register('fresh','run',()=>{}, {aliases:['run']}),/conflict/);
  assert.deepEqual(registry.keywords(),[]);
  assert.throws(()=>registry.register('fresh','run',()=>{}, {flags:{value:{type:'invalid'}}}));
  const flags={mode:{type:'string',choices:['safe']}}; const aliases=['r'];
  registry.register('app','run',()=>{}, {flags,aliases}); flags.mode.choices.push('unsafe');aliases.push('hacked');
  assert.deepEqual(registry.lookup('app','run').options.flags.mode.choices,['safe']);assert.equal(registry.lookup('app','hacked'),undefined);
});

test('async rejection retains cause and all cleanup failures while continuing LIFO cleanup', async () => {
  const registry = new CommandRegistry(); const cause=new Error('backend unavailable'); const cleanup=new Error('cleanup unavailable'); const order=[];
  registry.register('app','run',async (_args, context)=> {
    context.onDispose(()=>{order.push(1);});context.onDispose(()=>{order.push(2);throw cleanup;});throw cause;
  });
  const result=await registry.dispatch('app',['run']);
  assert.equal(result.exitCode,1);assert.equal(result.error,cause);assert.deepEqual(result.cleanupErrors,[cleanup]);assert.deepEqual(order,[2,1]);
  registry.register('app','bad-status',()=>NaN);assert.equal((await registry.dispatch('app',['bad-status'])).exitCode,1);
});

test('interruption waits for cooperative handler and clears its timer exactly once', async () => {
  const registry = new CommandRegistry();const controller=new AbortController();let started;const ready=new Promise(resolve=>{started=resolve;});let cleaned=0;
  registry.register('app','wait',async (_args,context)=>{
    const timer=setInterval(()=>{},1000);context.onDispose(()=>{clearInterval(timer);cleaned++;});started();
    await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));
  });
  const pending=registry.dispatch('app',['wait'],undefined,{signal:controller.signal});await ready;controller.abort(new Error('private reason'));
  const result=await pending;assert.equal(result.exitCode,130);assert.equal(result.cancelled,true);assert.equal(cleaned,1);assert.doesNotMatch(result.message,/private/);
  assert.equal((await registry.dispatch('app',['wait'],undefined,{signal:controller.signal})).exitCode,130);assert.equal(cleaned,1);
});

test('help, errors and formatting strip CSI, OSC, CR and controls', async () => {
  const attack='safe\x1b[2J\x1b]52;c;clipboard\x07\r\x00';
  assert.equal(stripTerminalCodes(attack),'safe');assert.equal(formatError(new Error(attack)),'Error: safe');
  const registry=new CommandRegistry();registry.register('app','run',()=>{throw new Error(attack);},{description:attack,docs:attack});
  assert.doesNotMatch(registry.help('app'),/[\x00\x1b\r]/);assert.equal(registry.docs('app','run'),'safe');assert.equal((await registry.dispatch('app',['run'])).message,'safe');
});

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'zclivo-lifecycle-'));writeFileSync(join(root,'package.json'),JSON.stringify({name:'fixture',type:'module'}));
  const plugin=(name,source)=>{const dir=join(root,'node_modules',name);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({name,type:'module',exports:'./plugin.js',zerux:'./plugin.js'}));writeFileSync(join(dir,'plugin.js'),source);};
  return {root,plugin,close:()=>rmSync(root,{recursive:true,force:true})};
}

test('plugin conflict rolls back partial registration and releases acquired resources', async () => {
  const f=fixture();try {
    const marker=join(f.root,'cleaned');
    f.plugin('conflicting',`import {writeFileSync} from 'node:fs';export function register({commands,onDispose}){onDispose(()=>writeFileSync(${JSON.stringify(marker)},'done'));commands.register('app','partial',()=>{});commands.register('app','run',()=>{});}`);
    const registry=new CommandRegistry();registry.register('app','run',()=>0);
    await assert.rejects(loadPlugins(['conflicting'],registry,f.root),/already registered/);
    assert.equal(registry.lookup('app','partial'),undefined);assert.equal((await registry.dispatch('app',['run'])).exitCode,0);assert.equal(readFileSync(marker,'utf8'),'done');
  } finally {f.close();}
});

test('dependency import failure removes earlier plugins from the same load batch', async () => {
  const f=fixture();try {
    f.plugin('working',`export function register({commands}){commands.register('app','added',()=>0);}`);
    f.plugin('broken',`import 'zclivo-deliberately-missing-dependency';export function register(){}`);
    const registry=new CommandRegistry();registry.register('app','original',()=>0);
    await assert.rejects(loadPlugins(['working','broken'],registry,f.root),/zclivo-deliberately-missing-dependency/);
    assert.equal(registry.lookup('app','added'),undefined);assert.ok(registry.lookup('app','original'));
  } finally {f.close();}
});

test('plugin disposal interrupts active commands, removes owned entries and reports cleanup failure', async () => {
  const f=fixture();try {
    f.plugin('waiting',`export function register({commands,onDispose}){onDispose(()=>{throw new Error('plugin cleanup failure')});commands.register('app','wait',async (_args,context)=>{await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));});}`);
    const registry=new CommandRegistry();registry.register('app','keep',()=>0);const [plugin]=await loadPlugins(['waiting'],registry,f.root);
    const pending=registry.dispatch('app',['wait']);await assert.rejects(plugin.dispose(),/cleanup failed/);
    assert.equal((await pending).exitCode,130);assert.equal(registry.lookup('app','wait'),undefined);assert.ok(registry.lookup('app','keep'));
    await assert.rejects(plugin.dispose(),/cleanup failed/);
  } finally {f.close();}
});

test('concurrent registration does not overwrite a live registry change', async () => {
  const registry=new CommandRegistry();let resume;const gate=new Promise(resolve=>{resume=resolve;});
  const pending=registry.transaction(async commands=>{commands.register('app','staged',()=>{});await gate;});
  registry.register('app','live',()=>{});resume();await assert.rejects(pending,/Registry changed/);
  assert.equal(registry.lookup('app','staged'),undefined);assert.ok(registry.lookup('app','live'));
});

test('scope completion unlinks upstream listeners on success and plugin disposal', async () => {
  const {getEventListeners}=await import('node:events');
  const controller=new AbortController();const registry=new CommandRegistry();
  registry.register('app','run',()=>0);
  const count=getEventListeners(controller.signal,'abort').length;
  assert.equal((await registry.dispatch('app',['run'],undefined,{signal:controller.signal})).exitCode,0);
  assert.equal(getEventListeners(controller.signal,'abort').length,count);
  const f=fixture();try {
    f.plugin('normal',`export function register({commands,onDispose}){commands.register('app','extra',()=>0);onDispose(()=>{});}`);
    const [plugin]=await loadPlugins(['normal'],registry,f.root,{signal:controller.signal});
    assert.equal((await registry.dispatch('app',['extra'])).exitCode,0);
    await plugin.dispose();await plugin.dispose();
    assert.equal(registry.lookup('app','extra'),undefined);assert.equal(getEventListeners(controller.signal,'abort').length,count);
  }finally{f.close();}
});

test('standalone entry point sanitizes unknown-command diagnostics and suggests commands', async () => {
  const {runZcli}=await import('../dist/bin.js');const messages=[];
  assert.equal(runZcli(['creat'],()=>{},message=>messages.push(message)),2);
  assert.match(messages[0],/Did you mean create/);
  assert.equal(runZcli(['bad\x1b[2J\r'],()=>{},message=>messages.push(message)),2);
  assert.doesNotMatch(messages[1],/[\x1b\r]/);
  assert.equal(runZcli([null],()=>{},()=>{}),2);
});

test('shared plugin keywords disappear after disposal in either order', async () => {
  const f=fixture();try {
    f.plugin('first',`export function register({commands}){commands.registerKey('shared','Plugin commands');commands.register('shared','first',()=>0);}`);
    f.plugin('second',`export function register({commands}){commands.register('shared','second',()=>0);}`);
    const registry=new CommandRegistry();const [first,second]=await loadPlugins(['first','second'],registry,f.root);
    await first.dispose();assert.equal((await registry.dispatch('shared',['second'])).exitCode,0);
    await second.dispose();assert.deepEqual(registry.keywords(),[]);
  }finally{f.close();}
});
