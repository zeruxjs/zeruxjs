import {createHash,randomUUID} from 'node:crypto';
import type {CampaignDatabaseConnection} from './campaign-storage.js';
import {addressString,validateEmailAddress} from './validation.js';

export type ReputationEventKind='accepted'|'hard-bounce'|'soft-bounce'|'complaint';
export interface ReputationEvent {
  /** Authenticated SMTP result or trusted, signature-verified provider feedback. */
  id:string; account:string; kind:ReputationEventKind; at:number;
  /** Hash of recipient to avoid storing plaintext email in the reputation ledger. */
  recipientHash:string;
}
export interface ReputationLedger {
  record(event:ReputationEvent):Promise<boolean>;
  /** Ascending order by immutable ID; pagination may be implemented by the DB connector. */
  page(account:string,since:number,offset:number,limit:number):Promise<ReputationEvent[]>;
}
const accountPattern=/^[a-z][a-z0-9_-]{0,63}$/;
const trustedId=/^[A-Za-z0-9:_./-]{1,160}$/;
const canonical=(email:string)=>addressString(validateEmailAddress(email)).toLowerCase();
const hash=(input:string)=>createHash('sha256').update(input).digest('hex');
export function createMemoryReputationLedger():ReputationLedger{
  const entries=new Map<string,ReputationEvent>();
  return {
    async record(event){if(entries.has(event.id))return false;entries.set(event.id,{...event});return true;},
    async page(account,since,offset,limit){return [...entries.values()].filter(r=>r.account===account&&r.at>=since).sort((a,b)=>a.id.localeCompare(b.id)).slice(offset,offset+limit).map(r=>({...r}));}
  };
}
/** Provider-neutral SQL/Mongo ledger. All reports read committed events; no process-local counters. */
export function createDatabaseReputationLedger(db:CampaignDatabaseConnection,table='zerux_email_reputation_events'):ReputationLedger{
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(table))throw new TypeError('Invalid reputation table');
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{
    const result=await db.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:64,primary:true,notNull:true},
      {name:'account',type:'varchar',length:64,notNull:true},
      {name:'kind',type:'varchar',length:32,notNull:true},
      {name:'occurred_at',type:'bigint',notNull:true},
      {name:'recipient_hash',type:'varchar',length:64,notNull:true}
    ]});if(!result?.ok)throw new Error('Reputation ledger initialization failed');
  })().catch(error=>{ready=undefined;throw error;});
  return {
    async record(event){await ensure();try{
      const r=await db.insert({table,values:{id:event.id,account:event.account,kind:event.kind,occurred_at:event.at,recipient_hash:event.recipientHash}});
      if(r?.ok)return true;
    }catch(error){
      const prior=await db.select({table,columns:['id'],where:{field:'id',operator:'eq',value:event.id},limit:1});
      if(prior?.ok&&prior.rows?.length)return false;throw error;
    }
      const prior=await db.select({table,columns:['id'],where:{field:'id',operator:'eq',value:event.id},limit:1});
      if(prior?.ok&&prior.rows?.length)return false;throw new Error('Reputation event write failed');
    },
    async page(account,since,offset,limit){await ensure();const result=await db.select({table,columns:['id','account','kind','occurred_at','recipient_hash'],where:{and:[{field:'account',operator:'eq',value:account},{field:'occurred_at',operator:'gte',value:since}]},orderBy:[{by:'id',direction:'asc'}],offset,limit});
      if(!result?.ok||!Array.isArray(result.rows))throw new Error('Reputation history lookup failed');
      return result.rows.map(row=>{const r=row as Record<string,unknown>;return {id:String(r.id),account:String(r.account),kind:String(r.kind) as ReputationEventKind,at:Number(r.occurred_at),recipientHash:String(r.recipient_hash)};});
    }
  };
}
export interface ReputationPolicy {
  /** Rolling evaluation window. Default 7 days. */
  windowMs?:number;
  /** Minimum SMTP-accepted recipients required before automatically pausing. */
  minimumAccepted?:number;
  /** Warn/hold ratios, in percent rather than fractional values. */
  warnBouncePercent?:number;
  pauseBouncePercent?:number;
  warnComplaintPercent?:number;
  pauseComplaintPercent?:number;
  /** Optional soft-bounce monitoring thresholds. Unset keeps the existing hard-bounce/complaint policy. */
  warnSoftBouncePercent?:number;
  pauseSoftBouncePercent?:number;
  /** Explicit opt in for blocking critical transactional emails on account reputation. */
  protectTransactional?:boolean;
  /** Maximum rows to scan before refusing to issue an incomplete verdict. */
  scanLimit?:number;
}
export interface ReputationSnapshot {
  account:string;since:number;at:number;accepted:number;hardBounces:number;softBounces:number;complaints:number;
  bouncePercent:number;softBouncePercent:number;complaintPercent:number;status:'healthy'|'warning'|'paused';
  /** False when fewer than minimumAccepted recipients were observed; no healthy-reputation claim is implied. */
  sampleSufficient:boolean;
  /** The ledger only includes reports that were actually received from providers. */
  feedbackCoverage:'reported-only';
}
export function createEmailReputationService(options:{ledger:ReputationLedger;policy?:ReputationPolicy;now?:()=>number}){
  const ledger=options?.ledger;if(!ledger||typeof ledger.record!=='function'||typeof ledger.page!=='function')throw new TypeError('Reputation ledger required');
  const p=options.policy??{},now=options.now??Date.now;
  const windowMs=p.windowMs??7*86_400_000,min=p.minimumAccepted??100,limit=p.scanLimit??100_000;
  const warnBounce=p.warnBouncePercent??2,pauseBounce=p.pauseBouncePercent??5;
  const warnComplaint=p.warnComplaintPercent??0.05,pauseComplaint=p.pauseComplaintPercent??0.1;
  const warnSoft=p.warnSoftBouncePercent,pauseSoft=p.pauseSoftBouncePercent;
  if((warnSoft===undefined)!==(pauseSoft===undefined))throw new RangeError('Soft-bounce warning and pause limits must be configured together');
  if(!Number.isSafeInteger(windowMs)||windowMs<3_600_000||windowMs>90*86_400_000||!Number.isSafeInteger(min)||min<1||min>100_000||!Number.isSafeInteger(limit)||limit<100||limit>1_000_000||
    [warnBounce,pauseBounce,warnComplaint,pauseComplaint,...(warnSoft===undefined?[]:[warnSoft,pauseSoft!])].some(n=>!Number.isFinite(n)||n<0||n>100)||warnBounce>pauseBounce||warnComplaint>pauseComplaint||(warnSoft!==undefined&&warnSoft>pauseSoft!))throw new RangeError('Invalid reputation policy');
  const verifyAccount=(account:string)=>{if(typeof account!=='string'||!accountPattern.test(account))throw new TypeError('Invalid reputation account');return account;};
  const record=async(account:string,kind:ReputationEventKind,email:string,eventId:string,at=now())=>{
    verifyAccount(account);canonical(email);
    if(!trustedId.test(eventId)||!Number.isSafeInteger(at)||at<0||at>now()+300_000)throw new TypeError('Invalid reputation event');
    const entry:ReputationEvent={id:hash(`${account}:${kind}:${eventId}:${hash(canonical(email))}`),account,kind,at,recipientHash:hash(canonical(email))};
    return ledger.record(entry);
  };
  return {
    /** Invoke once per SMTP-accepted recipient. Never equate SMTP acceptance to inbox delivery. */
    recordAccepted:(account:string,email:string,messageId:string,at?:number)=>record(account,'accepted',email,hash(messageId),at),
    /** Only invoke after provider authentication / trusted bounce mail processing. */
    recordFeedback:(input:{account:string;email:string;eventId:string;kind:'hard-bounce'|'soft-bounce'|'complaint';at?:number})=>record(input.account,input.kind,input.email,input.eventId,input.at),
    async snapshot(account:string):Promise<ReputationSnapshot>{
      verifyAccount(account);const at=now(),since=at-windowMs;
      const totals={accepted:0,hardBounces:0,softBounces:0,complaints:0};let offset=0;
      while(offset<limit){
        const size=Math.min(500,limit-offset);
        const batch=await ledger.page(account,since,offset,size);
        if(!Array.isArray(batch)||batch.length>size)throw new Error('Invalid reputation ledger page');
        for(const item of batch){if(item.account!==account||item.at<since||item.at>at)continue;
          if(item.kind==='accepted')totals.accepted++;else if(item.kind==='hard-bounce')totals.hardBounces++;else if(item.kind==='soft-bounce')totals.softBounces++;else if(item.kind==='complaint')totals.complaints++;
        }
        offset+=batch.length;
        if(batch.length<size)break;
      }
      // A full final page is not evidence of truncation. Only refuse a verdict if
      // an additional event actually exists beyond the allowed scan window.
      if(offset===limit&&(await ledger.page(account,since,offset,1)).length>0)
        throw new Error('Reputation scan limit reached; an exact verdict is unavailable');
      const bouncePercent=totals.accepted?100*totals.hardBounces/totals.accepted:0;
      const softBouncePercent=totals.accepted?100*totals.softBounces/totals.accepted:0;
      const complaintPercent=totals.accepted?100*totals.complaints/totals.accepted:0;
      const enough=totals.accepted>=min;
      const status:ReputationSnapshot['status']=enough&&(bouncePercent>=pauseBounce||complaintPercent>=pauseComplaint||(pauseSoft!==undefined&&softBouncePercent>=pauseSoft))?'paused':enough&&(bouncePercent>=warnBounce||complaintPercent>=warnComplaint||(warnSoft!==undefined&&softBouncePercent>=warnSoft))?'warning':'healthy';
      return {account,since,at,...totals,bouncePercent,softBouncePercent,complaintPercent,status,sampleSufficient:enough,feedbackCoverage:'reported-only'};
    },
    async checkBeforeSend(account:string,purpose:'marketing'|'transactional'){
      const state=await this.snapshot(account);
      if(state.status==='paused'&&(purpose==='marketing'||p.protectTransactional===true))return {allowed:false,state};
      return {allowed:true,state};
    }
  };
}
