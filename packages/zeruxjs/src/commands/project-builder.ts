import {assertSafeBuildDirectories,assertDisjointBuildSources} from './build-paths.js';
import {ModuleBoundaryError,classifyModules,loadBuildParser,rewriteClientModule,type BuildSource} from '../compiler/module-boundaries.js';
import {prepareConfiguration} from '../bootstrap/config-validation.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { ZeruxConfig } from '../index.js';

const SOURCE_DIRS = ['app', 'middleware', 'controllers', 'composables', 'plugins', 'public', 'lib', 'components'];
const CODE = /\.(?:ts|tsx|mts|cts)$/;
const emittedFile=(file:string)=>file.replace(CODE,ext=>ext==='.mts'?'.mjs':ext==='.cts'?'.cjs':'.js');
const MAX_FILE = 16 * 1024 * 1024;
const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.zerux']);
export interface ProjectBuildOptions {
  rootDir: string;
  /** Logical names to leading-client source paths, or prebundled public asset URLs. */
  clientEntries?: Record<string, string>;
  serviceName?: string;
  config?: ZeruxConfig;
  /** Testable compiler seam; production uses the project's TypeScript dependency. */
  transform?: (source: string, fileName: string, context?:{environment:'server'|'client'}) => Promise<string> | string;
}
export interface ProductionBuildManifest {
  rendering?:{serverManifest:'server-manifest.json';assetsManifest:'public-assets.json'};
  schema: 1; files: number; bytes: number; digest: string; directories: Record<string, string>;
}

function projectRelative(root: string, value: string) {
  const full = path.resolve(root, value);
  const rel = path.relative(root, full);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error(`Invalid project source path: ${value}`);
  if (rel.split(path.sep).some(part => ignored.has(part))) throw new Error(`Generated directories cannot be build sources: ${value}`);
  return rel;
}

async function* scan(base: string, root: string): AsyncGenerator<string> {
  const info = await fs.lstat(base);
  if (info.isSymbolicLink()) throw new Error(`Symlink is not an allowed build source: ${base}`);
  if (info.isFile()) { yield base; return; }
  if (!info.isDirectory()) throw new Error(`Unsupported build source: ${base}`);
  for (const entry of (await fs.readdir(base)).sort()) {
    if (ignored.has(entry)) continue;
    const file = path.join(base, entry);
    if (!file.startsWith(root + path.sep)) throw new Error('Unsafe build path');
    yield* scan(file, root);
  }
}
async function defaultTransformer(root: string, client=false) {
  let esm = false;
  try { esm = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).type === 'module'; }
  catch { /* Node defaults to CommonJS without type:module. */ }
  const moduleName = 'typescript';
  const { createRequire } = await import('node:module');
  const require = createRequire(path.join(root, 'package.json'));
  const ts = require(moduleName) as any;
  return (source: string, fileName: string) => {
    const output = ts.transpileModule(source, { fileName, compilerOptions: {
      module: !client && (fileName.endsWith('.cts') || (!esm && !fileName.endsWith('.mts'))) ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
      moduleResolution: !client && (fileName.endsWith('.cts') || (!esm && !fileName.endsWith('.mts'))) ? ts.ModuleResolutionKind.Node10 : ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
    }, reportDiagnostics: true });
    const errors = output.diagnostics?.filter((d: { category: number }) => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(`TypeScript transform failed for ${fileName}: ${ts.flattenDiagnosticMessageText(errors[0].messageText, '\n')}`);
    return output.outputText;
  };
}

/** Stages a deterministic production directory and replaces the old build only on success. */
export async function buildProjectSources(options: ProjectBuildOptions): Promise<ProductionBuildManifest> {
  const root = path.resolve(options.rootDir);
  const config = (await prepareConfiguration(options.config ?? {})).config;
  const serviceName = options.serviceName ?? 'zerux';
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(serviceName)) throw new Error('Invalid service name');
  const outputRelative = config.outDir ?? `.${serviceName}`;
  const outputRoot = path.resolve(root, outputRelative);
  if (outputRoot === root || !outputRoot.startsWith(root + path.sep)) throw new Error('Build output must be inside the project');
  const relativeOutput = path.relative(root, outputRoot).split(path.sep).join('/');
  if ([...SOURCE_DIRS].some(dir => outputRoot === path.join(root, dir))) throw new Error('Build output cannot overwrite application sources');
  const final = path.join(outputRoot, 'build');
  const staging = path.join(outputRoot, `.build-${randomUUID()}`);
  const backup = path.join(outputRoot, `.build-old-${randomUUID()}`);
  const structure = config.structure ?? {};
  const directories: Record<string, string> = {};
  const sourcePaths = new Set<string>();
  const publicRoots:string[]=[],serverRoots:string[]=[],appRoots:string[]=[];let scriptBytes=0;let entryRelative:string|undefined;const buildSources:BuildSource[]=[],publicAssets:{url:string;integrity:string;bytes:number;kind:string;priority:number;source:string}[]=[];
  let entryName: string | undefined;
  for (const ext of ['.ts', '.js', '.mjs', '.cjs', '.mts', '.cts']) {
    const possible = `${config.entryPoint ?? 'index'}${ext}`;
    try {
      if ((await fs.lstat(path.join(root, possible))).isFile()) { entryName = config.entryPoint ?? 'index'; entryRelative=possible.split(path.sep).join('/'); sourcePaths.add(projectRelative(root, possible)); break; }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const key of SOURCE_DIRS) {
    const entry = (structure as Record<string, unknown>)[key] ?? key;
    for (const name of (Array.isArray(entry) ? entry : [entry])) {
      if (typeof name !== 'string') throw new TypeError(`Invalid structure.${key}`);
      const rel = projectRelative(root, name);
      directories[rel] = path.posix.join(relativeOutput, 'build', rel.split(path.sep).join('/'));
      sourcePaths.add(rel);if(key==='public')publicRoots.push(rel.split(path.sep).join('/'));if(['middleware','controllers','plugins'].includes(key))serverRoots.push(rel.split(path.sep).join('/'));if(key==='app')appRoots.push(rel.split(path.sep).join('/'));
    }
  }

  await assertDisjointBuildSources(root, outputRoot, sourcePaths);
  await assertSafeBuildDirectories(root, outputRoot);

  const digest = createHash('sha256');
  let files = 0, bytes = 0;
  const emitted = new Set<string>();
  let published = false, backedUp = false;
  try {
    const info = await fs.lstat(outputRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe build output directory');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  // Refuse attacker-controlled symlink destinations.
  for (const target of [final, staging]) {
    try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error(`Unsafe build target: ${target}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    let transform = options.transform;
    for (const source of [...sourcePaths].sort()) {
      const base = path.join(root, source);
      await assertSafeBuildDirectories(root,path.dirname(base),'build source');
      try { await fs.lstat(base); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for await (const file of scan(base, root)) {
        const relative = path.relative(root, file);
        if (/\.d\.[cm]?ts$/.test(relative)) continue;
        if (emitted.has(relative)) continue; // Nested source roots may overlap.
        emitted.add(relative);
        if (/^\.env(?:\.|$)/.test(path.basename(relative)) || /\.(?:key|pem)$/i.test(relative)) throw new Error(`Potential secret file in build sources: ${relative}`);
        const inputStat = await fs.lstat(file);
        if (!inputStat.isFile() || inputStat.size > MAX_FILE) throw new Error(`Invalid or oversized build source: ${relative}`);
        const raw = await fs.readFile(file);
        const posix=relative.split(path.sep).join('/');const publicRoot=publicRoots.find(base=>posix.startsWith(base+'/'));
        if(/\.[cm]?[jt]sx?$/.test(relative)){scriptBytes+=raw.length;if(buildSources.length>=5000||scriptBytes>64*1024*1024||raw.length>1048576)throw new ModuleBoundaryError('MODULE_GRAPH_LIMIT',[posix]);buildSources.push({relative:posix,source:raw.toString('utf8'),serverOnly:posix===entryRelative||serverRoots.some(base=>posix.startsWith(base+'/')),routeModule:appRoots.some(base=>posix.startsWith(base+'/')),...(publicRoot?{publicPath:posix.slice(publicRoot.length+1)}:{})});}
        const isCode = CODE.test(relative);
        if (isCode && !transform) transform = await defaultTransformer(root);
        const built = isCode ? Buffer.from(await transform!(raw.toString('utf8'), file,{environment:'server'})) : raw;
        const destination = path.join(staging, isCode ? relative.replace(CODE, ext => ext === '.mts' ? '.mjs' : ext === '.cts' ? '.cjs' : '.js') : relative);
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await fs.writeFile(destination, built, { flag: 'wx', mode: 0o600 });
        for(const [priority,base]of publicRoots.entries())if(posix.startsWith(base+'/'))publicAssets.push({url:'/'+emittedFile(posix.slice(base.length+1)),integrity:'sha256-'+createHash('sha256').update(built).digest('base64'),bytes:built.length,kind:'static',priority,source:posix});
        digest.update(relative); digest.update('\0'); digest.update(raw); digest.update('\0');
        files++; bytes += raw.length;
        if (files > 20_000 || bytes > 512 * 1024 * 1024) throw new Error('Project build exceeds safety limits');
      }
    }
    const parser=buildSources.length?await loadBuildParser(root):undefined;
    const classification=parser?classifyModules(parser,buildSources):{modules:[],clientEntries:[],clientModules:new Set<string>(),edges:new Map()};
    const clientOutput=new Map<string,string>(),ids=new Map<string,string>();
    let browserTransform:ProjectBuildOptions['transform'];
    for(const file of [...classification.clientModules].sort()){
      const item=buildSources.find(source=>source.relative===file)!;
      browserTransform??=options.transform??await defaultTransformer(root,true);
      const output=await browserTransform(item.source,path.join(root,file),{environment:'client'});
      if(typeof output!=='string'||Buffer.byteLength(output)>MAX_FILE)throw new Error('Invalid client compiler output');
      clientOutput.set(file,output);ids.set(file,createHash('sha256').update(file).digest('hex').slice(0,24));
    }
    const clientDigest=createHash('sha256');for(const [file,source]of clientOutput){clientDigest.update(file);clientDigest.update('\0');clientDigest.update(source);clientDigest.update('\0');}
    const graphId=clientDigest.digest('hex').slice(0,24),clientRoot=publicRoots[0]??'public';
    const clientAssets:{url:string;integrity:string;bytes:number;kind:string}[]=[];
    for(const [file,source]of clientOutput){
      const output=rewriteClientModule(parser!,file,source,buildSources,ids),id=ids.get(file)!;
      const url=`/_zerux/client/${graphId}/${id}.js`,destination=path.join(staging,clientRoot,'_zerux','client',graphId,id+'.js');
      await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.writeFile(destination,output,{flag:'wx',mode:0o600});
      clientAssets.push({url,integrity:'sha256-'+createHash('sha256').update(output).digest('base64'),bytes:Buffer.byteLength(output),kind:'module'});
      // A public TypeScript source must not retain a CommonJS copy beside the browser asset.
      const publicCopy=buildSources.find(item=>item.relative===file)?.publicPath;
      if(publicCopy!==undefined){const target=path.join(staging,emittedFile(file)),publicOutput=rewriteClientModule(parser!,file,source,buildSources,ids,`/_zerux/client/${graphId}/`);await fs.writeFile(target,publicOutput,{mode:0o600});for(const asset of publicAssets.filter(item=>item.source===file)){asset.integrity='sha256-'+createHash('sha256').update(publicOutput).digest('base64');asset.bytes=Buffer.byteLength(publicOutput);}}
    }
    for(const module of classification.modules)if(module.environment==='client'&&buildSources.find(item=>item.relative===module.path)?.publicPath===undefined)await fs.rm(path.join(staging,emittedFile(module.path)),{force:true});
    const privateManifest={schema:1,modules:classification.modules.map(module=>({...module,...(module.environment!=='client'?{serverFile:emittedFile(module.path)}:{}),...(ids.has(module.path)?{clientAsset:`/_zerux/client/${graphId}/${ids.get(module.path)}.js`}:{})}))};
    const selectedAssets=new Map<string,{url:string;integrity:string;bytes:number;kind:string}>();for(const {priority,source,...asset}of [...publicAssets].sort((a,b)=>a.priority-b.priority))selectedAssets.set(asset.url,asset);for(const asset of clientAssets){if(selectedAssets.has(asset.url))throw new Error('Generated client asset path conflicts with public source');selectedAssets.set(asset.url,asset);}
    const namedEntries:Record<string,string>=Object.create(null);
    if(options.clientEntries!==undefined){
      if(!options.clientEntries||typeof options.clientEntries!=='object'||Array.isArray(options.clientEntries)||Object.keys(options.clientEntries).length>32)throw new TypeError('Invalid client entries');
      for(const [name,target]of Object.entries(options.clientEntries).sort(([a],[b])=>a<b?-1:1)){
        if(!/^[a-z][a-z0-9-]{0,63}$/.test(name)||['constructor','prototype'].includes(name)||typeof target!=='string')throw new TypeError('Invalid client entry');
        const url=target.startsWith('/')?target:classification.clientEntries.some(entry=>entry===target)?`/_zerux/client/${graphId}/${ids.get(target)}.js`:undefined;
        const publicSource=publicAssets.filter(asset=>asset.url===url).sort((a,b)=>a.priority-b.priority).at(-1)?.source;
        if(!url||!selectedAssets.has(url)||!/\.m?js$/.test(url)||(target.startsWith('/')&&!clientAssets.some(asset=>asset.url===url)&&!classification.clientEntries.some(entry=>entry===publicSource)))throw new Error('Client entry is not an emitted JavaScript entry asset');
        namedEntries[name]=url;
      }
    }
    const publicManifest={schema:1,namedEntries,entries:classification.clientEntries.map(file=>`/_zerux/client/${graphId}/${ids.get(file)}.js`),assets:[...selectedAssets.values()].sort((a,b)=>a.url<b.url?-1:a.url>b.url?1:0)};
    await fs.writeFile(path.join(staging,'server-manifest.json'),JSON.stringify(privateManifest,null,2),{flag:'wx',mode:0o600});
    await fs.writeFile(path.join(staging,'public-assets.json'),JSON.stringify(publicManifest,null,2),{flag:'wx',mode:0o600});
    const manifest: ProductionBuildManifest = { schema: 1, rendering:{serverManifest:'server-manifest.json',assetsManifest:'public-assets.json'}, files, bytes, digest: digest.digest('hex'), directories };
    if (entryName) (manifest as ProductionBuildManifest & { entryPoint?: string }).entryPoint = entryName;
    await fs.writeFile(path.join(staging, 'build-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    try { await fs.rename(final, backup); backedUp = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { await fs.rename(staging, final); published = true; }
    catch (error) { if (backedUp) await fs.rename(backup, final); backedUp = false; throw error; }
    if (backedUp) await fs.rm(backup, { recursive: true, force: true });
    return manifest;
  } finally {
    if (!published) await fs.rm(staging, { recursive: true, force: true });
  }
}

/** Production start uses staged code only when an explicit complete build exists. */
export async function resolveProductionStructure(rootDir: string, serviceName: string, config: ZeruxConfig): Promise<ZeruxConfig> {
  const outputRelative = config.outDir ?? `.${serviceName}`;
  const absoluteRoot = path.resolve(rootDir);
  const absoluteOutput = path.resolve(absoluteRoot, outputRelative);
  if (absoluteOutput === absoluteRoot || !absoluteOutput.startsWith(absoluteRoot + path.sep)) throw new Error('Unsafe production build path');
  const relativeOutput = path.relative(absoluteRoot, absoluteOutput).split(path.sep).join('/');
  await assertSafeBuildDirectories(absoluteRoot, absoluteOutput);
  const buildDir = path.resolve(rootDir, relativeOutput, 'build');
  const file = path.join(buildDir, 'build-manifest.json');
  let manifest: ProductionBuildManifest;
  try {
    const buildStat = await fs.lstat(buildDir);
    if (!buildStat.isDirectory() || buildStat.isSymbolicLink()) throw new Error('Unsafe production build directory');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new Error('Unsafe production build manifest');
    manifest = JSON.parse(await fs.readFile(file, 'utf8')) as ProductionBuildManifest;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return config;
    throw error;
  }
  if (manifest.schema !== 1 || !/^[0-9a-f]{64}$/.test(manifest.digest) || !Number.isSafeInteger(manifest.files) || manifest.files < 1) throw new Error('Invalid production build manifest');
  const base = config.structure ?? {};
  const structure = { ...base };
  // Copy-only library/component folders are not runtime structure configuration keys.
  for (const key of SOURCE_DIRS.filter(name=>!['lib','components'].includes(name))) {
    const entry = (base as Record<string, unknown>)[key] ?? key;
    const paths = Array.isArray(entry) ? entry : [entry];
    const mapped = paths.map(value => {
      if (typeof value !== 'string') throw new Error('Invalid production structure');
      const rel = projectRelative(rootDir, value);
      const target = manifest.directories[rel];
      if (target !== path.posix.join(relativeOutput, 'build', rel.split(path.sep).join('/'))) throw new Error(`Incomplete production build: ${rel}`);
      return target;
    });
    (structure as Record<string, unknown>)[key] = Array.isArray(entry) ? mapped : mapped[0];
  }
  const entry = (manifest as ProductionBuildManifest & { entryPoint?: string }).entryPoint;
  return { ...config, structure, ...(entry ? { entryPoint: path.posix.join(relativeOutput, 'build', entry) } : {}) };
}

export {ModuleBoundaryError} from '../compiler/boundary-error.js';
