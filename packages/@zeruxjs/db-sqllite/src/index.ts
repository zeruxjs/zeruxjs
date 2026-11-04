import type { DatabaseConnector, DatabaseResult, NormalizedConnectionConfig, QueryOperation } from '@zeruxjs/db';
import { createSqlConnector } from '@zeruxjs/db-sql-core';
import { createSqliteExecutor, openSqlite, configureSqlite, validateSqliteOptions, sqliteError, syncValue } from './driver.js';
import type { SqliteOptions, SqliteDatabase } from './driver.js';
import { createSyncTransaction, assertSqliteOutsideTransaction } from './sync-transaction.js';
import type { SqliteSyncTransactionRunner } from './sync-transaction.js';
import { sqliteDialect } from './dialect.js';
export interface SqliteConnector extends DatabaseConnector {
    disconnect():Promise<void>;
    getNativeConnection():unknown;
    /** Separate from the shared asynchronous transaction extension; available only with a native synchronous handle. */
    transactionSync:SqliteSyncTransactionRunner;
    readonly synchronousTransactions:boolean;
    readonly sqliteVersion?:string;
}
/** Native sync driver or explicit injected executor. Injected databases remain host-owned. */
export async function createConnector(options:SqliteOptions & Record<string,unknown>={},connection?:NormalizedConnectionConfig):Promise<SqliteConnector>{
    validateSqliteOptions(options);
    const config={...options};
    if(config.executor!==undefined&&typeof config.executor!=='function')throw sqliteError('INVALID_SQLITE_EXECUTOR');
    for(const name of ['client','pool'])if(config[name]!==undefined&&(!config[name]||typeof config[name]!=='object'||Array.isArray(config[name])))throw sqliteError('INVALID_SQLITE_EXECUTOR');
    const transports=[config.databaseInstance,config.executor,config.client,config.pool].filter(value=>value!==undefined);
    if(transports.length>1)throw sqliteError('AMBIGUOUS_SQLITE_EXECUTOR');
    let db:SqliteDatabase|undefined,owned=false,closed=false;
    try{
        if(!config.executor&&!config.client&&!config.pool){db=config.databaseInstance??await openSqlite(config.filename??':memory:',config.driver,config.readonly??false);owned=!config.databaseInstance;configureSqlite(db,config);}
        if(!db&&(config.busyTimeoutMs!==undefined||config.readBigInts!==undefined||config.journalMode!==undefined&&config.journalMode!=='preserve'))throw sqliteError('SQLITE_NATIVE_POLICY_UNAVAILABLE');
        let version:string|undefined;
        if(db){const rows=syncValue(db.prepare('SELECT sqlite_version() AS version').all()) as Array<{version?:unknown}>;if(typeof rows[0]?.version==='string'&&/^\d+\.\d+\.\d+$/.test(rows[0].version))version=rows[0].version;}
        const returning=version?version.split('.').map(Number).reduce((n,v)=>n*1000+v,0)>=3035000:undefined;
        const delegate=createSqlConnector({...sqliteDialect,...(returning!==undefined?{supportsReturning:returning}:{})},{...config,database:typeof config.database==='string'?config.database:undefined,fixedDatabase:true,synchronous:!!db,executor:db?createSqliteExecutor(db,config):config.executor as any});
        const defaultContext={connection:connection??{name:'SQLite',slug:'default',connector:'@zeruxjs/db-sqlite',options:{}}};
        const internal=(operation:QueryOperation,context=defaultContext)=>{
            if(closed)throw sqliteError('SQLITE_CONNECTOR_CLOSED');
            if(config.readonly&&operation.op!=='select')throw sqliteError('SQLITE_READONLY_WRITE');
            if(['createDb','dropDb','switchDB'].includes(operation.op))throw new Error(`SQLite cannot execute ${operation.op}`);
            return delegate.execute(operation,context);
        };
        return {...delegate,capabilities:{...delegate.capabilities,returning:config.readonly?'unsupported':returning===undefined?'unknown':returning?'supported':'unsupported',...(config.readonly?{schema:'unsupported' as const,indexes:'unsupported' as const}:{})},synchronousTransactions:!!db,...(version?{sqliteVersion:version}:{}),
            execute(operation,context){if(db)assertSqliteOutsideTransaction(db);return internal(operation,context);},
            transactionSync:db?createSyncTransaction(db,operation=>syncValue(internal(operation)) as DatabaseResult,()=>closed,config.readonly?'deferred':'immediate'):()=>{throw sqliteError('UNSUPPORTED_SQLITE_SYNC_TRANSACTION');},
            disconnect(){if(db)assertSqliteOutsideTransaction(db,true);if(closed)return Promise.resolve();closed=true;try{if(owned)db!.close();return Promise.resolve();}catch(error){return Promise.reject(error);}},
            getNativeConnection(){if(closed)throw sqliteError('SQLITE_CONNECTOR_CLOSED');if(db)assertSqliteOutsideTransaction(db);return db??config.client??config.pool;}
        };
    }catch(error){if(owned&&db)try{db.close();}catch(cleanup){throw new AggregateError([error,cleanup],'SQLite initialization and cleanup failed');}throw error;}
}
export { createSqliteExecutor, openSqlite } from './driver.js';
export type { SqliteDatabase, SqliteDriver, SqliteOptions, SqliteStatement } from './driver.js';
export type { SqliteSyncTransaction, SqliteSyncTransactionOptions, SqliteSyncTransactionRunner } from './sync-transaction.js';
export default createConnector;
export { createSqliteConsistentBackup } from './backup.js';
