import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { IncomingMessage,ServerResponse } from 'node:http';
import type { ZeruxConfig } from '../index.js';
import { bootstrapApplication } from './runtime.js';
import { resolveStructure } from './config.js';
import { assertConfigReloadable, snapshotConfig } from './config-validation.js';
import { createRequestLifecycle } from './request-lifecycle.js';
import { createHotRuntime } from './hot-runtime.js';
import type { ServiceInitializers } from './services.js';
import type { RuntimeMode } from './types.js';
/** Explicit programmatic application generations; never binds/restarts an HTTP server.
 * Host keeps one handler and routes requests through it; reload is validation + staging.
 */
export async function createApplicationLifecycle(options:{rootDir:string;mode?:RuntimeMode;config:ZeruxConfig;providers?:Partial<ServiceInitializers>;drainTimeoutMs?:number}){
  if (!options || typeof options.rootDir !== 'string' || !options.rootDir || (options.mode !== undefined && !['dev','start'].includes(options.mode))) throw new TypeError('Invalid application lifecycle options');
  if (options.drainTimeoutMs !== undefined && (!Number.isFinite(options.drainTimeoutMs) || options.drainTimeoutMs < 0)) throw new TypeError('Invalid drain deadline');
  const rootDir=path.resolve(options.rootDir),mode=options.mode??'start';
  const applicationId=options.config.observability?.applicationId??randomBytes(12).toString('hex');
  const prepare=async(config:ZeruxConfig)=>{
    const saved=snapshotConfig(config),working=snapshotConfig(saved);
    working.observability={...working.observability,applicationId};
    const app=await bootstrapApplication(rootDir,mode,working,resolveStructure(rootDir,working),options.providers,{deferActivation:true});
    try{return {app,config:saved,handler:createRequestLifecycle(app.runtime.createHandler(),{drainTimeoutMs:options.drainTimeoutMs})};}
    catch(error){await app.runtime.closeServices();throw error;}
  };
  let candidateConfig=snapshotConfig(options.config);const first=await prepare(candidateConfig);try { first.app.runtime.activateServices(); } catch (error) { await first.app.runtime.closeServices(); throw error; }
  const generations=createHotRuntime(first,{prepare:()=>prepare(candidateConfig),activate:next=>next.app.runtime.activateServices(),dispose:async old=>{await old.handler.drain();old.app.runtime.closeProtocols();await old.app.runtime.closeServices();}});
  let queue:Promise<unknown>=Promise.resolve();let closed=false;let closing:Promise<void>|undefined;
  return {
    handle:(req:IncomingMessage,res:ServerResponse)=>generations.current().handler.handle(req,res),
    runtime:()=>generations.current().app.runtime,
    status:()=>generations.status(),
    reload(config:ZeruxConfig){if(closed)return Promise.reject(new Error('Application lifecycle closed'));const saved=snapshotConfig(config);const execute=async()=>{assertConfigReloadable(generations.current().config,saved);candidateConfig=saved;return generations.reload();};const result=queue.then(execute,execute);queue=result.catch(()=>{});return result;},
    close(){closed=true;return closing??=(async()=>{await queue;await generations.close();})();}
  };
}
