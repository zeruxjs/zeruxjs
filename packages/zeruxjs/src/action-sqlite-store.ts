import type {SqliteSyncTransactionRunner,SqliteSyncTransaction} from '@zeruxjs/db-sqlite';
import type {ActionStore,ActionClaim,ActionClaimStatus} from './action-stores.js';
import {validateClaimOptions,claimStatus} from './action-claim.js';
export interface SynchronousActionJournal {
 readonly durable:true;
 reserve(tx:SqliteSyncTransaction,claim:ActionClaim):ActionClaimStatus;
 finish(tx:SqliteSyncTransaction,claim:ActionClaim):boolean;
}
/** Never await across SQLite BEGIN/COMMIT. Pending claims survive any write error. */
export function createSqliteActionStore(input:{transactionSync:SqliteSyncTransactionRunner;journal:SynchronousActionJournal}):ActionStore<SqliteSyncTransaction>{
 if(!input||typeof input.transactionSync!=='function'||input.journal?.durable!==true||typeof input.journal.reserve!=='function'||typeof input.journal.finish!=='function')throw Error('SQLite action journal required');
 const transaction=input.transactionSync,journal={reserve:input.journal.reserve.bind(input.journal),finish:input.journal.finish.bind(input.journal)};
 const synchronous=<T>(value:T):T=>{if(value&&typeof (value as any).then==='function'){void Promise.resolve(value).catch(()=>{});throw Error('Async work in synchronous action');}return value;};
 const settings=(claim:ActionClaim,signal:AbortSignal,deadline:number)=>{validateClaimOptions(claim,signal,deadline);return {signal,timeoutMs:Math.max(1,Math.min(60000,deadline-Date.now()))};};
 return Object.freeze({capability:'action-atomic-v1',durable:true,synchronous:true,
  async claim(claim:ActionClaim,signal:AbortSignal,deadline:number){return claimStatus(transaction(tx=>synchronous(journal.reserve(tx,claim)),settings(claim,signal,deadline)));},
  async commit(claim:ActionClaim,write:(tx:SqliteSyncTransaction)=>void|Promise<void>,signal:AbortSignal,deadline:number){transaction(tx=>{synchronous(write(tx));if(synchronous(journal.finish(tx,claim))!==true)throw Error('Action journal ownership lost');},settings(claim,signal,deadline));}
 });
}
