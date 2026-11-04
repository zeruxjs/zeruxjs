import { ApplicationError } from './exceptions/api-error.js';
import type { ZeruxPluginApi, ZeruxRequestContext, MiddlewareFunction } from './bootstrap/types.js';

export interface ProviderToken<T> { readonly key: symbol; readonly name: string; readonly valueType?: T }
export function createProviderToken<T>(name: string): ProviderToken<T> {
  if (typeof name !== 'string' || !/^[A-Za-z][\w.-]{0,63}$/.test(name)) throw new TypeError('Invalid provider name');
  return Object.freeze({ key: Symbol(name), name });
}
type Values<D extends readonly ProviderToken<unknown>[]> = { [K in keyof D]: D[K] extends ProviderToken<infer T> ? T : never };
export interface ProviderConstruction { readonly signal: AbortSignal; readonly request?: ZeruxRequestContext; onDispose(cleanup:()=>void|Promise<void>):void }
export interface ProviderDefinition<T = any> {
  token: ProviderToken<T>; scope: 'singleton'|'request'|'transient'; dependencies: readonly ProviderToken<unknown>[];
  create(context: ProviderConstruction, ...dependencies: any[]): T | Promise<T>;
  dispose?(value: T): void | Promise<void>; eager?: boolean;
}
/** Explicit constructor metadata; no decorators, reflect metadata or package discovery. */
export function defineProvider<T, const D extends readonly ProviderToken<unknown>[]>(definition: {
  token: ProviderToken<T>; scope: ProviderDefinition['scope']; dependencies: D;
  create(context: ProviderConstruction, ...dependencies: Values<D>): T | Promise<T>;
  dispose?(value: T): void | Promise<void>; eager?: boolean;
}): ProviderDefinition<T> { return definition; }
export interface ModuleResolver { get<T>(token: ProviderToken<T>): Promise<T> }
/** Standard Schema v1 structural contract: schema implementation/types remain package-owned. */
export type ModuleInputSchema<T> = import('./bootstrap/service-definitions.js').ServiceConfigSchema<T>;
export interface ModuleController<T = any> {
  path: string; method?: string;
  guards?: readonly ((context: ZeruxRequestContext) => boolean | Promise<boolean>)[];
  schema?: ModuleInputSchema<T>;
  middleware?: readonly MiddlewareFunction[];
  handle(input: T, context: ZeruxRequestContext, providers: ModuleResolver): unknown | Promise<unknown>;
  /** Handles module guard/pipe/middleware/handler failures; never receives disposal failures. */
  filter?(error: unknown, context: ZeruxRequestContext): unknown | Promise<unknown>;
  /** Observation after accepted request providers settle/dispose; never changes a committed response. */
  onDispose?(context: ZeruxRequestContext, error?: unknown): void | Promise<void>;
}
/** Preserve schema output inference when storing heterogeneous controllers in a module. */
export function defineController<T>(controller: ModuleController<T>): ModuleController<T> { return controller; }
export interface ModuleDefinition { name: string; providers?: readonly ProviderDefinition[]; controllers?: readonly ModuleController[] }
export class ModuleError extends ApplicationError {
  constructor(readonly code: string, readonly statusCode = 500, options?: ErrorOptions) { super(statusCode, options?.cause); this.name='ModuleError'; }
}
/** Register once per generation from an explicit plugin/entry function. All providers are private. */
export async function registerModule(api: ZeruxPluginApi, definition: ModuleDefinition) {
  if (!api || typeof api.onDispose !== 'function' || typeof api.hasRoute !== 'function' || !definition || !/^[A-Za-z][\w.-]{0,63}$/.test(definition.name)) throw new ModuleError('MODULE_INVALID');
  if (definition.providers!==undefined&&!Array.isArray(definition.providers)||definition.controllers!==undefined&&!Array.isArray(definition.controllers)) throw new ModuleError('MODULE_INVALID');
  const providers = new Map<symbol, ProviderDefinition>(), controllers = (definition.controllers??[]).map((item:ModuleController)=>({...item,guards:[...(item.guards??[])],middleware:[...(item.middleware??[])]}));
  if ((definition.providers?.length??0)>128 || controllers.length>128) throw new ModuleError('MODULE_LIMIT');
  for (const item of definition.providers??[]) {
    if (!item || !item.token || typeof item.token.key!=='symbol' || !['singleton','request','transient'].includes(item.scope) || !Array.isArray(item.dependencies) || item.dependencies.length>32 || typeof item.create!=='function' || item.dispose!==undefined&&typeof item.dispose!=='function' || item.eager!==undefined&&typeof item.eager!=='boolean' || item.eager&&item.scope!=='singleton' || providers.has(item.token.key)) throw new ModuleError('PROVIDER_INVALID');
    providers.set(item.token.key,{...item,dependencies:[...item.dependencies]});
  }
  const visiting=new Set<symbol>(),visited=new Set<symbol>();
  function visit(key:symbol,chain:string[]) {
    const p=providers.get(key);if(!p)throw new ModuleError('PROVIDER_DEPENDENCY_MISSING');
    if(visiting.has(key))throw new ModuleError(`PROVIDER_CYCLE:${[...chain,p.token.name].join(' -> ')}`);
    if(visited.has(key))return;visiting.add(key);
    for(const dep of p.dependencies){if(!dep||typeof dep.key!=='symbol')throw new ModuleError('PROVIDER_INVALID');const target=providers.get(dep.key);if(p.scope==='singleton'&&target&&target.scope!=='singleton')throw new ModuleError('PROVIDER_CAPTIVE_SCOPE');visit(dep.key,[...chain,p.token.name]);}
    visiting.delete(key);visited.add(key);
  }
  for(const key of providers.keys())visit(key,[]);
  const paths=new Set<string>();
  for(const route of controllers){
    const method=route.method??'GET',key=`${method}:${route.path}`;
    if(typeof route.path!=='string'||!/^\/[A-Za-z0-9/_-]{0,255}$/.test(route.path)||(route.path!=='/'&&(route.path.endsWith('/')||route.path.includes('//')))||!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method)||typeof route.handle!=='function'||route.guards.length>32||route.guards.some(f=>typeof f!=='function')||route.middleware.length>32||route.middleware.some(f=>typeof f!=='function')||route.onDispose!==undefined&&typeof route.onDispose!=='function'||route.filter!==undefined&&typeof route.filter!=='function'||route.schema!==undefined&&(route.schema?.['~standard']?.version!==1||typeof route.schema['~standard'].validate!=='function')||paths.has(key)||api.hasRoute(route.path,method))throw new ModuleError('MODULE_ROUTE_CONFLICT');
    paths.add(key);
  }
  type Owned={value:any;definition:ProviderDefinition;cleanups:(()=>void|Promise<void>)[]};
  type Scope={cache:Map<symbol,Promise<any>>;owned:Owned[];jobs:Set<Promise<any>>;controller:AbortController;closed:boolean;count:number};
  const scope=():Scope=>({cache:new Map(),owned:[],jobs:new Set(),controller:new AbortController(),closed:false,count:0});
  const generation=scope(),requests=new Set<{cancel():void;done:Promise<void>}>();let closed=false,closing:Promise<void>|undefined;
  async function dispose(owner:Scope){owner.closed=true;owner.controller.abort();await Promise.allSettled([...owner.jobs]);const errors:unknown[]=[];for(const item of owner.owned.reverse()){try{await item.definition.dispose?.(item.value);}catch(error){errors.push(error);}for(const cleanup of item.cleanups.reverse())try{await cleanup();}catch(error){errors.push(error);}}owner.owned.length=0;owner.cache.clear();if(errors.length)throw new AggregateError(errors,'Provider disposal failed');}
  function resolve<T>(token:ProviderToken<T>,requestScope?:Scope,request?:ZeruxRequestContext):Promise<T>{
    const p=providers.get(token?.key);if(closed||!p)return Promise.reject(new ModuleError('PROVIDER_UNAVAILABLE'));
    const owner=p.scope==='singleton'?generation:requestScope;
    if(!owner||owner.closed||owner.controller.signal.aborted)return Promise.reject(new ModuleError('PROVIDER_SCOPE_CLOSED'));
    if(p.scope!=='transient'&&owner.cache.has(token.key))return owner.cache.get(token.key)!;
    if(++owner.count>256)return Promise.reject(new ModuleError('PROVIDER_LIMIT'));
    const job=Promise.resolve().then(async()=>{const dependencies=await Promise.all(p.dependencies.map(dep=>resolve(dep,p.scope==='singleton'?undefined:requestScope,p.scope==='singleton'?undefined:request)));owner.controller.signal.throwIfAborted();const cleanups:(()=>void|Promise<void>)[]=[];let constructing=true;try{const value=await p.create({signal:owner.controller.signal,request:p.scope==='singleton'?undefined:request,onDispose(cleanup){if(!constructing||typeof cleanup!=='function'||cleanups.length>=32)throw new ModuleError('PROVIDER_CLEANUP_INVALID');cleanups.push(cleanup);}},...dependencies);owner.owned.push({value,definition:p,cleanups});return value;}catch(error){const errors=[error];for(const cleanup of cleanups.reverse())try{await cleanup();}catch(failure){errors.push(failure);}if(errors.length>1)throw new AggregateError(errors,'Provider construction cleanup failed');throw error;}finally{constructing=false;}});
    owner.jobs.add(job);void job.then(()=>owner.jobs.delete(job),()=>{owner.jobs.delete(job);if(p.scope!=='transient')owner.cache.delete(token.key);});if(p.scope!=='transient')owner.cache.set(token.key,job);return job;
  }
  const close=()=>closing??=(async()=>{closed=true;for(const r of requests)r.cancel();const outcomes=await Promise.allSettled([...requests].map(r=>r.done));const errors=outcomes.filter((x):x is PromiseRejectedResult=>x.status==='rejected').map(x=>x.reason);try{await dispose(generation);}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Module cleanup failed');})();
  const added:ModuleController[]=[];
  try {
    for(const p of providers.values())if(p.eager)await resolve(p.token);
    api.onDispose(close);
    for(const route of controllers){
      api.addRoute({pattern:route.path,method:route.method??'GET',source:`module:${definition.name}`,meta:{api:true},handler:async context=>{
        if(closed)throw new ModuleError('MODULE_CLOSED',503);
        // Guards/pipes cannot resolve controller providers; denial never constructs them.
        try{
          for(const guard of route.guards)if(await guard(context)!==true)throw new ModuleError('MODULE_FORBIDDEN',403);
          context.requestLifecycle?.signal.throwIfAborted();
          let input=context.body;
          if(route.schema){const result=await route.schema['~standard'].validate(input);if(result.issues)throw new ModuleError('MODULE_INPUT_INVALID',400);input=result.value;}
          context.requestLifecycle?.signal.throwIfAborted();
          if(context.res.destroyed||context.res.writableEnded)return;
          const owner=scope();let finish!:()=>void;
          const settled=new Promise<void>(r=>finish=r);let cleanup:Promise<void>|undefined;
          let resolveDone!:()=>void,rejectDone!:(e:unknown)=>void;
          const done=new Promise<void>((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});void done.catch(()=>{});
          const terminalSignal=context.requestLifecycle?.signal;
          const complete=()=>{
            if(cleanup)return;
            terminalSignal?.removeEventListener('abort',complete);
            context.res.off('finish',complete);context.res.off('close',complete);
            owner.controller.abort();
            cleanup=(async()=>{await settled;const errors:unknown[]=[];try{await dispose(owner);}catch(error){errors.push(error);}try{await route.onDispose?.(context, errors.length?new AggregateError(errors,'Provider cleanup failed'):undefined);}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Controller cleanup failed');})();
            void cleanup.then(resolveDone,error=>{context.logger.error('Module provider cleanup failed');rejectDone(error);});
          };
          const terminal={cancel(){owner.controller.abort();context.res.destroy();complete();},done};requests.add(terminal);
          void done.then(()=>requests.delete(terminal),()=>requests.delete(terminal));
          // Keep resources through actual response completion, including streamed results.
          if(terminalSignal){terminalSignal.addEventListener('abort',complete,{once:true});if(terminalSignal.aborted)complete();}
          else {context.res.once('finish',complete);context.res.once('close',complete);}
          try{let cursor=-1;const dispatch=async(index:number):Promise<unknown>=>{if(index<=cursor)throw new ModuleError('MODULE_NEXT_REPEATED');cursor=index;const middleware=route.middleware[index];if(!middleware)return route.handle(input,context,{get:<T>(token:ProviderToken<T>)=>resolve(token,owner,context)});let continuation:Promise<unknown>|undefined;const result=await middleware(context,()=>{if(continuation)throw new ModuleError('MODULE_NEXT_REPEATED');continuation=dispatch(index+1);return continuation.then(()=>{});});const downstream=continuation?await continuation:undefined;return result===undefined?downstream:result;};return await dispatch(0);}
          finally{finish();if(context.res.destroyed||context.res.writableFinished)complete();}
        }catch(error){if(route.filter)return route.filter(error,context);throw error;}
      }});added.push(route);
    }
    return Object.freeze({close});
  }catch(error){const failures:unknown[]=[error];for(const route of added)try{api.removeRoute(route.path,route.method??'GET');}catch(cleanup){failures.push(cleanup);}try{await close();}catch(cleanup){failures.push(cleanup);}if(failures.length>1)throw new AggregateError(failures,'Module registration rollback failed');throw error;}
}
