import { createPinnedTransaction } from '@zeruxjs/db';
import type { DatabaseConnector, DatabaseExecutionContext, DatabaseTransaction, NormalizedConnectionConfig, PinnedTransactionAdapter } from '@zeruxjs/db';
import { compileSql, createSqlConnector } from '@zeruxjs/db-sql-core';
import { createManagedPool, pgPolicy, pgError } from './pool.js';
import type { PgConnectorOptions } from './pool.js';
import { createPgSessions } from './session.js';
import type { PgPoolStatus } from './session.js';
import { pgDialect } from './dialect.js';
export interface PgConnector extends DatabaseConnector {transaction:DatabaseTransaction;getPoolStatus():PgPoolStatus;disconnect():Promise<void>;getNativeConnection():unknown}
/** Configured pg pool leases own all transaction work. Query-only injected transports remain legacy/unowned. */
export async function createConnector(options:PgConnectorOptions={},connection?:NormalizedConnectionConfig):Promise<PgConnector>{
    const policy=pgPolicy(options);const config={...options};const {pool,owned}=await createManagedPool(config);const native=typeof pool.connect==='function';
    if(!native&&(config.statementTimeoutMs!==undefined||config.lockTimeoutMs!==undefined))throw pgError('PG_NATIVE_SETTINGS_UNAVAILABLE');
    const sessions=createPgSessions(pool,owned,config),fallback={connection:connection??{name:'PostgreSQL',slug:'default',connector:'@zeruxjs/db-pg',options:{}}};
    const base=createSqlConnector(pgDialect,{executor:(sql,params)=>pool.query(sql,params)});
    const validateContext=(context:DatabaseExecutionContext)=>{if(!context||typeof context!=='object'||!context.connection||typeof context.connection.slug!=='string'||typeof context.connection.connector!=='string')throw pgError('INVALID_PG_EXECUTION_CONTEXT');};
    const normalize=(run:(sql:string,params:unknown[])=>Promise<unknown>)=>createSqlConnector(pgDialect,{executor:run});
    const adapter:PinnedTransactionAdapter|undefined=native?{
        capabilities:{isolationLevels:['read-committed','read-uncommitted','repeatable-read','serializable'],timeout:'cooperative',savepoints:false,transactionalDdl:true},
        async acquire(context){
            validateContext(context);
            const lease=await sessions.acquire(context);try{await lease.initialize(context);}catch(error){await lease.terminate();try{await lease.finish();}catch(cleanup){throw new AggregateError([error,cleanup],'PostgreSQL acquisition cleanup failed');}throw error;}
            let begun=false,done=false;
            return {
                async begin(options){if(!options||typeof options!=='object'||Array.isArray(options))throw pgError('INVALID_PG_TRANSACTION_OPTIONS');const levels:Record<string,string>={'read-uncommitted':'READ UNCOMMITTED','read-committed':'READ COMMITTED','repeatable-read':'REPEATABLE READ',serializable:'SERIALIZABLE'};if(begun||options.isolation!==undefined&&!Object.hasOwn(levels,options.isolation))throw pgError('INVALID_PG_TRANSACTION_OPTIONS');const isolation=options.isolation?` ISOLATION LEVEL ${levels[options.isolation]}`:'';begun=true;await lease.raw(`BEGIN${isolation}`,[],context);await lease.configure(context,true);},
                execute(operation,ctx){validateContext(ctx);if(!begun||done)throw pgError('PG_TRANSACTION_SCOPE_CLOSED');return normalize((sql,params)=>lease.query(sql,params,ctx,true)).execute(operation,ctx);},
                async commit(){if(!begun||done)throw pgError('PG_TRANSACTION_SCOPE_CLOSED');try{await lease.raw('COMMIT',[],context);done=true;}catch(error){await lease.terminate();throw error;}},
                async rollback(){if(lease.bad)throw pgError('PG_ROLLBACK_UNCONFIRMED');if(done)return;try{await lease.raw('ROLLBACK');done=true;}catch(error){await lease.terminate();throw error;}},
                async release(){if(begun&&!done&&!lease.bad){await lease.terminate();}await lease.finish();}
            };
        }
    }:undefined;
    const transaction=adapter?createPinnedTransaction(adapter,fallback.connection):undefined;
    return {...base,capabilities:{...base.capabilities,transactions:native?'supported':'unsupported',cancellation:native?'supported':'unsupported'},...(adapter?{transactionAdapter:adapter}:{}),
        async execute(operation,context:DatabaseExecutionContext=fallback){
            // Reject unsafe compiler input before any pool acquisition or settings mutation.
            compileSql(pgDialect,operation);validateContext(context);
            if(!native)return sessions.legacy(()=>Promise.resolve(base.execute(operation,context)),context);
            const lease=await sessions.acquire(context);const executionContext={...context,deadline:Math.min(context.deadline??Infinity,Date.now()+policy.queryTimeoutMs)};let failure:unknown,failed=false,result;
            try{await lease.initialize(executionContext);result=await normalize((sql,params)=>lease.query(sql,params,executionContext)).execute(operation,context);}
            catch(error){failed=true;failure=error;}
            finally{try{await lease.finish();}catch(cleanup){failure=failed?new AggregateError([failure,cleanup],'PostgreSQL execution cleanup failed'):cleanup;failed=true;}}
            if(failed)throw failure;return result!;
        },
        transaction:(run,options)=>transaction?transaction(run,options):Promise.reject(pgError('UNSUPPORTED_PG_TRANSACTION')),
        getPoolStatus:sessions.status,disconnect:sessions.close,getNativeConnection(){if(sessions.status().closed)throw pgError('PG_CONNECTOR_CLOSED');return pool;}
    };
}
export type { PgConnectorOptions, PgPoolLike, PgPoolClientLike } from './pool.js';
export type { PgPoolStatus } from './session.js';
export default createConnector;
