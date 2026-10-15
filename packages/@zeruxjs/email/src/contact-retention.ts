/** Privacy-conscious, bounded contact retention sweep. Deleting list contacts never
 * implies deletion from independent suppression/consent/audit systems; those require
 * their own compliance policies and must not be blindly removed. */
import type {MailingContact,MailingContactStore} from './contacts.js';

export interface ContactRetentionOptions {
  store:MailingContactStore;
  /** Delete only records with updatedAt strictly below this UTC epoch millisecond cutoff. */
  olderThan:number;
  /** Host MUST check for legal holds, active campaigns, support and billing dependencies. */
  canErase:(contact:Readonly<MailingContact>)=>Promise<boolean>|boolean;
  /** Dry-run by default. Production erasure requires explicit dryRun:false. */
  dryRun?:boolean;
  cursor?:string|null;
  pageSize?:number;
  maxScanned?:number;
  signal?:AbortSignal;
  /** Best-effort PII-free auditing; invoked only after successful delete. */
  onErased?:(metadata:{contactId:string;at:number})=>void|Promise<void>;
  now?:()=>number;
}
export async function sweepMailingContactRetention(options:ContactRetentionOptions){
  const {store,canErase}=options??{} as ContactRetentionOptions;
  const olderThan=options.olderThan,pageSize=options.pageSize??100,maxScanned=options.maxScanned??1000;
  const dryRun=options.dryRun!==false,cursor=options.cursor??null;
  if(!store||typeof store.page!=='function'||typeof store.load!=='function'||typeof canErase!=='function'||
    !Number.isSafeInteger(olderThan)||olderThan<0||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>200||
    !Number.isSafeInteger(maxScanned)||maxScanned<1||maxScanned>10_000||
    cursor!==null&&!/^[a-f0-9]{64}$/.test(cursor)||!dryRun&&typeof store.delete!=='function')
    throw new TypeError('Invalid contact retention configuration');
  const now=options.now??Date.now;
  const check=()=>{if(options.signal?.aborted)throw options.signal.reason??new Error('Contact retention aborted');};
  let scanned=0,eligible=0,erased=0,skipped=0,contended=0,position=cursor,done=false,auditFailures=0;
  while(scanned<maxScanned){
    check();const limit=Math.min(pageSize,maxScanned-scanned);
    const page=await store.page(position,limit);
    if(!page||!Array.isArray(page.items)||page.items.length>limit)throw new Error('Invalid contact retention page');
    let previous=position;
    for(const contact of page.items){
      check();if(!contact||typeof contact.id!=='string'||!/^[a-f0-9]{64}$/.test(contact.id)||
        previous!==null&&contact.id<=previous||!Number.isSafeInteger(contact.updatedAt)||contact.updatedAt<0||
        !Number.isSafeInteger(contact.version)||contact.version<1)throw new Error('Invalid or unsorted contact row');
      previous=contact.id;position=contact.id;scanned++;
      if(contact.updatedAt>=olderThan){skipped++;continue;}
      // Re-read before deletion; the paginated snapshot might already be stale.
      const latest=await store.load(contact.id);
      if(!latest||latest.version!==contact.version||latest.updatedAt!==contact.updatedAt){contended++;continue;}
      if(await canErase(structuredClone(latest))!==true){skipped++;continue;}
      eligible++;
      if(!dryRun){
        check();if(await store.delete!(latest.id,latest.version)){
          erased++;try{await options.onErased?.({contactId:latest.id,at:now()});}catch{auditFailures++;}
        }else contended++;
      }
    }
    if(page.items.length<limit||page.done===true){done=true;break;}
    if(!page.items.length)throw new Error('Contact pagination made no progress');
  }
  // At an exact scan boundary the next page might be empty. Do not claim completeness.
  return {scanned,eligible,erased,skipped,contended,auditFailures,nextCursor:done?null:position,done,
    dryRun,coverage:'bounded-versioned-contact-scan' as const};
}
