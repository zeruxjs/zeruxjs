/** Durable IMAP UID checkpoint coordinator. Only credentials stay with the receiver; no message data is stored here. */
import {createHash,randomUUID} from 'node:crypto';
import type {CampaignDatabaseConnection} from './campaign-storage.js';
import type {IncomingPollCursor} from './inbound.js';

export interface MailboxSyncState {
  id:string;account:string;mailbox?:string;version:number;epoch:number;
  cursor:IncomingPollCursor;
  lease:null|{owner:string;token:string;expiresAt:number};
  status:'idle'|'running'|'failed';
  pages:number;received:number;updatedAt:number;lastError:'POLL_FAILED'|null;
}
export interface MailboxSyncOptions {
  db:CampaignDatabaseConnection;
  id:string;account:string;
  /** Optional IMAP folder; each folder has its own durable checkpoint and lease. */
  mailbox?:string;
  receiver:{poll:(account:string,options:{cursor:IncomingPollCursor;mailbox?:string})=>Promise<{stored:number;nextCursor?:IncomingPollCursor}>};
  leaseMs?:number;table?:string;now?:()=>number;
}
const validName=(v:string)=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,80}$/.test(v);
/** DB unique inserts and atomic affectedCount CAS are required for cross-process worker safety. */
export function createDatabaseMailboxSync(options:MailboxSyncOptions){
  const {db,id,account,receiver,mailbox}=options;
  const table=options.table??'zerux_email_mailbox_sync',leaseMs=options.leaseMs??60000,clock=options.now??Date.now;
  if(!db||!validName(id)||!validName(account)||!receiver||typeof receiver.poll!=='function'||
    (mailbox!==undefined&&(typeof mailbox!=='string'||!mailbox||mailbox.length>255||/[\r\n\0]/.test(mailbox)))||
    !/^[a-z][a-z0-9_]{0,62}$/.test(table)||!Number.isSafeInteger(leaseMs)||leaseMs<3000||leaseMs>3600000)
    throw new TypeError('Invalid mailbox sync options');
  // Preserve historical checkpoint keys for unscoped workers; new folders are isolated.
  const key='ims_'+createHash('sha256').update(JSON.stringify(mailbox===undefined?[id,account]:[id,account,mailbox])).digest('hex');
  const timestamp=()=>{const v=clock();if(!Number.isSafeInteger(v)||v<0)throw new Error('Invalid mailbox sync clock');return v;};
  const initial:MailboxSyncState={id,account,...(mailbox?{mailbox}:{}),version:1,epoch:0,cursor:{afterUid:0,...(mailbox?{mailbox}:{})},lease:null,status:'idle',pages:0,received:0,updatedAt:timestamp(),lastError:null};
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{const r=await db.createTable({table,ifNotExists:true,columns:[
    {name:'id',type:'varchar',length:68,primary:true,notNull:true},
    {name:'version',type:'bigint',notNull:true},{name:'payload_json',type:'text',notNull:true}]});
    if(!r?.ok)throw new Error('Mailbox sync table unavailable');
  })().catch(e=>{ready=undefined;throw e;});
  async function lookup():Promise<MailboxSyncState|null>{
    const r=await db.select({table,columns:['id','version','payload_json'],where:{field:'id',operator:'eq',value:key},limit:1});
    if(!r?.ok||!Array.isArray(r.rows))throw new Error('Mailbox sync read failed');
    const row=r.rows[0] as Record<string,unknown>|undefined;if(!row)return null;
    const s=JSON.parse(String(row.payload_json)) as MailboxSyncState;
    if(s.id!==id||s.account!==account||
      (mailbox!==undefined&&s.mailbox!==mailbox)||
      (s.mailbox!==undefined&&s.cursor?.mailbox!==s.mailbox)||
      !Number.isSafeInteger(s.version)||s.version!==Number(row.version)||s.version<1||
      !Number.isSafeInteger(s.epoch)||s.epoch<0||!Number.isSafeInteger(s.cursor?.afterUid)||s.cursor.afterUid<0||
      s.cursor.uidValidity!==undefined&&!/^\d+$/.test(s.cursor.uidValidity)||
      !Number.isSafeInteger(s.pages)||s.pages<0||!Number.isSafeInteger(s.received)||s.received<0||
      !['idle','running','failed'].includes(s.status))throw new Error('Corrupt mailbox sync checkpoint');
    return s;
  }
  async function read(){await ensure();const state=await lookup();if(state)return state;
    try{const r=await db.insert({table,values:{id:key,version:1,payload_json:JSON.stringify(initial)}});
      if(r?.ok)return structuredClone(initial);}catch(error){const concurrent=await lookup();if(concurrent)return concurrent;throw error;}
    const concurrent=await lookup();if(concurrent)return concurrent;throw new Error('Mailbox sync initialization failed');
  }
  async function cas(s:MailboxSyncState,patch:Omit<MailboxSyncState,'version'>){
    const next={...patch,version:s.version+1};
    const r=await db.update({table,values:{version:next.version,payload_json:JSON.stringify(next)},where:{and:[
      {field:'id',operator:'eq',value:key},{field:'version',operator:'eq',value:s.version}]}});
    if(!r?.ok)throw new Error('Mailbox sync write failed');
    const count=r.affectedCount??r.rowCount;
    if(!Number.isSafeInteger(count)||count!==0&&count!==1)throw new Error('Mailbox sync requires atomic affectedCount');
    return count===1;
  }
  const publicState=(s:MailboxSyncState)=>({...s,lease:s.lease?{owner:s.lease.owner,expiresAt:s.lease.expiresAt}:null});
  async function acquire(owner:string){if(!validName(owner))throw new TypeError('Invalid sync worker');
    for(let i=0;i<20;i++){const s=await read(),t=timestamp();
      if(s.lease&&s.lease.expiresAt>t)return null;
      const epoch=s.epoch+1,lease={owner,token:randomUUID(),expiresAt:t+leaseMs};
      if(await cas(s,{...s,epoch,status:'running',lease,updatedAt:t,lastError:null}))return {owner,token:lease.token,epoch};
    }throw new Error('Mailbox sync lease contention');
  }
  const owns=(s:MailboxSyncState,l:{owner:string;token:string;epoch:number})=>
    s.status==='running'&&s.epoch===l.epoch&&s.lease?.owner===l.owner&&s.lease.token===l.token&&s.lease.expiresAt>timestamp();
  async function runOnce(owner:string){
    const lease=await acquire(owner);if(!lease)return {busy:true,state:publicState(await read())};
    let active=true,lost:unknown,heartbeat=Promise.resolve();
    const timer=setInterval(()=>{if(!active||lost)return;
      heartbeat=heartbeat.then(async()=>{for(let i=0;i<12;i++){
        const state=await read();if(!owns(state,lease))throw new Error('Mailbox sync lease lost');
        if(await cas(state,{...state,lease:{...state.lease!,expiresAt:timestamp()+leaseMs},updatedAt:timestamp()}))return;
      }throw new Error('Mailbox sync renewal contention');}).catch(error=>{lost=error;});
    },Math.max(1000,Math.floor(leaseMs/3)));
    timer.unref?.();
    try{
      const s=await read();if(!owns(s,lease))throw new Error('Mailbox sync lease lost');
      const result=await receiver.poll(account,{cursor:{...s.cursor},...(mailbox?{mailbox}:{})});
      active=false;clearInterval(timer);await heartbeat;
      if(lost)throw lost;
      if(!result?.nextCursor||(mailbox!==undefined&&result.nextCursor.mailbox!==mailbox)||
        (s.mailbox!==undefined&&result.nextCursor.mailbox!==s.mailbox)||
        !Number.isSafeInteger(result.nextCursor.afterUid)||result.nextCursor.afterUid<s.cursor.afterUid||
        !/^\d+$/.test(result.nextCursor.uidValidity??'')||!Number.isSafeInteger(result.stored)||result.stored<0)
        throw new Error('Invalid receiver cursor or result');
      const latest=await read();if(!owns(latest,lease))throw new Error('Mailbox sync lease lost');
      const t=timestamp();const next={...latest,...(result.nextCursor.mailbox?{mailbox:result.nextCursor.mailbox}:{}),
        status:'idle' as const,lease:null,cursor:result.nextCursor,
        pages:latest.pages+1,received:latest.received+result.stored,updatedAt:t,lastError:null};
      if(!await cas(latest,next))throw new Error('Mailbox sync checkpoint lost');
      return {busy:false,state:publicState({...next,version:latest.version+1})};
    }catch(error){
      active=false;clearInterval(timer);await heartbeat;
      for(let i=0;i<8;i++){
        const current=await read();if(!owns(current,lease))break;
        if(await cas(current,{...current,lease:null,status:'failed',lastError:'POLL_FAILED',updatedAt:timestamp()}))break;
      }
      throw error;
    }finally{active=false;clearInterval(timer);}
  }
  /** Administrative reset after explicit investigation of UIDVALIDITY change. Never automatic. */
  async function resetCursor(){for(let i=0;i<15;i++){
    const s=await read(),t=timestamp();if(s.lease&&s.lease.expiresAt>t)throw new Error('Mailbox sync worker active');
    const next={...s,mailbox,epoch:s.epoch+1,cursor:{afterUid:0,...(mailbox?{mailbox}:{})},lease:null,status:'idle' as const,updatedAt:t,lastError:null};
    if(await cas(s,next))return publicState({...next,version:s.version+1});
  }throw new Error('Mailbox sync reset contention');}
  return {get:async()=>publicState(await read()),runOnce,resetCursor};
}

/** Use with a named @zeruxjs/queue BullMQ handler. Jobs carry only sync identifiers. */
export function createIncomingSyncProcessor(
  resolve:(id:string,account:string)=>ReturnType<typeof createDatabaseMailboxSync>|Promise<ReturnType<typeof createDatabaseMailboxSync>>
){
  if(typeof resolve!=='function')throw new TypeError('Mailbox sync resolver required');
  return async(job:{data?:unknown},workerId:string)=>{
    if(!job?.data||typeof job.data!=='object'||Array.isArray(job.data)||
      Object.keys(job.data).length!==2||!validName((job.data as any).id)||!validName((job.data as any).account)||
      !validName(workerId))throw new TypeError('Mailbox sync task accepts only id and account');
    const {id,account}=job.data as {id:string;account:string};
    const handler=await resolve(id,account);
    if(!handler||typeof handler.runOnce!=='function')throw new Error('Registered mailbox sync job missing');
    return handler.runOnce(workerId);
  };
}
