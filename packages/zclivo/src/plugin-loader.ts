import {readSync,realpathSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {resolvePluginEntry} from './plugins.js';
import type {CommandRegistry} from './commands.js';
import { ResourceScope, type Disposer } from './lifecycle.js';
export interface PluginContext { commands:CommandRegistry; keyword?:string; signal:AbortSignal; onDispose:(dispose:Disposer)=>void }
export interface PluginLoadOptions { signal?:AbortSignal }
export interface LoadedPlugin { name:string; entry:string; signal:AbortSignal; /** Abort active commands, remove registrations, await cooperative completion and cleanup. */ dispose:()=>Promise<void> }
function readManifest(file:string): Record<string,unknown> {
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let raw;
  try {const info=fstatSync(fd);if(!info.isFile()||info.size>256*1024)throw new Error('Plugin manifest too large');const buffer=Buffer.alloc(info.size+1),size=readSync(fd,buffer,0,buffer.length,0);if(size>info.size)throw new Error('Plugin manifest changed');raw=JSON.parse(buffer.subarray(0,size).toString('utf8'));}finally{closeSync(fd);}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid package.json');
  return raw as Record<string,unknown>;
}
/** Locate manifests even when package.json is blocked by the exports map. */
function locateManifest(name:string,require:ReturnType<typeof createRequire>):string {
  try {return require.resolve(`${name}/package.json`);} catch(error) {
    const entry=require.resolve(name);let cursor=dirname(realpathSync(entry));
    while(true){const candidate=join(cursor,'package.json');try{if(readManifest(candidate).name===name)return candidate;}catch{ /* This optional failure is intentionally ignored. */ }
      const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;
    }
    throw new Error(`Unable to locate package manifest for ${name}`);
  }
}
/** Plugin activation is opt-in; never execute every node_modules package. */
export async function loadPlugins(specifiers:readonly string[],registry:CommandRegistry,fromDirectory=process.cwd(),options:PluginLoadOptions={}):Promise<LoadedPlugin[]> {
  if (!Array.isArray(specifiers) || specifiers.length > 100) throw new TypeError('Plugin allowlist must contain at most 100 names');
  if (!options || typeof options !== 'object' || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) throw new TypeError('Invalid plugin load options');
  options.signal?.throwIfAborted();
  // Validate the complete allowlist before executing even its first entry.
  for (const name of specifiers) if(typeof name!=='string'||name.length>214||!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)||name.startsWith('.')||name.includes('..')) throw new TypeError('Invalid plugin package');
  const require=createRequire(join(resolve(fromDirectory),'package.json'));
  const loaded:LoadedPlugin[]=[]; const seen=new Set<string>();
  try {
    for(const name of specifiers){
      options.signal?.throwIfAborted();
      const manifest=locateManifest(name,require);
      const root=realpathSync(dirname(manifest)); const pkg=readManifest(manifest);
      if(pkg.name!==name)throw new Error(`Plugin package mismatch: ${name}`);
      if(!pkg.zerux)throw new Error(`No zerux entry for ${name}`);
      const entry=resolvePluginEntry(root,pkg.zerux);
      if(seen.has(entry))continue; seen.add(entry);
      const plugin=await import(entry) as {register?:(ctx:PluginContext)=>unknown;default?:((ctx:PluginContext)=>unknown)};
      options.signal?.throwIfAborted();
      const register=plugin.register ?? plugin.default;
      if(typeof register!=='function')throw new Error(`Plugin ${name} does not export a registration function`);
      const scope = new ResourceScope([options.signal]);
      let remove:Disposer;
      try {
        remove = await registry.transaction(async commands => {
          const dispose = await register({commands, signal:scope.signal, onDispose:scope.onDispose});
          if (typeof dispose === 'function') scope.onDispose(dispose as Disposer);
        }, scope.signal);
      } catch (error) {
        const errors = await scope.close();
        if (errors.length) throw new AggregateError([error,...errors], 'Plugin registration and cleanup failed', {cause:error});
        throw error;
      }
      let disposal:Promise<void>|undefined;
      loaded.push({name,entry,signal:scope.signal,dispose:()=>disposal ??= (async()=>{
        scope.abort();
        await remove();
        const errors = await scope.close();
        if (errors.length) throw new AggregateError(errors, 'Plugin resource cleanup failed');
      })()});
    }
    return loaded;
  } catch (error) {
    const errors:unknown[]=[];
    for (const plugin of loaded.reverse()) { try { await plugin.dispose(); } catch (failure) { errors.push(failure); } }
    if (errors.length) throw new AggregateError([error,...errors], 'Plugin loading and rollback failed', {cause:error});
    throw error;
  }
}
/** Explicit workspace configuration: package.json > zeruxCli > plugins. */
export async function loadConfiguredPlugins(registry:CommandRegistry,fromDirectory=process.cwd(),options:PluginLoadOptions={}):Promise<LoadedPlugin[]> {
  const manifest=readManifest(join(resolve(fromDirectory),'package.json'));
  const section=manifest.zeruxCli;
  if(section===undefined)return [];
  if(!section||typeof section!=='object'||Array.isArray(section))throw new TypeError('zeruxCli must be an object');
  const names=(section as {plugins?:unknown}).plugins ?? [];
  if(!Array.isArray(names)||names.length>100||names.some(name=>typeof name!=='string'))throw new TypeError('zeruxCli.plugins must contain package names');
  return loadPlugins(names as string[],registry,fromDirectory,options);
}
