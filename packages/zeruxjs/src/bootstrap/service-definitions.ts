import type { RuntimeServiceScope,ServiceHttpRoute,ServiceName } from './services.js';
export type RuntimeServiceName=ServiceName|`custom:${string}`;
/** Structural Standard Schema v1 contract; schema/input/output types remain package-owned. */
export interface ServiceConfigSchema<T=Record<string,unknown>> {readonly '~standard':{readonly version:1;validate(value:unknown):{value:T;issues?:undefined}|{issues:readonly unknown[]}|Promise<{value:T;issues?:undefined}|{issues:readonly unknown[]}>}}
export interface CustomServiceConfig {enabled?:boolean;settings?:Record<string,unknown>;privateOptions?:unknown}
export interface ServiceInstance<T=unknown> {value:T;dispose?:()=>void|Promise<void>;routes?:readonly ServiceHttpRoute[]}
export interface ServiceStartContext<T=Record<string,unknown>> {settings:T;privateOptions:unknown;rootDir:string;signal:AbortSignal;get<TValue=unknown>(name:RuntimeServiceName):TValue|undefined;onDispose(dispose:()=>void|Promise<void>):void}
export interface ServiceDefinition<T=any> {
  name:`custom:${string}`;namespace:string;schema:ServiceConfigSchema<T>;dependencies?:readonly RuntimeServiceName[];required?:boolean;
  reloadable?:readonly string[];publicFields?:readonly string[];
  start(context:ServiceStartContext<T>):ServiceInstance|Promise<ServiceInstance>;
}
export interface PreparedService {definition:ServiceDefinition;settings:unknown;privateOptions:unknown;enabled:boolean}
const builtins=new Set(['database','cache','files','analytics','email','tags','reports','queue','search']);
export function defineService<T>(definition:ServiceDefinition<T>):ServiceDefinition<T>{orderServices([definition],true);return Object.freeze({...definition,dependencies:Object.freeze([...(definition.dependencies??[])]),reloadable:Object.freeze([...(definition.reloadable??[])]),publicFields:Object.freeze([...(definition.publicFields??[])])});}
export function orderServices(definitions:readonly ServiceDefinition[],allowExternal=false):ServiceDefinition[]{
  if(!Array.isArray(definitions)||definitions.length>64)throw new TypeError('Invalid service definitions');const names=new Map<string,ServiceDefinition>();const namespaces=new Set<string>();
  for(const definition of definitions){if(!definition||!/^custom:[a-z][a-z0-9-]{0,63}$/.test(definition.name)||!/^[a-z][a-z0-9-]{0,63}$/.test(definition.namespace)||['constructor','prototype','__proto__'].includes(definition.namespace)||names.has(definition.name)||namespaces.has(definition.namespace)||typeof definition.start!=='function'||definition.schema?.['~standard']?.version!==1||typeof definition.schema['~standard'].validate!=='function'||(definition.required!==undefined&&typeof definition.required!=='boolean'))throw new TypeError('Invalid or duplicate service definition');
    for(const list of [definition.dependencies,definition.reloadable,definition.publicFields])if(list!==undefined&&(!Array.isArray(list)||list.length>64||list.some(value=>typeof value!=='string'||value.length>128)||new Set(list).size!==list.length))throw new TypeError('Invalid service declaration list');
    for(const field of [...(definition.reloadable??[]),...(definition.publicFields??[])])if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field)||['constructor','prototype','__proto__'].includes(field))throw new TypeError('Invalid service config field');
    names.set(definition.name,definition);namespaces.add(definition.namespace);
  }
  const visiting=new Set<string>(),done=new Set<string>(),ordered:ServiceDefinition[]=[];
  const visit=(definition:ServiceDefinition)=>{if(visiting.has(definition.name))throw new Error('Custom service dependency cycle');if(done.has(definition.name))return;visiting.add(definition.name);for(const dependency of definition.dependencies??[]){if(names.has(dependency))visit(names.get(dependency)!);else if(!builtins.has(dependency)&&!allowExternal)throw new Error('Unknown service dependency');}visiting.delete(definition.name);done.add(definition.name);ordered.push(definition);};
  for(const definition of definitions)visit(definition);return ordered;
}
/** Sequential topological acquisition with per-service rollback and dependency-only access. */
export async function startCustomServices(scope:RuntimeServiceScope,prepared:readonly PreparedService[],rootDir:string):Promise<void>{
  for(const item of prepared){const definition=item.definition;if(!item.enabled){scope.add(definition.name,null);continue;}
    const controller=new AbortController(),callbacks:(()=>void|Promise<void>)[]=[];let instance:ServiceInstance|undefined,closed=false;
    const dispose=async()=>{if(closed)return;closed=true;controller.abort();const errors:unknown[]=[];
      if(instance){try{if(instance.dispose)await instance.dispose();else{const value=instance.value as {close?:()=>void|Promise<void>};await value?.close?.();}}catch(error){errors.push(error);}}
      for(const callback of callbacks.reverse())try{await callback();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Custom service cleanup failed');};
    try{
      for(const dependency of definition.dependencies??[])if(!scope.get(dependency)||scope.status().find(status=>status.name===dependency)?.state!=='ready')throw new Error('Custom service dependency unavailable');
      instance=await definition.start({settings:item.settings,privateOptions:item.privateOptions,rootDir,signal:controller.signal,get(name){if(!definition.dependencies?.includes(name))throw new Error('Undeclared service dependency');return scope.get(name);},onDispose(callback){if(closed||typeof callback!=='function'||callbacks.length>=128)throw new Error('Invalid service disposer');callbacks.push(callback);}});
      if(!instance||instance.value==null||(instance.dispose!==undefined&&typeof instance.dispose!=='function'))throw new TypeError('Invalid custom service instance');
      if(instance.routes)scope.addHttpRoutes(definition.name,instance.routes);
      scope.add(definition.name,instance.value,dispose);
    }catch(error){let failure:unknown=error;try{await dispose();}catch(cleanup){failure=new AggregateError([error,cleanup],'Custom service startup and rollback failed');}
      if(definition.required!==false)throw failure;scope.markDegraded(definition.name,failure);
    }
  }
}
