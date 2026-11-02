import { isIP } from 'node:net';
export interface TransportBind { host: string; port: number }
export interface TransportLimits { maxMessageBytes: number; maxConcurrent: number; timeoutMs: number }
export interface TransportStartContext { readonly bind: Readonly<TransportBind>; readonly limits: Readonly<TransportLimits>; readonly signal: AbortSignal; onDispose(cleanup: () => void | Promise<void>): void }
export interface TransportHealth { ready: boolean }
/** Trusted adapter owns its listener/streams. Register cleanup immediately, including partial start.
 * stop must close admission, abort handlers, end streams/WS and release sockets/listener. */
export interface TransportAdapter { start(context: TransportStartContext): Promise<void>; health(): TransportHealth | Promise<TransportHealth>; stop(): void | Promise<void> }
export type TransportAdapterFactory = (options: unknown) => TransportAdapter;
export interface TransportRegistration { id: string; type: string; bind: TransportBind; limits?: Partial<TransportLimits>; options?: unknown }
export class TransportLifecycleError extends Error { constructor(readonly code: string, options?: ErrorOptions) { super(code, options); this.name = 'TransportLifecycleError'; } }
const fail = (code: string) => new TransportLifecycleError(code);
/** App-scoped inert registration. Explicit trusted factories only, no package discovery or process supervision. */
export function createTransportRegistry(options: { maxTransports?: number } = {}) {
  if(!options||typeof options!=='object'||Array.isArray(options))throw fail('TRANSPORT_INVALID');
  const max = options.maxTransports ?? 32;
  if (!Number.isSafeInteger(max) || max < 1 || max > 128) throw fail('TRANSPORT_INVALID');
  const factories = new Map<string, TransportAdapterFactory>();
  type Entry = { spec: TransportRegistration; limits: TransportLimits; state: 'registered'|'starting'|'ready'|'failed'|'stopped'; adapter?: TransportAdapter; controller?: AbortController; cleanups: (()=>void|Promise<void>)[]; released: boolean };
  const entries = new Map<string, Entry>(); let state: 'registered'|'starting'|'ready'|'failed'|'stopping'|'stopped' = 'registered', startPromise: Promise<void>|undefined, stopPromise: Promise<void>|undefined;
  const name = (value: unknown) => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  async function release(entry: Entry) {
    if (entry.released) return; entry.released = true; entry.controller?.abort(); const errors: unknown[] = [];
    try { await entry.adapter?.stop(); } catch (error) { errors.push(error); }
    for (const cleanup of entry.cleanups.reverse()) try { await cleanup(); } catch (error) { errors.push(error); }
    entry.cleanups.length = 0; entry.state = 'stopped'; if (errors.length) throw new AggregateError(errors, 'Transport cleanup failed');
  }
  return {
    registerAdapter(type: string, factory: TransportAdapterFactory) { if (state !== 'registered') throw fail('TRANSPORT_REGISTRATION_CLOSED'); if (!name(type) || typeof factory !== 'function' || factories.has(type) || factories.size >= max) throw fail('TRANSPORT_INVALID_ADAPTER'); factories.set(type, factory); },
    register(spec: TransportRegistration) {
      if (state !== 'registered') throw fail('TRANSPORT_REGISTRATION_CLOSED');
      if (!spec || !name(spec.id) || !name(spec.type) || !spec.bind || typeof spec.bind.host !== 'string' || !isIP(spec.bind.host) || !Number.isSafeInteger(spec.bind.port) || spec.bind.port < 0 || spec.bind.port > 65535 || entries.has(spec.id) || entries.size >= max) throw fail('TRANSPORT_INVALID');
      if (!factories.has(spec.type)) throw fail('TRANSPORT_UNSUPPORTED');
      // Conservative TCP reservation: all fixed-port collisions reject before any start. Port 0 is ephemeral.
      if (spec.bind.port && [...entries.values()].some(entry => entry.spec.bind.port === spec.bind.port)) throw fail('TRANSPORT_BIND_CONFLICT');
      if(spec.limits!==undefined&&(!spec.limits||typeof spec.limits!=='object'||Array.isArray(spec.limits)))throw fail('TRANSPORT_INVALID_LIMITS');
      const limits = { maxMessageBytes: 1024*1024, maxConcurrent: 32, timeoutMs: 30000, ...spec.limits };
      if (spec.limits && Object.keys(spec.limits).some(key => !['maxMessageBytes','maxConcurrent','timeoutMs'].includes(key)) || !Number.isSafeInteger(limits.maxMessageBytes) || limits.maxMessageBytes < 1 || limits.maxMessageBytes > 16*1024*1024 || !Number.isSafeInteger(limits.maxConcurrent) || limits.maxConcurrent < 1 || limits.maxConcurrent > 1024 || !Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 10 || limits.timeoutMs > 120000) throw fail('TRANSPORT_INVALID_LIMITS');
      const entry: Entry = { spec: {...spec, bind: {...spec.bind}}, limits, state:'registered', cleanups:[], released:false }; entries.set(spec.id, entry);
      return Object.freeze({ remove() { if (state !== 'registered') throw fail('TRANSPORT_REGISTRATION_CLOSED'); return entries.get(entry.spec.id) === entry && entries.delete(entry.spec.id); } });
    },
    start() {
      if (state === 'stopped' || state === 'stopping' || state === 'failed') return Promise.reject(fail('TRANSPORT_CLOSED'));
      if (startPromise) return startPromise;
      if (state !== 'registered') return Promise.reject(fail('TRANSPORT_CLOSED'));
      state = 'starting';
      return startPromise = Promise.resolve().then(async () => {
        try {
          for (const entry of entries.values()) {
            if (state === 'stopping') throw fail('TRANSPORT_CANCELLED');
            entry.state='starting'; entry.controller=new AbortController();
            const adapter=factories.get(entry.spec.type)!(entry.spec.options); entry.adapter=adapter;
            if (!adapter || typeof adapter.start!=='function' || typeof adapter.health!=='function' || typeof adapter.stop!=='function') throw fail('TRANSPORT_INVALID_ADAPTER');
            const deadline=setTimeout(()=>entry.controller?.abort(),entry.limits.timeoutMs);
            try { await adapter.start({bind:Object.freeze({...entry.spec.bind}),limits:Object.freeze({...entry.limits}),signal:entry.controller.signal,onDispose(cleanup){if(entry.released||typeof cleanup!=='function'||entry.cleanups.length>=64)throw fail('TRANSPORT_INVALID_CLEANUP');entry.cleanups.push(cleanup);}});
            if (entry.controller.signal.aborted) throw fail('TRANSPORT_CANCELLED');
            const health=await adapter.health(); if (entry.controller.signal.aborted || !health || health.ready!==true) throw fail('TRANSPORT_NOT_READY'); entry.state='ready';
            } finally { clearTimeout(deadline); }
          }
          state='ready';
        } catch(cause) {
          state=state==='stopping'?'stopping':'failed'; const errors:unknown[]=[cause];
          for(const entry of [...entries.values()].reverse())if(entry.adapter)try{await release(entry);}catch(error){errors.push(error);}
          throw new TransportLifecycleError('TRANSPORT_START_FAILED',{cause:errors.length===1?cause:new AggregateError(errors,'Transport rollback failed')});
        }
      });
    },
    async health() {
      const output:{id:string;type:string;state:string;ready:boolean}[]=[];
      for(const entry of entries.values()){let ready=false;if(entry.state==='ready')try{ready=(await entry.adapter!.health()).ready===true;}catch{/* readiness is false, never a fabricated healthy result */}output.push({id:entry.spec.id,type:entry.spec.type,state:entry.state,ready});}
      return output;
    },
    stop() {
      if(stopPromise)return stopPromise;state='stopping';for(const entry of entries.values())entry.controller?.abort();
      return stopPromise=Promise.resolve().then(async()=>{await startPromise?.catch(()=>{});const errors:unknown[]=[];for(const entry of [...entries.values()].reverse())try{await release(entry);}catch(error){errors.push(error);}state='stopped';if(errors.length)throw new AggregateError(errors,'Transport stop failed');});
    },
    get state(){return state;}
  };
}
