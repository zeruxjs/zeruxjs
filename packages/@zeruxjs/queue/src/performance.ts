/** Exact, database-native campaign state totals and authenticated provider outcome ledger.
 * No recipients, payloads or SMTP credentials are stored here or emitted by reports.
 */
import {createHash} from 'node:crypto';
import type {DeliveryDatabase} from './reporting.js';
import type {EmailDeliveryState} from './delivery.js';

export const deliveryStates=['pending','claimed','sending','sent','suppressed','uncertain','rejected'] as const;
export const providerOutcomes=['delivered','deferred','hard-bounce','soft-bounce','complaint'] as const;
export type ProviderOutcome=typeof providerOutcomes[number];
const campaignId=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const messageId=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const providerId=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const validTable=(name:string)=>/^[a-z][a-z0-9_]{0,62}$/.test(name);
const validTime=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=8_640_000_000_000_000;
const validateDb=(db:DeliveryDatabase)=>{if(!db||typeof db.createTable!=='function'||typeof db.select!=='function'||typeof db.insert!=='function')throw new TypeError('Durable database required');};
const countExpr={expr:{kind:'function' as const,name:'COUNT' as const,args:[{kind:'column' as const,name:'id'}]},as:'event_count'};
const count=(value:unknown)=>{
  const parsed=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
  if(typeof parsed!=='number'||!Number.isSafeInteger(parsed)||parsed<0)throw new Error('Invalid database aggregate count');
  return parsed;
};
async function groupCount<T extends string>(db:DeliveryDatabase,table:string,campaign:string,column:string,labels:readonly T[]):Promise<Record<T,number>>{
  const result=await db.select({table,columns:[{expr:{kind:'column',name:column},as:'category'},countExpr],
    where:{field:'campaign_id',operator:'eq',value:campaign},groupBy:[column],orderBy:[{by:column,direction:'asc'}],limit:labels.length+1});
  if(!result?.ok||!Array.isArray(result.rows)||result.rows.length>labels.length)throw new Error('Campaign aggregation unavailable');
  const totals=Object.fromEntries(labels.map(label=>[label,0])) as Record<T,number>;
  for(const raw of result.rows){
    const row=raw as Record<string,unknown>;
    const category=row?.category;
    if(typeof category!=='string'||!labels.includes(category as T)||totals[category as T]!==0)throw new Error('Invalid campaign aggregate category');
    // Zero-count groups are never returned by a normal grouped COUNT; validate anyway.
    const n=count(row.event_count);
    if(n===0)throw new Error('Invalid zero-sized aggregate group');
    totals[category as T]=n;
  }
  return totals;
}
export interface ProviderOutcomeEvent {
  /** Trusted provider's unique event reference. Never derived from unauthenticated request fields. */
  eventId:string;
  provider:string;
  campaignId:string;
  messageId:string;
  kind:ProviderOutcome;
  occurredAt:number;
}
export interface CampaignProviderOutcomes {
  /** Counts individual authenticated provider events, NOT unique recipients or inbox placement. */
  events:number;
  counts:Record<ProviderOutcome,number>;
  coverage:'reported-events-only';
}
export interface ProviderOutcomeLedger {
  /** Returns false for an identical event replay. A conflicting replay throws. */
  record(event:ProviderOutcomeEvent):Promise<boolean>;
  summarize(campaign:string):Promise<CampaignProviderOutcomes>;
}
/** Shared database table and immutable event IDs allow cross-worker webhook replay. */
export function createDatabaseProviderOutcomeLedger(db:DeliveryDatabase,table='zerux_email_provider_outcomes'):ProviderOutcomeLedger{
  validateDb(db);
  if(!validTable(table))throw new TypeError('Invalid provider event table');
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{
    const r=await db.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:64,primary:true,notNull:true},
      {name:'provider',type:'varchar',length:96,notNull:true},
      {name:'campaign_id',type:'varchar',length:96,notNull:true},
      {name:'message_id',type:'varchar',length:128,notNull:true},
      {name:'kind',type:'varchar',length:32,notNull:true},
      {name:'occurred_at',type:'bigint',notNull:true}
    ]});
    if(!r?.ok)throw new Error('Provider outcome table unavailable');
    if(db.createIndex){
      for(const [suffix,columns] of [['camp_kind_idx',['campaign_id','kind']],['camp_day_idx',['campaign_id','occurred_at']]] as const){
        try{await db.createIndex({table,name:`${table.slice(0,40)}_${suffix}`,columns:[...columns],ifNotExists:true});}
        catch{/* optional performance indexes; feedback recording must not be blocked */}
      }
    }
  })().catch(error=>{ready=undefined;throw error;});
  const normalized=(event:ProviderOutcomeEvent)=>{
    if(!event||typeof event.eventId!=='string'||!/^[-A-Za-z0-9:_.\/]{1,160}$/.test(event.eventId)||!providerId.test(event.provider)||
      !campaignId.test(event.campaignId)||!messageId.test(event.messageId)||!providerOutcomes.includes(event.kind)||!validTime(event.occurredAt))throw new TypeError('Invalid provider outcome');
    const id=createHash('sha256').update(JSON.stringify([event.provider,event.eventId])).digest('hex');
    return {id,provider:event.provider,campaign_id:event.campaignId,message_id:event.messageId,kind:event.kind,occurred_at:event.occurredAt};
  };
  return {
    async record(event){
      const row=normalized(event);await ensure();
      const lookup=async()=>{
        const r=await db.select({table,columns:['id','provider','campaign_id','message_id','kind','occurred_at'],where:{field:'id',operator:'eq',value:row.id},limit:1});
        if(!r?.ok||!Array.isArray(r.rows))throw new Error('Provider event lookup unavailable');
        return r.rows[0] as Record<string,unknown>|undefined;
      };
      try{const r=await db.insert({table,values:row});if(r?.ok)return true;}
      catch(error){
        const old=await lookup();if(!old)throw error;
        if(old.provider!==row.provider||old.campaign_id!==row.campaign_id||old.message_id!==row.message_id||old.kind!==row.kind||Number(old.occurred_at)!==row.occurred_at)throw new Error('Conflicting provider event replay');
        return false;
      }
      const old=await lookup();
      if(old){if(old.provider!==row.provider||old.campaign_id!==row.campaign_id||old.message_id!==row.message_id||old.kind!==row.kind||Number(old.occurred_at)!==row.occurred_at)throw new Error('Conflicting provider event replay');return false;}
      throw new Error('Provider event insert unavailable');
    },
    async summarize(campaign){
      if(!campaignId.test(campaign))throw new TypeError('Invalid campaign ID');await ensure();
      const counts=await groupCount(db,table,campaign,'kind',providerOutcomes);
      return {counts,events:Object.values(counts).reduce((sum,n)=>sum+n,0),coverage:'reported-events-only'};
    }
  };
}
export interface CampaignPerformanceReport {
  campaignId:string;
  /** Counted without an application-side row cap. Queries are read-committed, not snapshot-isolated. */
  mode:'database';complete:true;total:number;
  counts:Record<EmailDeliveryState,number>;
  smtpAcceptedPercent:number|null;
  /** Daily buckets and activity summaries require a separate bounded report. */
  dailyCoverage:'not-computed';activityCoverage:'not-computed';
  /** Only authenticated provider feedback captured in the optional ledger. */
  provider:CampaignProviderOutcomes|null;
}
/** Database-native all-time campaign totals; does NOT silently imply full activity/provider coverage. */
export function createDatabaseCampaignPerformanceReporter(options:{db:DeliveryDatabase;deliveryTable?:string;provider?:ProviderOutcomeLedger}){
  const db=options?.db;validateDb(db);
  const table=options.deliveryTable??'zerux_email_delivery';
  if(!validTable(table))throw new TypeError('Invalid delivery table');
  // The delivery store owns this table's creation and migrations; initializing it here
  // would allow accidentally treating a missing store as a campaign with zero messages.
  return async (campaign:string):Promise<CampaignPerformanceReport>=>{
    if(!campaignId.test(campaign))throw new TypeError('Invalid campaign ID');
    const counts=await groupCount(db,table,campaign,'state',deliveryStates);
    const total=Object.values(counts).reduce((sum,n)=>sum+n,0);
    if(!Number.isSafeInteger(total))throw new Error('Campaign total exceeds safe integer range');
    const provider=options.provider?await options.provider.summarize(campaign):null;
    return {campaignId:campaign,mode:'database',complete:true,total,counts,
      smtpAcceptedPercent:total?100*counts.sent/total:null,dailyCoverage:'not-computed',activityCoverage:'not-computed',provider};
  };
}
