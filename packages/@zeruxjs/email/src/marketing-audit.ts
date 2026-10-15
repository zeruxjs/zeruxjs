/** PII-free, append-only campaign operator audit log; writes are never part of SMTP
 * transaction. Wire record as createMarketingCampaignService({onAudit: log.record}). */
import {randomBytes} from 'node:crypto';
import type {CampaignDatabaseConnection} from './campaign-storage.js';

export type MarketingAuditAction='create'|'append'|'enqueue'|'schedule'|'pause'|'resume'|'cancel'|'redrive'|'archive'|'export'|'retention'|'finalize';
export interface MarketingAuditRecord {id:string;code:string;action:MarketingAuditAction;at:number;count?:number}
const codePattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const tablePattern=/^[a-z][a-z0-9_]{0,62}$/;
const actions=new Set<MarketingAuditAction>(['create','append','enqueue','schedule','pause','resume','cancel','redrive','archive','export','retention','finalize']);
export function createDatabaseMarketingAuditLog(db:CampaignDatabaseConnection,table='zerux_marketing_audit'){
  if(!db||typeof db.createTable!=='function'||typeof db.insert!=='function'||typeof db.select!=='function'||!tablePattern.test(table))throw new TypeError('Invalid marketing audit store');
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{
    const result=await db.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:48,primary:true,notNull:true},
      {name:'campaign_id',type:'varchar',length:96,notNull:true},
      {name:'payload_json',type:'text',notNull:true}
    ]});
    if(!result?.ok)throw new Error('Marketing audit table unavailable');
    if(db.createIndex)try{await db.createIndex({table,name:`${table.slice(0,40)}_campaign_idx`,columns:['campaign_id','id'],ifNotExists:true});}catch{/* Index optional. */}
  })().catch(error=>{ready=undefined;throw error;});
  const record=async(entry:{code:string;action:MarketingAuditAction;at:number;count?:number})=>{
    if(!entry||!codePattern.test(entry.code)||!actions.has(entry.action)||!Number.isSafeInteger(entry.at)||entry.at<0||
      entry.count!==undefined&&(!Number.isSafeInteger(entry.count)||entry.count<0))throw new TypeError('Invalid PII-free marketing audit metadata');
    const item:MarketingAuditRecord={id:`${String(entry.at).padStart(15,'0')}_${randomBytes(12).toString('hex')}`,
      code:entry.code,action:entry.action,at:entry.at,...(entry.count===undefined?{}:{count:entry.count})};
    await ensure();const result=await db.insert({table,values:{id:item.id,campaign_id:item.code,payload_json:JSON.stringify(item)}});
    if(!result?.ok)throw new Error('Marketing audit write failed');
    return structuredClone(item);
  };
  const page=async(code:string,{cursor=null,limit=100}:{cursor?:string|null;limit?:number}={})=>{
    if(!codePattern.test(code)||cursor!==null&&!/^\d{15}_[a-f0-9]{24}$/.test(cursor)||
      !Number.isSafeInteger(limit)||limit<1||limit>200)throw new TypeError('Invalid marketing audit page');
    await ensure();const clauses:any[]=[{field:'campaign_id',operator:'eq',value:code}];
    if(cursor)clauses.push({field:'id',operator:'gt',value:cursor});
    const result=await db.select({table,columns:['id','campaign_id','payload_json'],where:{and:clauses},
      orderBy:[{by:'id',direction:'asc'}],limit:limit+1});
    if(!result?.ok||!Array.isArray(result.rows)||result.rows.length>limit+1)throw new Error('Marketing audit page unavailable');
    const items=result.rows.slice(0,limit).map(raw=>{
      const r=raw as Record<string,unknown>,item=JSON.parse(String(r.payload_json)) as MarketingAuditRecord;
      if(item.id!==r.id||item.code!==code||!actions.has(item.action))throw new Error('Corrupt marketing audit row');
      return item;
    });
    const hasMore=result.rows.length>limit;
    return {items,nextCursor:hasMore?items.at(-1)!.id:null,done:!hasMore};
  };
  return {record,page};
}
