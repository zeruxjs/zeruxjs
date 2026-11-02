import {
  createTransportRegistry, createHttpTransportAdapter, createWebSocketTransportAdapter,
  ProtocolGateway, type TransportBind, type TransportLimits, type TransportAuthorization,
  type WebSocketTransportOptions,
} from 'zhost/protocols';
import type { ZeruxPluginApi } from './bootstrap/types.js';
import type { ModuleInputSchema } from './modules.js';
import type { DatabaseFacade, TransactionDatabase, TransactionOptions } from '@zeruxjs/db';

interface EndpointBase { name: string; bind: TransportBind; limits: TransportLimits; authorize: TransportAuthorization }
export type ServiceEndpointDefinition = EndpointBase & (
  { transport: 'http'; gateway: ProtocolGateway } |
  { transport: 'ws'; path: string; allowedOrigins?: readonly string[]; onMessage: WebSocketTransportOptions['onMessage']; onError?: WebSocketTransportOptions['onError'] }
);
export function defineServiceEndpoint<T extends ServiceEndpointDefinition>(definition: T): T { return definition; }
export class ServiceEndpointError extends Error {
  constructor(readonly code: string, options?: ErrorOptions) { super(code, options); this.name='ServiceEndpointError'; }
}
/** Inert registration; command startup workers or an explicit owner call start(). */
export function registerServiceEndpoints(api: ZeruxPluginApi, definitions: readonly ServiceEndpointDefinition[], options: {name?:string} = {}) {
  const name=options?.name??'service-endpoints';
  if(!api||typeof api.onDispose!=='function'||!Array.isArray(definitions)||!definitions.length||definitions.length>32||!options||typeof options!=='object'||!/^[a-z][a-z0-9-]{0,63}$/.test(name)||api.getWorker(name))throw new ServiceEndpointError('ENDPOINT_REGISTRATION_INVALID');
  const registry=createTransportRegistry();
  const adapters=new Map<string,ReturnType<typeof createHttpTransportAdapter>|ReturnType<typeof createWebSocketTransportAdapter>>();
  registry.registerAdapter('http',value=>value as ReturnType<typeof createHttpTransportAdapter>);
  registry.registerAdapter('ws',value=>value as ReturnType<typeof createWebSocketTransportAdapter>);
  const gateways=new Set<ProtocolGateway>();
  for(const definition of definitions){
    if(!definition||typeof definition.authorize!=='function'||!definition.limits||['maxMessageBytes','maxConcurrent','timeoutMs'].some(key=>!Object.hasOwn(definition.limits,key))||!['http','ws'].includes(definition.transport))throw new ServiceEndpointError('ENDPOINT_POLICY_REQUIRED');
    let adapter;
    if(definition.transport==='http'){
      if(!(definition.gateway instanceof ProtocolGateway)||gateways.has(definition.gateway))throw new ServiceEndpointError('ENDPOINT_GATEWAY_OWNERSHIP');
      gateways.add(definition.gateway);definition.gateway.validateBindings();
      adapter=createHttpTransportAdapter({gateway:definition.gateway,authorize:definition.authorize});
    }else adapter=createWebSocketTransportAdapter(definition);
    registry.register({id:definition.name,type:definition.transport,bind:definition.bind,limits:definition.limits,options:adapter});adapters.set(definition.name,adapter);
  }
  const close=()=>registry.stop();
  api.onDispose(close);
  api.addWorker(name,async()=>{await registry.start();return close;});
  return Object.freeze({start:()=>registry.start(),close,health:()=>registry.health(),address(endpoint:string){const adapter=adapters.get(endpoint);if(!adapter)throw new ServiceEndpointError('ENDPOINT_UNKNOWN');return adapter.address();}});
}

/** JSON data budget; rejects executable/non-JSON values before a request/transaction starts. */
function encode(value: unknown, maxBytes: number): string {
  const pending:{value:unknown;depth:number}[]=[{value,depth:0}];let nodes=0,bytes=0;
  while(pending.length){const item=pending.pop()!;if(++nodes>10000||item.depth>16)throw new ServiceEndpointError('PAYLOAD_LIMIT');const v=item.value;
    if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isFinite(v)){if(typeof v==='string'&&Buffer.byteLength(v)>maxBytes)throw new ServiceEndpointError('PAYLOAD_LIMIT');bytes+=Buffer.byteLength(JSON.stringify(v));if(bytes>maxBytes)throw new ServiceEndpointError('PAYLOAD_LIMIT');continue;}
    if(typeof v!=='object'||!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw new ServiceEndpointError('PAYLOAD_INVALID');
    if(Array.isArray(v)&&v.length>10000)throw new ServiceEndpointError('PAYLOAD_LIMIT');
    const descriptors=Object.getOwnPropertyDescriptors(v);if(Object.hasOwn(descriptors,'toJSON'))throw new ServiceEndpointError('PAYLOAD_INVALID');for(const [key,descriptor]of Object.entries(descriptors)){if(Array.isArray(v)&&key==='length')continue;if(!Object.hasOwn(descriptor,'value'))throw new ServiceEndpointError('PAYLOAD_INVALID');if(!descriptor.enumerable)continue;bytes+=Buffer.byteLength(key)+3;if(bytes>maxBytes)throw new ServiceEndpointError('PAYLOAD_LIMIT');pending.push({value:descriptor.value,depth:item.depth+1});if(pending.length>10000)throw new ServiceEndpointError('PAYLOAD_LIMIT');}
  }
  const body=JSON.stringify(value);if(Buffer.byteLength(body)>maxBytes)throw new ServiceEndpointError('PAYLOAD_LIMIT');return body;
}
export interface ServiceCallOptions { signal?: AbortSignal; deadline?: number }
export interface ServiceClientOptions<I,O> {
  endpoint: string; timeoutMs: number; maxPayloadBytes: number; maxConcurrent: number;
  /** Host owns egress/DNS/TLS policy. No transport is started or installed on import. */
  transport(request: Request): Promise<Response>;
  allowDestination(url: URL): boolean;
  headers?(): Record<string,string> | Promise<Record<string,string>>;
  schema: ModuleInputSchema<O>;
  retry: {maxAttempts: number; idempotent: boolean};
}
/** Fixed-destination JSON POST client. Deadlines cover headers, all attempts, body and validation. */
export function createServiceClient<I,O>(options:ServiceClientOptions<I,O>) {
  if(!options||typeof options.transport!=='function'||typeof options.allowDestination!=='function'||options.headers!==undefined&&typeof options.headers!=='function'||options.schema?.['~standard']?.version!==1||typeof options.schema['~standard'].validate!=='function'||!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>120000||!Number.isSafeInteger(options.maxPayloadBytes)||options.maxPayloadBytes<1||options.maxPayloadBytes>16*1024*1024||!Number.isSafeInteger(options.maxConcurrent)||options.maxConcurrent<1||options.maxConcurrent>1024||!options.retry||!Number.isSafeInteger(options.retry.maxAttempts)||options.retry.maxAttempts<1||options.retry.maxAttempts>3||typeof options.retry.idempotent!=='boolean'||options.retry.maxAttempts>1&&!options.retry.idempotent)throw new ServiceEndpointError('CLIENT_POLICY_INVALID');
  const endpoint=new URL(options.endpoint);
  if(!['https:','http:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.hash||options.allowDestination(new URL(endpoint))!==true)throw new ServiceEndpointError('CLIENT_DESTINATION_DENIED');
  const transport=options.transport,headers=options.headers,schema=options.schema,retry={...options.retry},timeout=options.timeoutMs,max=options.maxPayloadBytes,concurrency=options.maxConcurrent;
  const active=new Set<{controller:AbortController;done:Promise<unknown>}>();let closed=false;
  return {
    call(input:I,request:ServiceCallOptions={}):Promise<O>{
      if(closed)return Promise.reject(new ServiceEndpointError('CLIENT_CLOSED'));
      if(!request||typeof request!=='object'||request.signal!==undefined&&!(request.signal instanceof AbortSignal)||request.deadline!==undefined&&(!Number.isSafeInteger(request.deadline)||request.deadline<0))return Promise.reject(new ServiceEndpointError('CALL_OPTIONS_INVALID'));
      if(active.size>=concurrency)return Promise.reject(new ServiceEndpointError('CLIENT_OVERLOAD'));
      let body:string;try{body=encode(input,max);}catch(error){return Promise.reject(error);}
      const controller=new AbortController(),deadline=Math.min(Date.now()+timeout,request.deadline??Infinity),abort=()=>controller.abort();
      request.signal?.addEventListener('abort',abort,{once:true});if(request.signal?.aborted||deadline<=Date.now())abort();
      const timer=setTimeout(abort,Math.max(1,deadline-Date.now()));
      const entry={controller,done:Promise.resolve() as Promise<unknown>};active.add(entry);
      const work=Promise.resolve().then(async()=>{
        try{
          controller.signal.throwIfAborted();const configured=await headers?.();controller.signal.throwIfAborted();const fields=new Headers(configured);if([...fields].length>32||[...fields].reduce((sum,[k,v])=>sum+k.length+v.length,0)>8192||[...fields.keys()].some(key=>/^(?:host|connection|content-length|transfer-encoding|forwarded|x-forwarded-.*)$/i.test(key)))throw new ServiceEndpointError('CLIENT_HEADERS_INVALID');fields.set('content-type','application/json');fields.set('accept','application/json');fields.set('x-zerux-deadline',String(deadline));
          for(let attempt=1;attempt<=retry.maxAttempts;attempt++){
            controller.signal.throwIfAborted();let response:Response;
            try{response=await transport(new Request(endpoint,{method:'POST',headers:fields,body,redirect:'error',signal:controller.signal}));}
            catch(cause){if(controller.signal.aborted||attempt===retry.maxAttempts)throw new ServiceEndpointError(controller.signal.aborted?'CALL_CANCELLED':'CALL_TRANSPORT_FAILED',{cause});continue;}
            if(controller.signal.aborted){await response.body?.cancel();throw new ServiceEndpointError('CALL_CANCELLED');}
            if(response.redirected||response.url&&response.url!==endpoint.href){await response.body?.cancel();throw new ServiceEndpointError('CALL_REDIRECT_DENIED');}
            if(!response.ok){await response.body?.cancel();if([502,503,504].includes(response.status)&&attempt<retry.maxAttempts)continue;throw new ServiceEndpointError('CALL_HTTP_FAILED');}
            if(!/^application\/(?:json|[^;]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw new ServiceEndpointError('CALL_CONTENT_TYPE');}
            const reader=response.body?.getReader();if(!reader)throw new ServiceEndpointError('CALL_BODY_INVALID');const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});const chunks:Uint8Array[]=[];let size=0;
            try{while(true){controller.signal.throwIfAborted();const part=await reader.read();controller.signal.throwIfAborted();if(part.done)break;size+=part.value.byteLength;if(size>max)throw new ServiceEndpointError('CALL_BODY_LIMIT');chunks.push(part.value);}const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));encode(data,max);const result=await schema['~standard'].validate(data);controller.signal.throwIfAborted();if(result.issues)throw new ServiceEndpointError('CALL_RESPONSE_INVALID');return result.value;}
            finally{controller.signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
          }
          throw new ServiceEndpointError('CALL_FAILED');
        }catch(cause){if(cause instanceof ServiceEndpointError)throw cause;throw new ServiceEndpointError(controller.signal.aborted?'CALL_CANCELLED':'CALL_FAILED',{cause});}
        finally{clearTimeout(timer);request.signal?.removeEventListener('abort',abort);active.delete(entry);}
      });entry.done=work;return work;
    },
    async close(){closed=true;for(const entry of active)entry.controller.abort();await Promise.allSettled([...active].map(entry=>entry.done));},
    get activeCalls(){return active.size;}
  };
}

export interface TransactionalOutboxWriter<E> { enqueue(transaction:TransactionDatabase,event:E,context:{signal:AbortSignal;deadline?:number}):void|Promise<void> }
/** Uses the supplied facade's one real pin for both business work and journal enqueue; no publisher/retry loop. */
export function createTransactionalOutbox<E>(database:Pick<DatabaseFacade,'transaction'|'transactionCapabilities'>,writer:TransactionalOutboxWriter<E>) {
  if(typeof database?.transaction!=='function'||typeof database?.transactionCapabilities!=='function'||typeof writer?.enqueue!=='function')throw new ServiceEndpointError('OUTBOX_PINNED_TRANSACTION_REQUIRED');
  const capabilities=database.transactionCapabilities();
  if(!capabilities||typeof capabilities!=='object'||!Array.isArray(capabilities.isolationLevels))throw new ServiceEndpointError('OUTBOX_PINNED_TRANSACTION_REQUIRED');
  const transaction=database.transaction.bind(database),write=writer.enqueue.bind(writer);
  return {run<T>(work:(transaction:TransactionDatabase,enqueue:(event:E)=>Promise<void>)=>T|Promise<T>,options:TransactionOptions={}):Promise<T>{
    if(typeof work!=='function')return Promise.reject(new ServiceEndpointError('OUTBOX_WORK_INVALID'));
    return transaction(async pin=>{
      let count=0,open=true;const jobs:Promise<void>[]=[];let tail=Promise.resolve();
      const enqueue=(event:E):Promise<void>=>{
        if(!open)return Promise.reject(new ServiceEndpointError('OUTBOX_SCOPE_CLOSED'));
        if(++count>64){const rejected=Promise.reject<void>(new ServiceEndpointError('OUTBOX_EVENT_LIMIT'));if(count===65)jobs.push(rejected);void rejected.catch(()=>{});return rejected;}
        let body:string;try{body=encode(event,65536);}catch(error){const rejected=tail.then(()=>{throw error;});tail=rejected;jobs.push(rejected);void rejected.catch(()=>{});return rejected;}
        const job=tail.then(async()=>{pin.signal.throwIfAborted();await write(pin,JSON.parse(body) as E,{signal:pin.signal,deadline:options.deadline});pin.signal.throwIfAborted();});
        tail=job;jobs.push(job);void job.catch(()=>{});return job;
      };
      let value:T|undefined,failure:unknown,failed=false;
      try{value=await work(pin,enqueue);}catch(error){failure=error;failed=true;}finally{open=false;}
      const settled=await Promise.allSettled(jobs),rejected=settled.find((item):item is PromiseRejectedResult=>item.status==='rejected');
      if(failed)throw failure;if(rejected)throw rejected.reason;pin.signal.throwIfAborted();return value as T;
    },options);
  }};
}
