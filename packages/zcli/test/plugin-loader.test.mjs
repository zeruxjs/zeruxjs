import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CommandRegistry,loadConfiguredPlugins,loadPlugins} from '../dist/index.js';
test('explicit workspace plugins share a keyword; npm package exports hide package.json',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zcli-explicit-'));
 try {
  const pkg=join(root,'node_modules','cli-extra');mkdirSync(pkg,{recursive:true});
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'fixture',zeruxCli:{plugins:['cli-extra']}}));
  writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'cli-extra',type:'module',exports:{'.':'./plugin.js'},zerux:'./plugin.js'}));
  writeFileSync(join(pkg,'plugin.js'),"export function register({commands}){commands.register('zerux','extra',()=>0,{description:'installed'})}");
  const registry=new CommandRegistry();registry.register('zerux','build',()=>0);
  const plugins=await loadConfiguredPlugins(registry,root);
  assert.equal(plugins.length,1);assert.equal((await registry.dispatch('zerux',['extra'])).exitCode,0);
  assert.equal((await registry.dispatch('zerux',['build'])).exitCode,0);
  await assert.rejects(loadPlugins(['../../escape'],new CommandRegistry(),root),/Invalid/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
