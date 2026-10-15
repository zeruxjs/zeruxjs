/** Database-native, bounded UTC-day campaign trends.
 * Counts refer to the current delivery state indexed by its last update day, NOT
 * immutable delivery transitions. Provider counts are authenticated notifications,
 * not unique recipients or inbox-placement guarantees.
 */
import type {DeliveryDatabase} from './reporting.js';
import {deliveryStates,providerOutcomes} from './performance.js';
import type {EmailDeliveryState} from './delivery.js';
import type {ProviderOutcome} from './performance.js';

const DAY_MS=86_400_000;
const campaignPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const tablePattern=/^[a-z][a-z0-9_]{0,62}$/;
const utcDay=/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const countExpr={expr:{kind:'function' as const,name:'COUNT' as const,args:[{kind:'column' as const,name:'id'}]},as:'event_count'};
function dayTime(day:string){
  if(typeof day!=='string'||!utcDay.test(day))throw new TypeError('Invalid UTC date');
  const milliseconds=Date.parse(`${day}T00:00:00.000Z`);
  if(!Number.isSafeInteger(milliseconds)||new Date(milliseconds).toISOString().slice(0,10)!==day)
    throw new TypeError('Invalid calendar date');
  return milliseconds;
}
function count(value:unknown){
  const n=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
  if(typeof n!=='number'||!Number.isSafeInteger(n)||n<1)throw new Error('Invalid database trend count');
  return n;
}
async function grouped<T extends string>(db:DeliveryDatabase,table:string,campaignId:string,column:string,timeColumn:string,start:number,end:number,labels:readonly T[]):Promise<Record<T,number>>{
  const result=await db.select({table,columns:[{expr:{kind:'column',name:column},as:'category'},countExpr],
    where:{and:[{field:'campaign_id',operator:'eq',value:campaignId},{field:timeColumn,operator:'gte',value:start},{field:timeColumn,operator:'lt',value:end}]},
    groupBy:[column],orderBy:[{by:column,direction:'asc'}],limit:labels.length+1});
  if(!result?.ok||!Array.isArray(result.rows)||result.rows.length>labels.length)throw new Error('Campaign trend database aggregation unavailable');
  const totals=Object.fromEntries(labels.map(label=>[label,0])) as Record<T,number>;
  const seen=new Set<string>();
  for(const raw of result.rows){
    const row=raw as Record<string,unknown>;
    if(!row||typeof row.category!=='string'||!labels.includes(row.category as T)||seen.has(row.category))throw new Error('Invalid campaign trend category');
    totals[row.category as T]=count(row.event_count);
    seen.add(row.category);
  }
  return totals;
}
const safeSum=(values:number[])=>{
  const total=values.reduce((n,v)=>n+v,0);
  if(!Number.isSafeInteger(total))throw new Error('Campaign trend total exceeds safe integer range');
  return total;
};
export interface CampaignTrendDay {
  day:string;
  /** Current durable record states, categorized by last updated UTC day. */
  counts:Record<EmailDeliveryState,number>;
  total:number;
  /** Only provider events actually received and persisted, including repeat notifications for one message. */
  provider:Record<ProviderOutcome,number>|null;
  providerEvents:number|null;
}
export interface CampaignTrendsReport {
  campaignId:string;from:string;to:string;mode:'database';complete:true;
  deliveryCoverage:'last-state-update-day';
  providerCoverage:'reported-events-only'|'not-configured';
  /** Individual daily queries are not a transaction-wide snapshot. */
  snapshotConsistent:false;
  days:CampaignTrendDay[];
  total:number;
  providerEvents:number|null;
}
/**
 * Query a bounded UTC date range with native grouped COUNT expressions.
 * At most 92 days, with no individual delivery/recipient records fetched.
 * Neither table is implicitly created: missing storage must fail, not read as zero.
 */
export function createDatabaseCampaignTrendsReporter(options:{db:DeliveryDatabase;deliveryTable?:string;providerTable?:string;maxDays?:number}){
  const db=options?.db;
  if(!db||typeof db.select!=='function')throw new TypeError('Durable trend database required');
  const deliveryTable=options.deliveryTable??'zerux_email_delivery';
  const providerTable=options.providerTable;
  if(!tablePattern.test(deliveryTable)||(providerTable!==undefined&&!tablePattern.test(providerTable)))throw new TypeError('Invalid campaign trend table');
  const maxDays=options.maxDays??92;
  if(!Number.isSafeInteger(maxDays)||maxDays<1||maxDays>366)throw new RangeError('Invalid maximum campaign trend days');
  return async function trends(campaignId:string,from:string,to:string):Promise<CampaignTrendsReport>{
    if(!campaignPattern.test(campaignId))throw new TypeError('Invalid campaign ID');
    const start=dayTime(from),last=dayTime(to);
    if(last<start||Math.round((last-start)/DAY_MS)+1>maxDays)throw new RangeError('Campaign trend date window exceeds configured bounds');
    const days:CampaignTrendDay[]=[];
    for(let cursor=start;cursor<=last;cursor+=DAY_MS){
      const day=new Date(cursor).toISOString().slice(0,10);
      // One day per iteration bounds connector pressure and prevents unbounded parallel reads.
      const counts=await grouped(db,deliveryTable,campaignId,'state','updated_at',cursor,cursor+DAY_MS,deliveryStates);
      const provider=providerTable===undefined?null:await grouped(db,providerTable,campaignId,'kind','occurred_at',cursor,cursor+DAY_MS,providerOutcomes);
      days.push({day,counts,total:safeSum(Object.values(counts)),provider,providerEvents:provider?safeSum(Object.values(provider)):null});
    }
    return {campaignId,from,to,mode:'database',complete:true,deliveryCoverage:'last-state-update-day',
      providerCoverage:providerTable===undefined?'not-configured':'reported-events-only',snapshotConsistent:false,days,
      total:safeSum(days.map(day=>day.total)),providerEvents:providerTable===undefined?null:safeSum(days.map(day=>day.providerEvents??0))};
  };
}
