import {createHash} from 'node:crypto';
import type {GraphQLFieldResolver,GraphQLResolveInfo,ExecutionResult,SelectionSetNode,GraphQLCompositeType} from 'graphql';
import {registerModule,type ProviderDefinition,type ModuleResolver} from './modules.js';
import type {ZeruxPluginApi,ZeruxRequestContext} from './bootstrap/types.js';
export interface GraphQLPrincipal {subject:string;tenant:string;expiresAt:number}
export interface GraphQLResolverContext extends Record<PropertyKey,unknown> {
  readonly principal:Readonly<GraphQLPrincipal>;readonly signal:AbortSignal;readonly providers:ModuleResolver;
  /** Authorizes every key before cache lookup. One bounded cache per operation/principal. */
  load<T>(name:string,key:string,batch:(keys:readonly string[],context:GraphQLResolverContext)=>Promise<readonly T[]>):Promise<T>;
}
export type GraphQLResolver<S=unknown,A=Record<string,unknown>,R=unknown> = (source:S,args:A,context:GraphQLResolverContext,info:GraphQLResolveInfo)=>R|Promise<R>;
export interface GraphQLOptions {
  name:string;path:string;typeDefs:string;
  resolvers:Record<string,Record<string,GraphQLFieldResolver<any,GraphQLResolverContext>|{resolve?:GraphQLFieldResolver<any,GraphQLResolverContext>;subscribe:GraphQLFieldResolver<any,GraphQLResolverContext>}>>;
  providers?:readonly ProviderDefinition[];
  authenticate(request:ZeruxRequestContext,signal:AbortSignal):GraphQLPrincipal|null|Promise<GraphQLPrincipal|null>;
  authorizeField(context:GraphQLResolverContext,info:GraphQLResolveInfo,source:unknown,args:Record<string,unknown>):boolean|Promise<boolean>;
  authorizeData(principal:Readonly<GraphQLPrincipal>,loader:string,key:string,row?:unknown):boolean|Promise<boolean>;
  /** Invoke existing origin/CSRF policy for all mutations; bearer-only policies must be explicit too. */
  protectMutation(request:ZeruxRequestContext,principal:Readonly<GraphQLPrincipal>):boolean|Promise<boolean>;
  introspection:boolean;
  persisted:{required:boolean;operations:Readonly<Record<string,string>>};
  limits?:Partial<{maxDepth:number;maxComplexity:number;maxAliases:number;maxVariablesBytes:number;maxResponseBytes:number;maxQueryBytes:number;maxConcurrent:number;timeoutMs:number;maxListItems:number}>;
  subscriptions?:{maxDurationMs:number;reauthorizeMs:number;reauthorize(principal:Readonly<GraphQLPrincipal>,signal:AbortSignal):boolean|Promise<boolean>};
  onError?(error:unknown):void;
}
export class GraphQLIntegrationError extends Error {constructor(readonly code:string,options?:ErrorOptions){super(code,options);this.name='GraphQLIntegrationError';}}
const fail=(code:string)=>new GraphQLIntegrationError(code);
/** Explicit server SDL/resolvers only. Optional dependencies are loaded at registration, never root import. */
export async function registerGraphQL(api:ZeruxPluginApi,options:GraphQLOptions){
  if(!options||typeof options.name!=='string'||typeof options.typeDefs!=='string'||Buffer.byteLength(options.typeDefs)>262144||!options.resolvers||typeof options.resolvers!=='object'||Array.isArray(options.resolvers)||typeof options.authenticate!=='function'||typeof options.authorizeField!=='function'||typeof options.authorizeData!=='function'||typeof options.protectMutation!=='function'||typeof options.introspection!=='boolean'||!options.persisted||typeof options.persisted.required!=='boolean'||!options.persisted.operations||typeof options.persisted.operations!=='object'||Array.isArray(options.persisted.operations)||options.onError!==undefined&&typeof options.onError!=='function')throw fail('GRAPHQL_POLICY_INVALID');
  if(options.limits!==undefined&&(!options.limits||typeof options.limits!=='object'||Array.isArray(options.limits))||options.subscriptions!==undefined&&(!options.subscriptions||typeof options.subscriptions!=='object'||Array.isArray(options.subscriptions)))throw fail('GRAPHQL_POLICY_INVALID');
  const limits={maxDepth:8,maxComplexity:1000,maxAliases:32,maxVariablesBytes:32768,maxResponseBytes:1048576,maxQueryBytes:32768,maxConcurrent:32,timeoutMs:5000,maxListItems:100,...options.limits};
  const caps={maxDepth:32,maxComplexity:10000,maxAliases:256,maxVariablesBytes:262144,maxResponseBytes:16777216,maxQueryBytes:131072,maxConcurrent:256,timeoutMs:120000,maxListItems:1000};
  if(Object.keys(limits).some(key=>!(key in caps)||!Number.isSafeInteger(limits[key as keyof typeof limits])||limits[key as keyof typeof limits]<1||limits[key as keyof typeof limits]>caps[key as keyof typeof caps]))throw fail('GRAPHQL_LIMIT_INVALID');
  const authenticate=options.authenticate,authorizeField=options.authorizeField,authorizeData=options.authorizeData,protectMutation=options.protectMutation,onError=options.onError,requirePersisted=options.persisted.required;
  const subscriptions=options.subscriptions?{...options.subscriptions}:undefined;
  if(subscriptions&&(!Number.isSafeInteger(subscriptions.maxDurationMs)||subscriptions.maxDurationMs<10||subscriptions.maxDurationMs>120000||!Number.isSafeInteger(subscriptions.reauthorizeMs)||subscriptions.reauthorizeMs<10||subscriptions.reauthorizeMs>30000||typeof subscriptions.reauthorize!=='function'))throw fail('GRAPHQL_SUBSCRIPTION_POLICY_INVALID');
  let gql:typeof import('graphql');try{gql=await import('graphql');}catch(cause){throw new GraphQLIntegrationError('GRAPHQL_DEPENDENCY_UNAVAILABLE',{cause});}
  let sse:typeof import('graphql-sse');if(subscriptions)try{sse=await import('graphql-sse');}catch(cause){throw new GraphQLIntegrationError('GRAPHQL_SSE_UNAVAILABLE',{cause});}
  const report=(error:unknown)=>{try{onError?.(error);}catch{/* Diagnostics cannot interrupt ownership. */}};
  let schema:import('graphql').GraphQLSchema;
  try{schema=gql.buildSchema(options.typeDefs);gql.assertValidSchema(schema);}catch(cause){throw new GraphQLIntegrationError('GRAPHQL_SCHEMA_INVALID',{cause});}
  const persisted=new Map<string,string>(Object.entries(options.persisted.operations));
  if(persisted.size>256)throw fail('GRAPHQL_PERSISTED_LIMIT');
  const validationRules=[...gql.specifiedRules,...(options.introspection?[]:[gql.NoSchemaIntrospectionCustomRule])];
  for(const [id,query]of persisted){if(!/^[a-f0-9]{64}$/.test(id)||typeof query!=='string'||Buffer.byteLength(query)>limits.maxQueryBytes||createHash('sha256').update(query).digest('hex')!==id)throw fail('GRAPHQL_PERSISTED_INVALID');try{const document=gql.parse(query,{maxTokens:4096});if(gql.validate(schema,document,validationRules,{maxErrors:20}).length)throw fail('GRAPHQL_PERSISTED_INVALID');}catch(cause){throw new GraphQLIntegrationError('GRAPHQL_PERSISTED_INVALID',{cause});}}
  for(const [typeName,fields]of Object.entries(options.resolvers)){const type=schema.getType(typeName);if(!gql.isObjectType(type)||!fields||typeof fields!=='object'||Array.isArray(fields))throw fail('GRAPHQL_RESOLVER_INVALID');for(const fieldName of Object.keys(fields))if(!type.getFields()[fieldName])throw fail('GRAPHQL_RESOLVER_INVALID');}
  const pending=new WeakMap<ZeruxRequestContext,State>(),active=new Set<State>();let closed=false;
  type State={controller:AbortController;principal?:Readonly<GraphQLPrincipal>;context?:GraphQLResolverContext;fields:number;deadline:number;jobs:Set<Promise<unknown>>;setDuration(ms:number):void;done:Promise<void>;finish():void;cancel():void;end():void;loaders:Map<string,any>};
  const errorResult=(message='Request rejected')=>({errors:[{message}]});
  function serialize(value:unknown):string{
    const stack=[value];let bytes=0,nodes=0;
    while(stack.length){const item=stack.pop();if(++nodes>100000)throw fail('GRAPHQL_RESPONSE_LIMIT');
      if(typeof item==='string'){if(Buffer.byteLength(item)>limits.maxResponseBytes)throw fail('GRAPHQL_RESPONSE_LIMIT');bytes+=Buffer.byteLength(JSON.stringify(item));}
      else if(item&&typeof item==='object'){bytes+=2;for(const [key,child]of Object.entries(item)){if(child===undefined)continue;bytes+=Buffer.byteLength(JSON.stringify(key))+2;stack.push(child);if(stack.length>100000)throw fail('GRAPHQL_RESPONSE_LIMIT');}}
      else if(item!==undefined)bytes+=String(item).length+1;
      if(bytes>limits.maxResponseBytes)throw fail('GRAPHQL_RESPONSE_LIMIT');
    }
    const text=JSON.stringify(value);if(Buffer.byteLength(text)>limits.maxResponseBytes)throw fail('GRAPHQL_RESPONSE_LIMIT');return text;
  }
  function send(request:ZeruxRequestContext,result:unknown,status=200){if(request.res.destroyed||request.res.writableEnded)return;let body:string;try{body=serialize(result);}catch{status=500;body=JSON.stringify(errorResult('Response limit exceeded'));}request.res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});request.res.end(body);}

  for(const type of Object.values(schema.getTypeMap())){
    if(gql.isScalarType(type)&&!type.name.startsWith('__')&&!['String','Int','Float','Boolean','ID'].includes(type.name))throw fail('GRAPHQL_CUSTOM_SCALAR_UNSUPPORTED');
    if(!gql.isObjectType(type)||type.name.startsWith('__'))continue;
    for(const field of Object.values(type.getFields())){
      const configured=Object.hasOwn(options.resolvers,type.name)?options.resolvers[type.name]:undefined;
      const registered=configured&&Object.hasOwn(configured,field.name)?configured[field.name]:undefined;
      const resolver=typeof registered==='function'?registered:registered?.resolve;
      if(registered&&typeof registered!=='function'&&(typeof registered!=='object'||typeof registered.subscribe!=='function'||registered.resolve!==undefined&&typeof registered.resolve!=='function'))throw fail('GRAPHQL_RESOLVER_INVALID');
      const wrap=(fn:GraphQLFieldResolver<any,GraphQLResolverContext>,subscriptionSource=false):GraphQLFieldResolver<any,GraphQLResolverContext>=>(source,args,context,info)=>{
        const state=contextStates.get(context);if(state&&Date.now()>=state.deadline)state.cancel();if(!state||state.controller.signal.aborted)throw fail('GRAPHQL_FIELD_UNAVAILABLE');if(++state.fields>64){state.fields--;throw fail('GRAPHQL_FIELD_UNAVAILABLE');}
        const job=(async()=>{try{context.signal.throwIfAborted();if(Date.now()>=context.principal.expiresAt||await authorizeField(context,info,source,args)!==true)throw fail('GRAPHQL_FIELD_DENIED');context.signal.throwIfAborted();const value=await fn(source,args,context,info);if(Date.now()>=state.deadline)state.cancel();context.signal.throwIfAborted();if(!subscriptionSource){const items=[{value,type:field.type}];let count=0;while(items.length){if(++count>10000)throw fail('GRAPHQL_VALUE_LIMIT');const item=items.pop()!;let type=item.type;while(gql.isNonNullType(type))type=type.ofType;if(item.value==null)continue;if(gql.isListType(type)){if(!Array.isArray(item.value)||item.value.length>limits.maxListItems)throw fail('GRAPHQL_VALUE_LIMIT');for(const child of item.value)items.push({value:child,type:type.ofType});}else if(typeof item.value==='string'&&Buffer.byteLength(item.value)>limits.maxResponseBytes)throw fail('GRAPHQL_VALUE_LIMIT');}}return value;}catch(error){report(error);throw new gql.GraphQLError('Field unavailable');}finally{state.fields--;}})();state.jobs.add(job);void job.then(()=>state.jobs.delete(job),()=>state.jobs.delete(job));return job;
      };
      field.resolve=wrap(resolver??((source)=>source&&Object.getOwnPropertyDescriptor(source,field.name)?.value));
      if(registered&&typeof registered==='object')field.subscribe=wrap(registered.subscribe,true);
    }
  }
  const contextStates=new WeakMap<GraphQLResolverContext,State>();
  function variables(value:unknown){const text=JSON.stringify(value??{});if(Buffer.byteLength(text)>limits.maxVariablesBytes)throw fail('GRAPHQL_VARIABLE_LIMIT');const stack=[{value,depth:0}];let nodes=0;while(stack.length){const {value:v,depth}=stack.pop()!;if(++nodes>2048||depth>16)throw fail('GRAPHQL_VARIABLE_LIMIT');if(v&&typeof v==='object')for(const item of Object.values(v))stack.push({value:item,depth:depth+1});}if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)))throw fail('GRAPHQL_VARIABLE_INVALID');}
  function prepare(body:any){
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['query','variables','operationName','extensions'].includes(k)))throw fail('GRAPHQL_REQUEST_INVALID');
    variables(body.variables);if(body.operationName!==undefined&&(typeof body.operationName!=='string'||body.operationName.length>128))throw fail('GRAPHQL_REQUEST_INVALID');
    if(body.extensions!==undefined&&(!body.extensions||typeof body.extensions!=='object'||Array.isArray(body.extensions)||Object.keys(body.extensions).some(k=>k!=='persistedQuery')))throw fail('GRAPHQL_EXTENSIONS_INVALID');
    const persistedQuery=body.extensions?.persistedQuery;if(persistedQuery!==undefined&&(!persistedQuery||typeof persistedQuery!=='object'||Array.isArray(persistedQuery)||persistedQuery.version!==1||Object.keys(persistedQuery).some(k=>!['version','sha256Hash'].includes(k))))throw fail('GRAPHQL_PERSISTED_INVALID');
    const hash=persistedQuery?.sha256Hash;let query=body.query;
    if(hash!==undefined||requirePersisted){if(typeof hash!=='string'||!persisted.has(hash)||query!==undefined&&query!==persisted.get(hash))throw fail('GRAPHQL_PERSISTED_MISS');query=persisted.get(hash);}
    if(typeof query!=='string'||Buffer.byteLength(query)>limits.maxQueryBytes)throw fail('GRAPHQL_QUERY_LIMIT');
    const document=gql.parse(query,{maxTokens:4096}),errors=gql.validate(schema,document,validationRules,{maxErrors:20});if(errors.length)throw fail('GRAPHQL_VALIDATION_FAILED');
    const operation=gql.getOperationAST(document,body.operationName);if(!operation||document.definitions.filter(d=>d.kind==='OperationDefinition').length!==1)throw fail('GRAPHQL_OPERATION_INVALID');
    const fragments=new Map(document.definitions.filter((d):d is import('graphql').FragmentDefinitionNode=>d.kind==='FragmentDefinition').map(d=>[d.name.value,d]));let aliases=0,cost=0;
    const walk=(selection:SelectionSetNode,parent:GraphQLCompositeType|undefined,depth:number,weight:number)=>{if(depth>limits.maxDepth)throw fail('GRAPHQL_DEPTH_LIMIT');for(const item of selection.selections){if(item.kind==='Field'){if(item.alias&&++aliases>limits.maxAliases)throw fail('GRAPHQL_ALIAS_LIMIT');const field=parent&&'getFields'in parent?parent.getFields()[item.name.value]:undefined;const type=field?.type;let listType=type,factor=1;while(listType&&(gql.isNonNullType(listType)||gql.isListType(listType))){if(gql.isListType(listType))factor*=limits.maxListItems;listType=listType.ofType;if(factor>limits.maxComplexity)break;}const fieldWeight=weight*factor;if((cost+=fieldWeight)>limits.maxComplexity)throw fail('GRAPHQL_COMPLEXITY_LIMIT');if(item.selectionSet){const next=type?gql.getNamedType(type):undefined;walk(item.selectionSet,next&&gql.isCompositeType(next)?next:undefined,depth+1,fieldWeight);}}else if(item.kind==='InlineFragment'){const target=item.typeCondition?schema.getType(item.typeCondition.name.value):parent;walk(item.selectionSet,target&&gql.isCompositeType(target)?target:parent,depth,weight);}else{const fragment=fragments.get(item.name.value)!;const target=schema.getType(fragment.typeCondition.name.value);walk(fragment.selectionSet,target&&gql.isCompositeType(target)?target:parent,depth,weight);}}};
    const root=operation.operation==='query'?schema.getQueryType():operation.operation==='mutation'?schema.getMutationType():schema.getSubscriptionType();walk(operation.selectionSet,root??undefined,1,1);
    return {document,operation,query,variableValues:body.variables,operationName:body.operationName};
  }
  function makeContext(state:State,providers:ModuleResolver):GraphQLResolverContext{
    const context:GraphQLResolverContext=Object.freeze({principal:state.principal!,signal:state.controller.signal,providers,load<T>(name:string,key:string,batch:(keys:readonly string[],ctx:GraphQLResolverContext)=>Promise<readonly T[]>):Promise<T>{const job=(async()=>{
      if(Date.now()>=state.deadline)state.cancel();context.signal.throwIfAborted();if(!/^[A-Za-z][\w.-]{0,63}$/.test(name)||typeof key!=='string'||key.length>256||typeof batch!=='function'||await authorizeData(context.principal,name,key)!==true)throw fail('GRAPHQL_DATA_DENIED');context.signal.throwIfAborted();let loader=state.loaders.get(name);
      if(!loader){if(state.loaders.size>=16)throw fail('GRAPHQL_LOADER_LIMIT');loader={cache:new Map(),queue:[],scheduled:false,batch};state.loaders.set(name,loader);}
      if(loader.batch!==batch)throw fail('GRAPHQL_LOADER_IDENTITY');
      if(loader.cache.has(key))return loader.cache.get(key);if(loader.cache.size>=256||loader.queue.length>=64)throw fail('GRAPHQL_LOADER_LIMIT');
      const promise=new Promise<T>((resolve,reject)=>loader.queue.push({key,resolve,reject}));loader.cache.set(key,promise);
      if(!loader.scheduled){loader.scheduled=true;queueMicrotask(()=>{const job=(async()=>{const queued=loader.queue.splice(0);loader.scheduled=false;try{context.signal.throwIfAborted();const rows=await batch(queued.map((item:any)=>item.key),context);if(Date.now()>=state.deadline)state.cancel();context.signal.throwIfAborted();if(!Array.isArray(rows)||rows.length!==queued.length)throw fail('GRAPHQL_LOADER_RESULT');for(let i=0;i<queued.length;i++){if(await authorizeData(context.principal,name,queued[i].key,rows[i])!==true)throw fail('GRAPHQL_DATA_DENIED');}queued.forEach((item:any,i:number)=>item.resolve(rows[i]));}catch(error){for(const item of queued){loader.cache.delete(item.key);item.reject(error);}}})();state.jobs.add(job);void job.then(()=>state.jobs.delete(job),()=>state.jobs.delete(job));});}
      return promise;
    })();state.jobs.add(job);void job.then(()=>state.jobs.delete(job),()=>state.jobs.delete(job));return job;}});contextStates.set(context,state);return context;
  }
  for(const [id,query]of persisted)try{prepare({query,extensions:{persistedQuery:{version:1,sha256Hash:id}}});}catch(cause){throw new GraphQLIntegrationError('GRAPHQL_PERSISTED_INVALID',{cause});}
  const module=await registerModule(api,{name:options.name,providers:options.providers,controllers:[{path:options.path,method:'POST',guards:[async request=>{
    if(closed||active.size>=limits.maxConcurrent){send(request,errorResult('Unavailable'),503);return false;}
    const controller=new AbortController(),startedAt=Date.now();let resolve!:()=>void;const done=new Promise<void>(r=>resolve=r);let timer:ReturnType<typeof setTimeout>,ended=false;
    const cancel=()=>{controller.abort();if(!request.res.destroyed&&!request.res.writableEnded){if(request.res.headersSent)request.res.destroy();else send(request,errorResult('Execution expired'),504);}};
    const disconnect=()=>controller.abort();request.requestLifecycle?.signal.addEventListener('abort',disconnect,{once:true});
    const state:State={controller,fields:0,deadline:startedAt+limits.timeoutMs,jobs:new Set(),setDuration(ms){clearTimeout(timer);state.deadline=Math.min(startedAt+ms,state.principal?.expiresAt??Infinity);timer=setTimeout(cancel,Math.max(1,state.deadline-Date.now()));},done,finish:resolve,cancel,loaders:new Map(),end(){if(ended)return;ended=true;clearTimeout(timer);request.requestLifecycle?.signal.removeEventListener('abort',disconnect);state.loaders.clear();active.delete(state);pending.delete(request);resolve();}};pending.set(request,state);active.add(state);timer=setTimeout(cancel,limits.timeoutMs);
    try{const principal=await authenticate(request,controller.signal);if(Date.now()>=state.deadline)state.cancel();controller.signal.throwIfAborted();if(!principal||typeof principal.subject!=='string'||principal.subject.length>256||!principal.subject||typeof principal.tenant!=='string'||principal.tenant.length>256||!principal.tenant||!Number.isSafeInteger(principal.expiresAt)||principal.expiresAt<=Date.now()){send(request,errorResult('Forbidden'),403);state.end();return false;}state.principal=Object.freeze({subject:principal.subject,tenant:principal.tenant,expiresAt:principal.expiresAt});state.setDuration(limits.timeoutMs);return true;}catch(error){report(error);send(request,errorResult('Forbidden'),403);state.end();return false;}
  }],async handle(input,request,providers){
    const state=pending.get(request)!;let reauth:ReturnType<typeof setInterval>|undefined,iterator:AsyncGenerator<string,void,undefined>|undefined;let ack=()=>{};
    try{const prepared=prepare(input);if(prepared.operation.operation==='mutation'&&await protectMutation(request,state.principal!)!==true){send(request,errorResult('Forbidden'),403);return;}state.controller.signal.throwIfAborted();const context=makeContext(state,providers);state.context=context;const args={schema,document:prepared.document,contextValue:context,variableValues:prepared.variableValues,operationName:prepared.operationName};
      const clean=(result:ExecutionResult)=>({...(result.data!==undefined?{data:result.data}:{}),...(result.errors?.length?{errors:result.errors.map(error=>{report(error);return new gql.GraphQLError('Field unavailable');})}:{})});
      if(prepared.operation.operation!=='subscription'){const result=await gql.execute(args);if(Date.now()>=state.deadline)state.cancel();state.controller.signal.throwIfAborted();send(request,clean(result));return;}
      if(!subscriptions||request.req.headers.accept!=='text/event-stream'){send(request,errorResult('Subscription unavailable'),400);return;}
      state.setDuration(subscriptions.maxDurationMs);
      let checking=false;reauth=setInterval(()=>{if(checking)return;checking=true;const job=Promise.resolve().then(()=>subscriptions.reauthorize(state.principal!,state.controller.signal)).then(ok=>{if(ok!==true)state.cancel();},error=>{report(error);state.cancel();}).finally(()=>checking=false);state.jobs.add(job);void job.then(()=>state.jobs.delete(job),()=>state.jobs.delete(job));},subscriptions.reauthorizeMs);
      let gate=Promise.resolve();const abort=()=>{ack();void iterator?.return().catch(report);};state.controller.signal.addEventListener('abort',abort,{once:true});
      const handler=sse!.createHandler({authenticate:()=>null,onSubscribe:()=>args,onNext:async(_ctx,_req,result)=>{await gate;state.controller.signal.throwIfAborted();gate=new Promise<void>(resolve=>ack=resolve);if('hasNext'in result)throw fail('GRAPHQL_INCREMENTAL_UNSUPPORTED');const output=clean(result as ExecutionResult);serialize(output);return output as import('graphql-sse').ExecutionResult;}});
      const [body,init]=await handler({method:'POST',url:request.url.href,headers:{get:key=>key==='accept'?'text/event-stream':key==='content-type'?'application/json':null},body:{query:prepared.query,variables:prepared.variableValues,operationName:prepared.operationName},raw:request.req,context:undefined});
      if(typeof body==='string'||!body){send(request,errorResult('Subscription unavailable'),400);return;}iterator=body;
      request.res.writeHead(init.status,{'content-type':'text/event-stream','cache-control':'no-store, no-transform','x-accel-buffering':'no'});
      for await(const frame of iterator){state.controller.signal.throwIfAborted();if(Buffer.byteLength(frame)>limits.maxResponseBytes+128)throw fail('GRAPHQL_RESPONSE_LIMIT');if(!request.res.write(frame))await new Promise<void>(resolve=>{const done=()=>{request.res.off('drain',done);state.controller.signal.removeEventListener('abort',done);resolve();};request.res.once('drain',done);state.controller.signal.addEventListener('abort',done,{once:true});if(state.controller.signal.aborted)done();});if(frame.startsWith('event: next'))ack();}
      request.res.end();state.controller.signal.removeEventListener('abort',abort);
    }catch(error){report(error);if(!request.res.headersSent)send(request,errorResult('Request rejected'),state.controller.signal.aborted?504:400);else request.res.end();}
    finally{state.controller.abort();ack();if(reauth)clearInterval(reauth);await iterator?.return().catch(report);await Promise.allSettled([...state.jobs]);}
  },onDispose(request,error){if(error)report(error);pending.get(request)?.end();},filter(error,request){report(error);pending.get(request)?.end();send(request,errorResult('Request rejected'),400);}}]});
  const close=async()=>{closed=true;for(const state of active)state.cancel();await Promise.allSettled([...active].map(state=>state.done));await module.close();};try{api.onDispose(close);}catch(error){await module.close();api.removeRoute(options.path,'POST');throw error;}
  return Object.freeze({close,get activeRequests(){return active.size;}});
}
