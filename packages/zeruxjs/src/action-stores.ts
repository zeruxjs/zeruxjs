import type {DatabaseTransaction,TransactionDatabase} from '@zeruxjs/db';
export interface ActionClaim {readonly key:string;readonly digest:string;readonly owner:string;readonly expiresAt:number}
export type ActionClaimStatus='claimed'|'committed'|'pending'|'conflict';
/** Host-owned durable journal. reserve must atomically create-if-absent or compare
 * the fingerprint; never recycle a pending claim to authorize a retry. Expiry
 * cleanup must wait until no signed key is acceptable on any participating instance.
 * finish must CAS this exact owner/fingerprint and use the supplied transaction. */
export interface ActionJournal<T> {
 readonly durable:true;
 reserve(tx:T,claim:ActionClaim):ActionClaimStatus|Promise<ActionClaimStatus>;
 finish(tx:T,claim:ActionClaim):boolean|Promise<boolean>;
}
export interface ActionStore<T> {
 readonly capability:'action-atomic-v1';
 readonly durable:true;
 readonly synchronous:boolean;
 claim(claim:ActionClaim,signal:AbortSignal,deadline:number):Promise<ActionClaimStatus>;
 commit(claim:ActionClaim,write:(tx:T)=>void|Promise<void>,signal:AbortSignal,deadline:number):Promise<void>;
}
import {validateClaimOptions,claimStatus} from './action-claim.js';
/** Both durable claim and completion use real negotiated pins. No callback retry. */
export function createPinnedActionStore(options:{transaction:DatabaseTransaction;journal:ActionJournal<TransactionDatabase>}):ActionStore<TransactionDatabase>{
 if(!options||typeof options.transaction!=='function'||options.journal?.durable!==true||typeof options.journal.reserve!=='function'||typeof options.journal.finish!=='function')throw Error('Pinned action journal required');
 const transaction=options.transaction,journal={reserve:options.journal.reserve.bind(options.journal),finish:options.journal.finish.bind(options.journal)};
 return Object.freeze({capability:'action-atomic-v1',durable:true,synchronous:false,
  async claim(claim:ActionClaim,signal:AbortSignal,deadline:number){return claimStatus(await transaction(tx=>journal.reserve(tx,claim),validateClaimOptions(claim,signal,deadline)));},
  async commit(claim:ActionClaim,write:(tx:TransactionDatabase)=>void|Promise<void>,signal:AbortSignal,deadline:number){await transaction(async tx=>{await write(tx);if(await journal.finish(tx,claim)!==true)throw Error('Action journal ownership lost');},validateClaimOptions(claim,signal,deadline));}
 });
}
