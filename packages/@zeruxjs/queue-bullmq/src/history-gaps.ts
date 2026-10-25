/** Append-only *observations* of missing/stale delivery history. This ledger NEVER
 * backdates or invents transitions: it records a snapshot discrepancy separately. */
import {createHash} from 'node:crypto';
import type {CampaignDeliverySource,DeliveryDatabase} from './reporting.js';
import type {EmailDeliveryHistoryEntry} from './history.js';
import type {EmailDeliveryState} from './delivery.js';

const campaignPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const msgPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const states=['pending','claimed','sending','sent','suppressed','uncertain','rejected'] as const;
export interface DeliveryHistoryGap {
  id:string;campaignId:string;messageId:string;deliveryVersion:number;
  currentState:EmailDeliveryState;lastRecordedVersion:number|null;
  lastRecordedState:EmailDeliveryState|null;kind:'missing'|'stale';observedAt:number;
}
export function createDatabaseDeliveryHistoryGapLedger(db:DeliveryDatabase,table='zerux_email_history_gaps'){
  if(!db||!['createTable','insert','select'].every(k=>typeof (db as any)[k]==='function')||
    !/^[a-z][a-z0-9_]{0,62}$/.test(table))throw new TypeError('Invalid history gap store');
  let initialized:Promise<void>|undefined;
  const ensure=()=>initialized??=(async()=>{
    const r=await db.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:64,primary:true,notNull:true},
      {name:'campaign_id',type:'varchar',length:96,notNull:true},
      {name:'message_id',type:'varchar',length:128,notNull:true},
      {name:'version',type:'bigint',notNull:true},
      {name:'payload_json',type:'text',notNull:true}
    ]});if(!r?.ok)throw new Error('History discrepancy ledger unavailable');
    if(db.createIndex)try{await db.createIndex({table,name:`${table.slice(0,39)}_campaign_idx`,columns:['campaign_id','id'],ifNotExists:true});}catch{/* optional */}
  })().catch(e=>{initialized=undefined;throw e;});
  const read=async(id:string):Promise<DeliveryHistoryGap|null>=>{
    await ensure();const r=await db.select({table,columns:['id','campaign_id','message_id','version','payload_json'],where:{field:'id',operator:'eq',value:id},limit:1});
    if(!r?.ok||!Array.isArray(r.rows))throw new Error('History gap lookup unavailable');
    if(!r.rows.length)return null;
    const row=r.rows[0] as Record<string,unknown>;
    const v=JSON.parse(String(row.payload_json)) as DeliveryHistoryGap;
    if(v.id!==id||v.messageId!==row.message_id||v.campaignId!==row.campaign_id||v.deliveryVersion!==Number(row.version))throw new Error('Corrupt history gap');
    return v;
  };
  return {
    async record(value:Omit<DeliveryHistoryGap,'id'|'observedAt'>,observedAt=Date.now()){
      if(!campaignPattern.test(value.campaignId)||!msgPattern.test(value.messageId)||
        !Number.isSafeInteger(value.deliveryVersion)||value.deliveryVersion<1||
        !['missing','stale'].includes(value.kind)||!states.includes(value.currentState)||
        value.lastRecordedState!==null&&!states.includes(value.lastRecordedState)||
        value.lastRecordedVersion!==null&&(!Number.isSafeInteger(value.lastRecordedVersion)||value.lastRecordedVersion<1)||
        !Number.isSafeInteger(observedAt)||observedAt<0)throw new TypeError('Invalid history observation');
      const id=createHash('sha256').update(value.campaignId+'\0'+value.messageId+'\0'+value.deliveryVersion).digest('hex');
      const entry:DeliveryHistoryGap={...value,id,observedAt};
      await ensure();
      const equivalent=(existing:DeliveryHistoryGap)=>{
        const {observedAt:a,...one}=existing,{observedAt:b,...two}=entry;
        if(JSON.stringify(one)!==JSON.stringify(two))throw new Error('Conflicting history observation for delivery version');
      };
      try{const r=await db.insert({table,values:{id,campaign_id:value.campaignId,message_id:value.messageId,version:value.deliveryVersion,payload_json:JSON.stringify(entry)}});
        if(r?.ok)return true;
      }catch(error){const existing=await read(id);if(!existing)throw error;equivalent(existing);return false;}
      const existing=await read(id);if(existing){equivalent(existing);return false;}
      throw new Error('History gap insertion unavailable');
    },
    async page(campaignId:string,{cursor=null,limit=100}:{cursor?:string|null;limit?:number}={}){
      if(!campaignPattern.test(campaignId)||cursor!==null&&!/^[a-f0-9]{64}$/.test(cursor)||
        !Number.isSafeInteger(limit)||limit<1||limit>200)throw new TypeError('Invalid gap scan');
      await ensure();const where:any[]=[{field:'campaign_id',operator:'eq',value:campaignId}];
      if(cursor)where.push({field:'id',operator:'gt',value:cursor});
      const r=await db.select({table,columns:['id','campaign_id','message_id','version','payload_json'],where:{and:where},orderBy:[{by:'id',direction:'asc'}],limit:limit+1});
      if(!r?.ok||!Array.isArray(r.rows)||r.rows.length>limit+1)throw new Error('History gap scan unavailable');
      const more=r.rows.length>limit,rows=r.rows.slice(0,limit) as Record<string,unknown>[];
      for(const row of rows){if(row.campaign_id!==campaignId)throw new Error('Out of scope gap row');}
      return {entries:rows.map(row=>JSON.parse(String(row.payload_json)) as DeliveryHistoryGap),
        nextCursor:more?String(rows.at(-1)!.id):null,done:!more};
    }
  };
}
/** Bounded audit. No PII in public summary; observations remain internal and require trusted access. */
export function createDeliveryHistoryGapScanner(options:{
  source:CampaignDeliverySource;
  history:{latest(campaignId:string,messageId:string):Promise<EmailDeliveryHistoryEntry|null>};
  ledger:ReturnType<typeof createDatabaseDeliveryHistoryGapLedger>;
  now?:()=>number;
}){
  if(!options?.source?.pageCampaign||!options.history?.latest||!options.ledger?.record)throw new TypeError('Invalid history scanner');
  return async function scan(campaignId:string,{cursor=null,limit=100}:{cursor?:string|null;limit?:number}={}){
    if(!campaignPattern.test(campaignId)||cursor!==null&&!msgPattern.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>200)
      throw new TypeError('Invalid history scan bounds');
    const rows=await options.source.pageCampaign(campaignId,cursor,limit+1);
    if(!Array.isArray(rows)||rows.length>limit+1)throw new Error('Invalid history scan page');
    let covered=0,missing=0,stale=0,observationsCreated=0,previous=cursor;
    const selected=rows.slice(0,limit);
    for(const row of selected){
      if(!row||!msgPattern.test(row.id)||row.campaignId!==campaignId||previous!==null&&row.id<=previous||
        !Number.isSafeInteger(row.version)||row.version!<1||!states.includes(row.state))throw new Error('History scanner requires versioned ordered delivery rows');
      previous=row.id;
      const last=await options.history.latest(campaignId,row.id);
      if(last&&last.version===row.version&&last.to===row.state){covered++;continue;}
      const kind=last?'stale':'missing';if(kind==='missing')missing++;else stale++;
      if(await options.ledger.record({campaignId,messageId:row.id,deliveryVersion:row.version!,currentState:row.state,
        lastRecordedVersion:last?.version??null,lastRecordedState:last?.to??null,kind},(options.now??Date.now)()))observationsCreated++;
    }
    const more=rows.length>limit;
    return {campaignId,checked:selected.length,covered,missing,stale,observationsCreated,
      nextCursor:more?selected.at(-1)!.id:null,done:!more,
      coverage:'nontransactional-observed-discrepancies' as const,snapshotConsistent:false as const};
  };
}
