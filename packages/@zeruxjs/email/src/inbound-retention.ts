/** Host-authorized inbound retention. Only deletes LOCAL inbox metadata, never remote IMAP/POP3 mail. */
import type {InboundMessage,InboundStore} from './inbound.js';
export interface InboundRetentionOptions {
  store:InboundStore;account:string;
  /** Earliest allowed receivedAt timestamp (ms); older messages are candidates. */
  olderThan:number;
  /** A host must decide legal holds, active support requests, and attachment deletion policy. */
  canErase:(message:Readonly<InboundMessage>)=>boolean|Promise<boolean>;
  /** Defaults to true. Production deletion requires an explicit false. */
  dryRun?:boolean;
  cursor?:string|null;pageSize?:number;maxScanned?:number;signal?:AbortSignal;
  /** Callbacks should be idempotent; failures are counted, not swallowed as successful cleanup. */
  afterErase?:(entry:{id:string;account:string;references:string[]})=>Promise<void>|void;
}
export async function sweepInboundRetention(options:InboundRetentionOptions){
  const {store,account,olderThan,canErase}=options??{} as InboundRetentionOptions;
  const pageSize=options?.pageSize??100,maxScanned=options?.maxScanned??1000,dryRun=options?.dryRun!==false;
  if(!store||typeof store.page!=='function'||typeof store.get!=='function'||typeof canErase!=='function'||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(account)||!Number.isSafeInteger(olderThan)||olderThan<0||
    !Number.isSafeInteger(pageSize)||pageSize<1||pageSize>200||!Number.isSafeInteger(maxScanned)||maxScanned<1||maxScanned>10000||
    options.cursor!=null&&!/^[a-f0-9]{64}$/.test(options.cursor)||!dryRun&&typeof store.erase!=='function')
    throw new TypeError('Invalid inbound retention configuration');
  let cursor=options.cursor??null,scanned=0,eligible=0,erased=0,skipped=0,contended=0,cleanupFailures=0,done=false;
  const check=()=>{if(options.signal?.aborted)throw options.signal.reason??new Error('Inbound retention aborted');};
  while(scanned<maxScanned){
    check();const limit=Math.min(pageSize,maxScanned-scanned);
    const page=await store.page(account,cursor,limit);
    if(!page||!Array.isArray(page.items)||page.items.length>limit)throw new Error('Invalid inbox retention page');
    let last=cursor;
    for(const message of page.items){
      check();if(!message||message.account!==account||!Number.isSafeInteger(message.receivedAt)||message.receivedAt<0||
        typeof message.id!=='string'||!/^[a-f0-9]{64}$/.test(message.id)||last!==null&&message.id<=last)
        throw new Error('Invalid or out-of-order inbox retention row');
      last=cursor=message.id;scanned++;
      if(message.receivedAt>=olderThan){skipped++;continue;}
      const latest=await store.get(message.id);
      if(!latest||latest.account!==account||latest.receivedAt!==message.receivedAt){contended++;continue;}
      if(await canErase(structuredClone(latest))!==true){skipped++;continue;}
      eligible++;
      if(!dryRun){check();if(await store.erase!(message.id,account)){
        erased++;
        try{await options.afterErase?.({id:message.id,account,references:message.attachments.map(a=>a.storedReference).filter((v):v is string=>Boolean(v))});}
        catch{cleanupFailures++;}
      }else contended++;}
    }
    if(page.done===true||page.items.length<limit){done=true;break;}
    if(page.items.length===0)throw new Error('Inbox retention pagination stalled');
  }
  return {scanned,eligible,erased,skipped,contended,cleanupFailures,dryRun,done,nextCursor:done?null:cursor,
    coverage:'bounded-local-inbox-retention' as const};
}
