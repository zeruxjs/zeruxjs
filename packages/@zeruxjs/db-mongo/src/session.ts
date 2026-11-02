import type { DatabaseExecutionContext, PinnedTransactionAdapter, DatabaseResult, QueryOperation } from '@zeruxjs/db';
import { createDatabaseError } from '@zeruxjs/db';
import type { MongoClientLike, MongoDbLike, MongoSessionLike } from './connector.js';
const fail=(code:string,cause?:unknown)=>createDatabaseError({code,message:code.toLowerCase().replaceAll('_',' '),...(cause!==undefined?{cause}:{})});
export interface MongoTransactionPolicy { maxCommitAttempts:number;maxCommitTimeMS:number;maxSessions:number;probeTimeoutMS:number }
/** Read-only deployment probe. A successful hello is necessary, not a promise of permissions/FCV/engine parity. */
export async function verifyTransactionDeployment(client:MongoClientLike,policy:MongoTransactionPolicy){
    if(typeof client.startSession!=='function')throw fail('UNSUPPORTED_MONGO_SESSIONS');
    const admin=client.db('admin');if(typeof admin.command!=='function')throw fail('MISSING_MONGO_DEPLOYMENT_PROBE');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
        const hello=await Promise.race([Promise.resolve().then(()=>admin.command!({hello:1},{maxTimeMS:policy.probeTimeoutMS})),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(fail('MONGO_DEPLOYMENT_PROBE_TIMEOUT')),policy.probeTimeoutMS);})]);
        const replica=typeof hello.setName==='string'&&hello.setName.length>0,sharded=hello.msg==='isdbgrid';
        if(!Number.isFinite(hello.logicalSessionTimeoutMinutes)||Number(hello.logicalSessionTimeoutMinutes)<=0||!Number.isSafeInteger(hello.maxWireVersion)||Number(hello.maxWireVersion)<(sharded?8:7)||!replica&&!sharded)throw fail('UNSUPPORTED_MONGO_TRANSACTION_DEPLOYMENT');
    }finally{if(timer)clearTimeout(timer);}
}
/** Adds one explicit session at each CRUD/cursor creation boundary; no global session state. */
export function sessionDatabase(db:MongoDbLike,session:MongoSessionLike):MongoDbLike{
    const positions:Record<string,number>={insertOne:1,insertMany:1,find:1,aggregate:1,updateMany:2,deleteMany:1};
    return {collection(name){const collection=db.collection(name);return new Proxy(collection,{get(target,key){const value=Reflect.get(target,key);if(typeof key!=='string'||!Object.hasOwn(positions,key)||typeof value!=='function')return value;return (...args:unknown[])=>{const position=positions[key];args[position]={...(args[position] as Record<string,unknown>|undefined),session};return Reflect.apply(value,target,args);};}});}};
}
/** Owns sessions through rollback/endSession; never replays an application callback. */
export function transactionAdapter(client:MongoClientLike,policy:MongoTransactionPolicy,execute:(operation:QueryOperation,context:DatabaseExecutionContext,session:MongoSessionLike)=>Promise<DatabaseResult>,check:(context:DatabaseExecutionContext)=>void){
    const leases=new Set<Promise<void>>();
    const adapter:PinnedTransactionAdapter={
        capabilities:{isolationLevels:['snapshot'],timeout:'cooperative',savepoints:false,transactionalDdl:false},
        async acquire(ctx){
            check(ctx);if(leases.size>=policy.maxSessions)throw fail('MONGO_SESSION_LIMIT');
            const session=client.startSession!();
            if(!session||['startTransaction','commitTransaction','abortTransaction','endSession'].some(k=>typeof (session as unknown as Record<string,unknown>)[k]!=='function')){await session?.endSession?.();throw fail('INVALID_MONGO_SESSION');}
            let release!:()=>void;const life=new Promise<void>(resolve=>{release=resolve;});leases.add(life);let begun=false,done=false,ended=false;
            return {
                async begin(options){if(begun||!options||options.isolation!==undefined&&options.isolation!=='snapshot')throw fail('UNSUPPORTED_MONGO_ISOLATION');check(ctx);begun=true;await session.startTransaction({readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:policy.maxCommitTimeMS});},
                execute(operation,context){if(!begun||done||ended)throw fail('MONGO_TRANSACTION_CLOSED');check(context);if(!['select','insert','update','delete'].includes(operation.op))throw fail('UNSUPPORTED_MONGO_TRANSACTION_OPERATION');return execute(operation,context,session);},
                async commit(){if(!begun||done||ended)throw fail('MONGO_TRANSACTION_CLOSED');for(let attempt=1;;attempt++){check(ctx);try{await session.commitTransaction();done=true;return;}catch(error){const labeled=error as {hasErrorLabel?:(label:string)=>boolean};if(attempt>=policy.maxCommitAttempts||typeof labeled?.hasErrorLabel!=='function'||!labeled.hasErrorLabel('UnknownTransactionCommitResult'))throw error;}}},
                async rollback(){if(begun&&!done){await session.abortTransaction();done=true;}},
                async release(){if(ended)return;ended=true;try{await session.endSession();}finally{leases.delete(life);release();}}
            };
        }
    };
    return {adapter,async drain(){await Promise.allSettled([...leases]);}};
}
