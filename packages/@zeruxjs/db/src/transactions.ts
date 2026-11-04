import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseExecutionContext, DatabaseResult, QueryOperation, MaybePromise, DatabaseQueryOptions, DatabaseFacade } from './types.js';
import { createDatabaseError } from './utils.js';
import { queryOptions } from './execution.js';
export type TransactionIsolation='read-uncommitted'|'read-committed'|'repeatable-read'|'serializable'|'snapshot';
export interface TransactionOptions extends Pick<DatabaseQueryOptions,'signal'|'deadline'|'timeoutMs'> {isolation?:TransactionIsolation}
export interface PinnedTransactionCapabilities {isolationLevels:readonly TransactionIsolation[]; timeout:'cooperative'|'unsupported'; savepoints:false; transactionalDdl:boolean}
/** Adapter methods must all target the acquired native connection/session. Acquire failures own their partial cleanup. */
export interface PinnedTransactionSession {
 begin(options:TransactionOptions,context:DatabaseExecutionContext):MaybePromise<void>;
 execute(operation:QueryOperation,context:DatabaseExecutionContext):MaybePromise<DatabaseResult>;
 commit():MaybePromise<void>;rollback():MaybePromise<void>;release():MaybePromise<void>;
}
export interface PinnedTransactionAdapter {readonly capabilities:PinnedTransactionCapabilities;acquire(context:DatabaseExecutionContext):MaybePromise<PinnedTransactionSession>}
export type TransactionDatabase=Omit<DatabaseFacade,'native'|'options'>&{readonly signal:AbortSignal;transaction<T>(run:(db:TransactionDatabase)=>MaybePromise<T>,options?:TransactionOptions):Promise<T>};
export type DatabaseTransaction=<T>(run:(db:TransactionDatabase)=>MaybePromise<T>,options?:TransactionOptions)=>Promise<T>;
const owners=new AsyncLocalStorage<object>();
export const ownsTransaction=(owner:object)=>owners.getStore()===owner;
export const transactionError=(code:string,cause?:unknown)=>createDatabaseError({code,message:({UNSUPPORTED_TRANSACTION:'Pinned transactions are unavailable',INVALID_TRANSACTION_OPTIONS:'Invalid transaction options',UNSUPPORTED_ISOLATION:'Transaction isolation is unavailable',UNSUPPORTED_TRANSACTION_TIMEOUT:'Transaction timeout is unavailable',NESTED_TRANSACTION_UNSUPPORTED:'Nested transactions require an explicit savepoint implementation',TRANSACTION_SCOPE_CLOSED:'Transaction callback scope is closed',TRANSACTION_SCOPE_REQUIRED:'Use the pinned transaction facade inside its callback',TRANSACTION_ROLLBACK_ONLY:'Transaction is rollback-only',TRANSACTION_COMMIT_FAILED:'Transaction commit failed; outcome may be indeterminate',TRANSACTION_ABORTED:'Transaction cancelled or deadline exceeded',TRANSACTION_DDL_UNSUPPORTED:'Transactional DDL is unavailable'} as Record<string,string>)[code]??'Transaction failed',...(cause!==undefined?{cause}:{})});
export function validateTransactionOptions(options:TransactionOptions={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['isolation','signal','deadline','timeoutMs'].includes(k)))throw transactionError('INVALID_TRANSACTION_OPTIONS');
 if(options.isolation!==undefined&&!['read-uncommitted','read-committed','repeatable-read','serializable','snapshot'].includes(options.isolation))throw transactionError('INVALID_TRANSACTION_OPTIONS');
 const parsed=queryOptions({...(options.signal!==undefined?{signal:options.signal}:{}),...(options.deadline!==undefined?{deadline:options.deadline}:{}),...(options.timeoutMs!==undefined?{timeoutMs:options.timeoutMs}:{})});
 return {...options,...parsed};
}
/** Validate negotiation without acquiring a resource. No savepoint implementation is implied. */
export function negotiateTransaction(adapter:PinnedTransactionAdapter|undefined,options:TransactionOptions={}){
 if(!adapter||typeof adapter.acquire!=='function')throw transactionError('UNSUPPORTED_TRANSACTION');
 const caps=adapter.capabilities;
 const isolation=['read-uncommitted','read-committed','repeatable-read','serializable','snapshot'];
 if(!caps||!Array.isArray(caps.isolationLevels)||caps.isolationLevels.length>5||caps.isolationLevels.some(v=>!isolation.includes(v))||!['cooperative','unsupported'].includes(caps.timeout)||caps.savepoints!==false||typeof caps.transactionalDdl!=='boolean')throw transactionError('UNSUPPORTED_TRANSACTION');
 const parsed=validateTransactionOptions(options);
 if(options.isolation!==undefined&&!caps.isolationLevels.includes(options.isolation))throw transactionError('UNSUPPORTED_ISOLATION');
 if(parsed.deadline!==undefined&&caps.timeout!=='cooperative')throw transactionError('UNSUPPORTED_TRANSACTION_TIMEOUT');
 return {...options,...parsed};
}
/** Pins scope through all cleanup. Timeouts are cooperative; never release a lease under outstanding native work. */
export async function runPinnedTransaction<T>(owner:object,adapter:PinnedTransactionAdapter,context:DatabaseExecutionContext,run:(db:TransactionDatabase)=>MaybePromise<T>,facade:(execute:PinnedTransactionSession['execute'])=>DatabaseFacade,options:TransactionOptions={}):Promise<T>{
 if(ownsTransaction(owner))throw transactionError('NESTED_TRANSACTION_UNSUPPORTED');
 const parsed=negotiateTransaction(adapter,options);if(typeof run!=='function')throw transactionError('INVALID_TRANSACTION_OPTIONS');
 const controller=new AbortController(),abort=()=>controller.abort();
 if(parsed.signal?.aborted||parsed.deadline!==undefined&&parsed.deadline<=Date.now())throw transactionError('TRANSACTION_ABORTED');
 parsed.signal?.addEventListener('abort',abort,{once:true});let timer:ReturnType<typeof setTimeout>|undefined;
 if(parsed.deadline!==undefined)timer=setTimeout(abort,Math.max(0,parsed.deadline-Date.now()));
 const ctx={...context,signal:controller.signal,deadline:parsed.deadline};
 let session:PinnedTransactionSession|undefined,scopeOpen=true,begun=false,committed=false,failed=false,commitAttempt=false;
 const pending=new Set<Promise<unknown>>();let tail:Promise<unknown>=Promise.resolve();let failure:unknown,value:T|undefined,hasFailure=false;
 const check=()=>{if(!scopeOpen)throw transactionError('TRANSACTION_SCOPE_CLOSED');if(controller.signal.aborted||parsed.deadline!==undefined&&parsed.deadline<=Date.now())throw transactionError('TRANSACTION_ABORTED');};
 try{
  session=await adapter.acquire(ctx);
  if(!session||['begin','execute','commit','rollback','release'].some(k=>typeof (session as any)[k]!=='function'))throw transactionError('UNSUPPORTED_TRANSACTION');
  check();begun=true;await session.begin(parsed,ctx);check();
  const base=facade((operation,queryContext)=>{
   check();
   if(operation.connection!==undefined&&operation.connection!==context.connection.slug)throw transactionError('TRANSACTION_SCOPE_REQUIRED');
   if(['createDb','dropDb','switchDB'].includes(operation.op)||!adapter.capabilities.transactionalDdl&&['createTable','dropTable','alterTable','turcunateTable','createIndex','dropIndex'].includes(operation.op))throw transactionError('TRANSACTION_DDL_UNSUPPORTED');
   const signal=AbortSignal.any([controller.signal,...(queryContext.signal?[queryContext.signal]:[])]);
   const tracked=tail.then(()=>{
    if(failed)throw transactionError('TRANSACTION_ROLLBACK_ONLY');
    if(signal.aborted)throw transactionError('TRANSACTION_ABORTED');
    return session!.execute(operation,{...queryContext,signal,deadline:Math.min(parsed.deadline??Infinity,queryContext.deadline??Infinity)===Infinity?undefined:Math.min(parsed.deadline??Infinity,queryContext.deadline??Infinity)});
   }).then(value=>{if(!value.ok)failed=true;return value;},error=>{failed=true;throw error;});
   tail=tracked.catch(()=>{});pending.add(tracked);void tracked.finally(()=>pending.delete(tracked)).catch(()=>{});return tracked;
  });
  const tx:any={slug:base.slug,name:base.name,connector:base.connector,signal:controller.signal,capabilities:base.capabilities,transaction:async()=>{throw transactionError('NESTED_TRANSACTION_UNSUPPORTED');}};
  for(const name of ['query','createDb','dropDb','switchDB','createTable','dropTable','alterTable','turcunateTable','createIndex','dropIndex','insert','select','update','delete'] as const)tx[name]=(...args:unknown[])=>{check();try{const result=(base[name] as Function)(...args);const observed=Promise.resolve(result).catch(error=>{failed=true;throw error;});pending.add(observed);void observed.finally(()=>pending.delete(observed)).catch(()=>{});return observed;}catch(error){failed=true;throw error;}};
  value=await owners.run(owner,()=>run(Object.freeze(tx)));
  check();scopeOpen=false;await Promise.allSettled([...pending]);
  if(failed)throw transactionError('TRANSACTION_ROLLBACK_ONLY');
  if(controller.signal.aborted||parsed.deadline!==undefined&&parsed.deadline<=Date.now())throw transactionError('TRANSACTION_ABORTED');
  commitAttempt=true;await session.commit();committed=true;
 }catch(error){hasFailure=true;failure=commitAttempt?transactionError('TRANSACTION_COMMIT_FAILED',error):controller.signal.aborted?transactionError('TRANSACTION_ABORTED',error):error;}
 finally{
  scopeOpen=false;controller.abort();await Promise.allSettled([...pending]);
  if(session){if(begun&&!committed)try{await session.rollback();}catch(error){failure=new AggregateError(hasFailure?[failure,error]:[error],'Transaction rollback failed');hasFailure=true;}
   try{await session.release();}catch(error){failure=new AggregateError(hasFailure?[failure,error]:[error],'Transaction lease release failed');hasFailure=true;}}
  if(timer)clearTimeout(timer);parsed.signal?.removeEventListener('abort',abort);
 }
 if(hasFailure)throw failure;return value as T;
}
