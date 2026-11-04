import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createTsConfig, checkTypes } from '@zeruxjs/typescript';
const require=createRequire(import.meta.url);

test('offline installed exports own declarations and support legacy and cancellable consumers', () => {
  const root=mkdtempSync(join(tmpdir(),'zclivo-consumer-'));
  try {
    const npm=args=>execFileSync('npm',[...args,'--cache',join(root,'cache')],{cwd:root,encoding:'utf8',timeout:30000});
    const pack=directory=>{const [archive]=Object.values(JSON.parse(npm(['pack',directory,'--ignore-scripts','--json','--pack-destination',root])));return `file:${join(root,archive.filename)}`;};
    const dependencies={zclivo:pack(fileURLToPath(new URL('..',import.meta.url)))};
    for(const name of ['@types/node','undici-types'])dependencies[name]=pack(dirname(require.resolve(name+'/package.json')));
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'consumer',private:true,type:'module',dependencies}));
    npm(['install','--offline','--ignore-scripts','--no-audit','--no-fund']);mkdirSync(join(root,'src'));
    writeFileSync(join(root,'src/index.ts'),`import {CommandRegistry,ZeruxCLI,loadPlugins,type DispatchOptions,type PluginContext,type LoadedPlugin,type CommandResult,type OptionSchema} from 'zclivo';
import {minimalProjectGenerator,createProjectGenerator,registerGeneratorCommand,type ProjectTemplate,type ProjectPlan} from 'zclivo';
import {writeProjectPlanAsync} from 'zclivo/generator';
const template:ProjectTemplate={id:'custom',capabilities:[{mode:'minimal',renderer:'none',languages:['javascript']}],render:options=>({'README.md':options.name})};
const engine=createProjectGenerator([template]);const plan:ProjectPlan=minimalProjectGenerator.plan({destination:'review-only',port:3000});void plan;void writeProjectPlanAsync;
const creator=new CommandRegistry();registerGeneratorCommand(creator,{generator:engine,out:()=>{}});
// @ts-expect-error ports are numeric
minimalProjectGenerator.plan({destination:'review-only',port:'3000'});
const commands=new CommandRegistry();
const flags:OptionSchema={watch:{type:'boolean',conflicts:['mode']},mode:{type:'string'}};
commands.register('app','run',async (_args,context)=>{const signal:AbortSignal=context.signal;context.onDispose(async()=>{});void signal;return 0;},{flags});
const options:DispatchOptions={signal:new AbortController().signal};
const result:CommandResult=await commands.dispatch('app',['run'],console.log,options);
const legacy=new ZeruxCLI([]);legacy.addCommand('zerux','build',async args=>{void args.namedArgs;});await legacy.dispose();
const register=({commands,signal,onDispose}:PluginContext)=>{commands.register('plugin','run',()=>0);onDispose(()=>{});void signal;};void register;
const loaded:LoadedPlugin[]=await loadPlugins([],commands,process.cwd(),options);for(const plugin of loaded)await plugin.dispose();void result;
// @ts-expect-error option types are constrained
const invalid:OptionSchema={flag:{type:'arbitrary'}};void invalid;
`);
    createTsConfig(root,{preset:'node-server'});
    const checked=checkTypes({cwd:root,files:[],checkDependencies:true});
    assert.equal(checked.ok,true,checked.diagnostics.map(item=>JSON.stringify(item.messageText)).join('\n'));
    execFileSync(process.execPath,['--input-type=module','-e',`import {CommandRegistry} from 'zclivo';const registry=new CommandRegistry();registry.register('app','run',()=>0);if((await registry.dispatch('app',['run'])).exitCode!==0)throw new Error('failed');`],{cwd:root,timeout:3000});
    assert.equal(existsSync(join(root,'node_modules/zclivo/src')),false);
  } finally {rmSync(root,{recursive:true,force:true});}
});
