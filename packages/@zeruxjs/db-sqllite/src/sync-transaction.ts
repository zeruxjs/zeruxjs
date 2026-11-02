import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseResult, QueryOperation, SelectOperation, InsertOperation, UpdateOperation, DeleteOperation } from '@zeruxjs/db';
import type { SqliteDatabase } from './driver.js';
import { sqliteError, syncValue } from './driver.js';
export interface SqliteSyncTransaction {
    execute(operation:QueryOperation):DatabaseResult;
    query(operation:QueryOperation):DatabaseResult;
    select(operation:Omit<SelectOperation,'op'|'connection'>):DatabaseResult;
    insert(operation:Omit<InsertOperation,'op'|'connection'>):DatabaseResult;
    update(operation:Omit<UpdateOperation,'op'|'connection'>):DatabaseResult;
    delete(operation:Omit<DeleteOperation,'op'|'connection'>):DatabaseResult;
}
export interface SqliteSyncTransactionOptions {mode?:'deferred'|'immediate'|'exclusive';timeoutMs?:number;signal?:AbortSignal}
export type SqliteSyncTransactionRunner=<T>(run:(tx:SqliteSyncTransaction)=>T & (T extends PromiseLike<unknown>?never:unknown),options?:SqliteSyncTransactionOptions)=>T;
const scopes=new AsyncLocalStorage<{db:SqliteDatabase}>();
const handles=new WeakMap<SqliteDatabase,{active:boolean;broken:boolean}>();
/** Guard wrapper access, including async continuations escaped from a rejected callback. */
export function assertSqliteOutsideTransaction(db:SqliteDatabase,allowBroken=false){
    if(scopes.getStore()?.db===db)throw sqliteError('SQLITE_USE_TRANSACTION_FACADE');
    if(!allowBroken&&handles.get(db)?.broken)throw sqliteError('SQLITE_TRANSACTION_HANDLE_UNUSABLE');
}
/** Own one synchronous BEGIN/COMMIT interval. A transaction facade never exposes the native handle. */
export function createSyncTransaction(db:SqliteDatabase,execute:(operation:QueryOperation)=>DatabaseResult,isClosed:()=>boolean,defaultMode:SqliteSyncTransactionOptions['mode']='immediate'):SqliteSyncTransactionRunner {
    let state=handles.get(db);if(!state){state={active:false,broken:false};handles.set(db,state);}
    return <T>(run:(tx:SqliteSyncTransaction)=>T,options:SqliteSyncTransactionOptions={}):T=>{
        const nativeActive=()=>db.isTransaction===true||db.inTransaction===true;
        if(isClosed())throw sqliteError('SQLITE_CONNECTOR_CLOSED');
        if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['mode','timeoutMs','signal'].includes(k)))throw sqliteError('INVALID_SQLITE_TRANSACTION_OPTIONS');
        const mode=options.mode??defaultMode,timeoutMs=options.timeoutMs??30000;
        if(!['deferred','immediate','exclusive'].includes(mode)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw sqliteError('INVALID_SQLITE_TRANSACTION_OPTIONS');
        if(typeof run!=='function'||run.constructor.name==='AsyncFunction')throw sqliteError('SQLITE_ASYNC_TRANSACTION_CALLBACK');
        if(state!.active||nativeActive())throw sqliteError('SQLITE_NESTED_TRANSACTION_UNSUPPORTED');
        assertSqliteOutsideTransaction(db);
        const deadline=performance.now()+timeoutMs;
        const check=()=>{if(options.signal?.aborted||performance.now()>=deadline)throw sqliteError('SQLITE_TRANSACTION_ABORTED');};check();
        let begun=false,committing=false,finished=false,failed=false,hasFailure=false,value:T|undefined,failure:unknown;
        const call=(operation:QueryOperation,...extra:unknown[])=>{
            if(finished)throw sqliteError('SQLITE_TRANSACTION_SCOPE_CLOSED');
            try{check();if(extra.some(v=>v!==undefined))throw sqliteError('SQLITE_SYNC_QUERY_OPTIONS_UNSUPPORTED');
                const result=syncValue(execute(operation));check();if(!result.ok)failed=true;return result;
            }catch(error){failed=true;throw error;}
        };
        const tx:SqliteSyncTransaction=Object.freeze({execute:call,query:call,select:(op:Omit<SelectOperation,'op'|'connection'>,...extra:unknown[])=>call({...op,op:'select'},...extra),insert:(op:Omit<InsertOperation,'op'|'connection'>,...extra:unknown[])=>call({...op,op:'insert'},...extra),update:(op:Omit<UpdateOperation,'op'|'connection'>,...extra:unknown[])=>call({...op,op:'update'},...extra),delete:(op:Omit<DeleteOperation,'op'|'connection'>,...extra:unknown[])=>call({...op,op:'delete'},...extra)});
        state!.active=true;
        try{
            syncValue(db.exec(`BEGIN ${mode.toUpperCase()}`));begun=true;check();
            value=scopes.run({db},()=>syncValue(run(tx)));check();
            if(failed)throw sqliteError('SQLITE_TRANSACTION_ROLLBACK_ONLY');
            committing=true;syncValue(db.exec('COMMIT'));finished=true;
        }catch(error){if(nativeActive())begun=true;hasFailure=true;failure=committing?sqliteError('SQLITE_COMMIT_FAILED',error):error;}
        finally{
            finished=true;
            if(begun&&hasFailure)try{syncValue(db.exec('ROLLBACK'));}catch(error){state!.broken=true;failure=new AggregateError([failure,error],'SQLite rollback failed');}
            state!.active=false;
        }
        if(hasFailure)throw failure;return value as T;
    };
}
