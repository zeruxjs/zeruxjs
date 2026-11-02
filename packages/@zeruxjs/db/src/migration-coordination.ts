import { validateTransactionOptions } from './transactions.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseTransaction, TransactionOptions } from './transactions.js';
import type { ExclusiveMigrationTransaction, MigrationJournal, MigrationRecord } from './migrations.js';
import { assertIdentifier, createDatabaseError } from './utils.js';
export interface MigrationLockLease {readonly owner:string;readonly signal?:AbortSignal;assertOwned():Promise<void>;release(owner:string):Promise<void>}
/** Must be cross-process exclusive for the actual database/journal domain; no in-memory implementation is supplied. */
export interface MigrationLock {acquire(request:{name:string;owner:string;signal:AbortSignal}):Promise<MigrationLockLease>}
export interface MigrationCoordinationOptions {lock:MigrationLock;lockName:string;journalTable:string;lockTimeoutMs?:number;transactionOptions?:TransactionOptions}
/** Hold an owned lock until transaction cleanup finishes. Journal operations use only the callback's pinned executor. */
export function createPinnedMigrationTransaction(transaction:DatabaseTransaction,options:MigrationCoordinationOptions):ExclusiveMigrationTransaction {
 if(typeof transaction!=='function'||!options||typeof options.lock?.acquire!=='function'||typeof options.lockName!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(options.lockName))throw createDatabaseError({code:'INVALID_MIGRATION_LOCK',message:'Explicit migration lock and domain required'});
 const lock=options.lock,name=options.lockName,timeoutMs=options.lockTimeoutMs??30000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw createDatabaseError({code:'INVALID_MIGRATION_LOCK',message:'Invalid migration lock timeout'});
 const transactionOptions=validateTransactionOptions(options.transactionOptions);
 const table=assertIdentifier(options.journalTable,'Migration journal table');
 return async run=>{
  const owner=randomUUID(),acquiring=new AbortController();const timer=setTimeout(()=>acquiring.abort(),timeoutMs);let lease:MigrationLockLease|undefined,failure:unknown,result:unknown,hasFailure=false;
  try{
   lease=await lock.acquire({name,owner,signal:acquiring.signal});clearTimeout(timer);
   if(!lease||lease.owner!==owner||typeof lease.release!=='function'||typeof lease.assertOwned!=='function'||lease.signal!==undefined&&!(lease.signal instanceof AbortSignal))throw createDatabaseError({code:'MIGRATION_LOCK_OWNERSHIP',message:'Migration lock ownership mismatch'});
   if(acquiring.signal.aborted)throw createDatabaseError({code:'MIGRATION_LOCK_TIMEOUT',message:'Migration lock acquisition timed out'});
   await lease.assertOwned();
   result=await transaction(async db=>{
    const execute=async(operation:Parameters<typeof db.query>[0])=>{await lease!.assertOwned();const result=await db.query(operation);if(Array.isArray(result)||!result.ok)throw createDatabaseError({code:'MIGRATION_JOURNAL_FAILED',message:'Migration journal operation failed'});return result;};
    const journal:MigrationJournal={
     async list(){const result=await execute({op:'select',table,orderBy:[{by:'id',direction:'asc'}],limit:4097});if(!Array.isArray(result.rows)||result.rows.length>4096)throw createDatabaseError({code:'MIGRATION_JOURNAL_LIMIT',message:'Migration journal exceeds supported limit'});return result.rows as MigrationRecord[];},
     async insert(record){await execute({op:'insert',table,values:{id:record.id,checksum:record.checksum,appliedAt:record.appliedAt}});},
     async remove(id){await execute({op:'delete',table,where:{field:'id',operator:'eq',value:id}});}
    };
    const value=await run(db,journal);await lease!.assertOwned();return value;
   },{...transactionOptions,signal:AbortSignal.any([...(transactionOptions.signal?[transactionOptions.signal]:[]),...(lease.signal?[lease.signal]:[])])});
  }catch(error){hasFailure=true;failure=acquiring.signal.aborted&&!lease?createDatabaseError({code:'MIGRATION_LOCK_TIMEOUT',message:'Migration lock acquisition timed out',cause:error}):error;}
  finally{clearTimeout(timer);if(lease&&typeof lease.release==='function')try{await lease.release(owner);}catch(error){failure=new AggregateError(hasFailure?[failure,error]:[error],'Migration lock release failed');hasFailure=true;}}
  if(hasFailure)throw failure;return result as never;
 };
}
