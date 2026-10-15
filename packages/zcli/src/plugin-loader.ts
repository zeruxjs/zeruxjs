import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,join,dirname,parse} from 'node:path';
import {createRequire} from 'node:module';
import {resolvePluginEntry} from './plugins.js';
import type {CommandRegistry} from './commands.js';
export interface PluginContext { commands:CommandRegistry; keyword?:string }
export interface LoadedPlugin { name:string; entry:string }
function readManifest(file:string): Record<string,unknown> {
  if(statSync(file).size>256*1024)throw new Error('Plugin manifest too large');
  const raw=JSON.parse(readFileSync(file,'utf8'));
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid package.json');
  return raw as Record<string,unknown>;
}
/** Locate manifests even when package.json is blocked by the exports map. */
function locateManifest(name:string,require:ReturnType<typeof createRequire>):string {
  try {return require.resolve(`${name}/package.json`);} catch(error) {
    const entry=require.resolve(name);let cursor=dirname(realpathSync(entry));
    while(true){const candidate=join(cursor,'package.json');try{if(readManifest(candidate).name===name)return candidate;}catch{}
      const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;
    }
    throw new Error(`Unable to locate package manifest for ${name}`);
  }
}
/** Plugin activation is opt-in; never execute every node_modules package. */
export async function loadPlugins(specifiers:readonly string[],registry:CommandRegistry,fromDirectory=process.cwd()):Promise<LoadedPlugin[]> {
  const require=createRequire(join(resolve(fromDirectory),'package.json'));
  const loaded:LoadedPlugin[]=[];const seen=new Set<string>();
  for(const name of specifiers){
    if(typeof name!=='string'||!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)||name.startsWith('.')||name.includes('..'))throw new TypeError(`Invalid plugin package: ${name}`);
    const manifest=locateManifest(name,require);
    const root=realpathSync(dirname(manifest));const pkg=readManifest(manifest);
    if(pkg.name!==name)throw new Error(`Plugin package mismatch: ${name}`);
    if(!pkg.zerux)throw new Error(`No zerux entry for ${name}`);
    const entry=resolvePluginEntry(root,pkg.zerux);
    if(seen.has(entry))continue;seen.add(entry);
    const plugin=await import(entry) as {register?:(ctx:PluginContext)=>unknown;default?:((ctx:PluginContext)=>unknown)};
    const register=plugin.register ?? plugin.default;
    if(typeof register!=='function')throw new Error(`Plugin ${name} does not export a registration function`);
    await register({commands:registry});loaded.push({name,entry});
  }
  return loaded;
}
/** Explicit workspace configuration: package.json > zeruxCli > plugins. */
export async function loadConfiguredPlugins(registry:CommandRegistry,fromDirectory=process.cwd()):Promise<LoadedPlugin[]> {
  const manifest=readManifest(join(resolve(fromDirectory),'package.json'));
  const section=manifest.zeruxCli;
  if(section===undefined)return [];
  if(!section||typeof section!=='object'||Array.isArray(section))throw new TypeError('zeruxCli must be an object');
  const names=(section as {plugins?:unknown}).plugins ?? [];
  if(!Array.isArray(names)||names.length>100||names.some(name=>typeof name!=='string'))throw new TypeError('zeruxCli.plugins must contain package names');
  return loadPlugins(names as string[],registry,fromDirectory);
}
