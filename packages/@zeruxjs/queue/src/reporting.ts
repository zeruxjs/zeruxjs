/** Durable campaign delivery reporting. PII and raw queue payloads never leave this module. */
import type {DurableEmailDeliveryRecord,DurableEmailDeliveryStore,EmailDeliveryState} from './delivery.js';

const campaignPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const messagePattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const states:readonly EmailDeliveryState[]=['pending','claimed','sending','sent','suppressed','uncertain','rejected'];
const validTime=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=8_640_000_000_000_000;
const validRecord=(record:DurableEmailDeliveryRecord)=>record&&messagePattern.test(record.id)&&
  Number.isSafeInteger(record.version)&&record.version>=1&&states.includes(record.state)&&
  ['marketing','transactional'].includes(record.purpose)&&validTime(record.updatedAt)&&
  (record.campaignId===undefined||campaignPattern.test(record.campaignId))&&
  (record.attemptedAt===undefined||validTime(record.attemptedAt))&&
  (record.completedAt===undefined||validTime(record.completedAt));

export interface CampaignDeliveryRow {
  /** Internal cursor and optional activity lookup key. NEVER return from HTTP dashboards. */
  id:string;
  campaignId:string;
  version?:number;
  state:EmailDeliveryState;
  updatedAt:number;
  attemptedAt?:number;
  completedAt?:number;
}
export interface CampaignDeliverySource {
  pageCampaign(campaignId:string,cursor:string|null,limit:number):Promise<CampaignDeliveryRow[]>;
}
export interface DeliveryDatabase {
  createTable(input:any):Promise<{ok:boolean}>|{ok:boolean};
  insert(input:any):Promise<{ok:boolean}>|{ok:boolean};
  select(input:any):Promise<{ok:boolean;rows?:unknown[]}>|{ok:boolean;rows?:unknown[]};
  update(input:any):Promise<{ok:boolean;affectedCount?:number;rowCount?:number}>|{ok:boolean;affectedCount?:number;rowCount?:number};
  createIndex?(input:any):Promise<{ok:boolean}>|{ok:boolean};
}

/**
 * Portable SQL/Mongo document store. CAS (affectedCount) is required for any update.
 * Shared durable storage and stable message IDs are prerequisites for multiple workers.
 */
export function createDatabaseEmailDeliveryStore(db:DeliveryDatabase,table='zerux_email_delivery'):
  DurableEmailDeliveryStore & CampaignDeliverySource & {create(record:DurableEmailDeliveryRecord):Promise<boolean>}{
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(table))throw new TypeError('Invalid delivery table');
  if(!db||typeof db.createTable!=='function'||typeof db.select!=='function'||typeof db.update!=='function'||typeof db.insert!=='function')throw new TypeError('Invalid delivery database');
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{
    const r=await db.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:128,primary:true,notNull:true},
      {name:'version',type:'bigint',notNull:true},
      {name:'campaign_id',type:'varchar',length:96},
      {name:'state',type:'varchar',length:32,notNull:true},
      {name:'updated_at',type:'bigint',notNull:true},
      {name:'payload_json',type:'text',notNull:true}
    ]});if(!r?.ok)throw new Error('Email delivery table unavailable');
    // Optional index creation is a performance optimization, never a correctness dependency.
    if(db.createIndex){
      for(const [suffix,columns] of [['campaign_idx',['campaign_id','id']],['campaign_day_idx',['campaign_id','updated_at']]] as const){
        try{await db.createIndex({table,name:`${table.slice(0,40)}_${suffix}`,columns:[...columns],ifNotExists:true});}
        catch{/* optional performance indexes: correctness never depends on their creation */}
      }
    }
  })().catch(e=>{ready=undefined;throw e;});
  const encode=(v:DurableEmailDeliveryRecord)=>{
    if(!validRecord(v))throw new TypeError('Invalid durable delivery record');
    const text=JSON.stringify(v);
    if(Buffer.byteLength(text,'utf8')>60_000)throw new RangeError('Email delivery record exceeds portable TEXT limit');
    return text;
  };
  const decode=(row:unknown):DurableEmailDeliveryRecord=>{
    const item=row as Record<string,unknown>;
    if(!item||typeof item.payload_json!=='string')throw new Error('Corrupt delivery document');
    const v=JSON.parse(item.payload_json) as DurableEmailDeliveryRecord;
    if(!validRecord(v)||v.id!==item.id||v.version!==Number(item.version)||v.state!==item.state||
      (v.campaignId??null)!==(item.campaign_id??null)||v.updatedAt!==Number(item.updated_at))throw new Error('Delivery document/index mismatch');
    return v;
  };
  const columns=['id','version','campaign_id','state','updated_at','payload_json'];
  const load=async(id:string)=>{
    if(!messagePattern.test(id))throw new TypeError('Invalid message ID');
    await ensure();
    const r=await db.select({table,columns,where:{field:'id',operator:'eq',value:id},limit:1});
    if(!r?.ok||!Array.isArray(r.rows))throw new Error('Email delivery lookup failed');
    return r.rows.length?decode(r.rows[0]):null;
  };
  return {
    load,
    async create(v){
      if(v.version!==1)throw new TypeError('New delivery records must start at version 1');
      const payload=encode(v);await ensure();
      try{const r=await db.insert({table,values:{id:v.id,version:v.version,campaign_id:v.campaignId??null,state:v.state,updated_at:v.updatedAt,payload_json:payload}});if(r?.ok)return true;}
      catch(e){if(await load(v.id))return false;throw e;}
      if(await load(v.id))return false;
      throw new Error('Email delivery insert failed');
    },
    async save(id,next,expected){
      if(!messagePattern.test(id)||id!==next.id||!Number.isSafeInteger(expected)||expected<1||next.version!==expected+1)throw new TypeError('Invalid delivery version update');
      const payload=encode(next);await ensure();
      const previous=await load(id);
      if(!previous||previous.version!==expected)return false;
      // Immutable routing identity: prevent malicious or accidental cross-campaign moves
      // even while CAS protects against concurrent worker races.
      if(previous.campaignId!==next.campaignId||previous.purpose!==next.purpose||previous.recipient!==next.recipient)
        throw new Error('Cannot change durable message routing identity');
      const r=await db.update({table,values:{version:next.version,campaign_id:next.campaignId??null,state:next.state,updated_at:next.updatedAt,payload_json:payload},where:{and:[{field:'id',operator:'eq',value:id},{field:'version',operator:'eq',value:expected}]}});
      if(!r?.ok)throw new Error('Email delivery update failed');
      const affected=r.affectedCount??r.rowCount;
      if(typeof affected!=='number'||!Number.isSafeInteger(affected)||affected<0||affected>1)throw new Error('Email delivery CAS requires atomic affectedCount');
      return affected===1;
    },
    async pageCampaign(campaignId,cursor,limit){
      if(!campaignPattern.test(campaignId)||cursor!==null&&!messagePattern.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid campaign scan');
      await ensure();
      const terms:any[]=[{field:'campaign_id',operator:'eq',value:campaignId}];
      if(cursor!==null)terms.push({field:'id',operator:'gt',value:cursor});
      const r=await db.select({table,columns,where:{and:terms},orderBy:[{by:'id',direction:'asc'}],limit});
      if(!r?.ok||!Array.isArray(r.rows)||r.rows.length>limit)throw new Error('Email delivery campaign query failed');
      return r.rows.map(raw=>{
        const v=decode(raw);
        if(v.campaignId!==campaignId||(cursor!==null&&v.id<=cursor))throw new Error('Campaign query returned out-of-scope data');
        return {id:v.id,campaignId,version:v.version,state:v.state,updatedAt:v.updatedAt,attemptedAt:v.attemptedAt,completedAt:v.completedAt};
      });
    }
  };
}

export interface CampaignDeliveryReport {
  campaignId:string;
  /** Complete only if the scan reached the end. Partial results are not exact totals. */
  complete:boolean;
  scanned:number;
  counts:Record<EmailDeliveryState,number>;
  /** UTC-day grouping uses completedAt (or updatedAt for unfinished jobs). */
  days:{day:string;sent:number;suppressed:number;uncertain:number;other:number}[];
  /** Rates reflect durable SMTP state, NOT mailbox delivery or inbox placement. */
  sentPercent:number|null;
  /** Never contains recipients or message IDs. */
  activity:null|{summariesAvailable:number;opens:number;uniqueOpens:number;clicks:number;uniqueClicks:number;downloadClicks:number;downloads:number;downloadedBytes:number;coverage:'available-summaries-only'};
}
export interface CampaignActivityRead {get(id:string):Promise<{opens:number;clicks:number;downloadClicks:number;downloads:number;downloadedBytes:number}|null>}

/** Scans a bounded number of durable deliveries. Exact only when complete=true. */
export function createCampaignDeliveryReporter(options:{source:CampaignDeliverySource;activity?:CampaignActivityRead;maxRecords?:number;pageSize?:number}){
  if(!options?.source||typeof options.source.pageCampaign!=='function')throw new TypeError('Delivery report source required');
  const max=options.maxRecords??10_000,pageSize=options.pageSize??200;
  if(!Number.isSafeInteger(max)||max<1||max>100_000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>500)throw new RangeError('Invalid campaign report bounds');
  return async function report(campaignId:string):Promise<CampaignDeliveryReport>{
    if(!campaignPattern.test(campaignId))throw new TypeError('Invalid campaign ID');
    const counts=Object.fromEntries(states.map(state=>[state,0])) as Record<EmailDeliveryState,number>;
    const days=new Map<string,{day:string;sent:number;suppressed:number;uncertain:number;other:number}>();
    const activity:CampaignDeliveryReport['activity']=options.activity?{summariesAvailable:0,opens:0,uniqueOpens:0,clicks:0,uniqueClicks:0,downloadClicks:0,downloads:0,downloadedBytes:0,coverage:'available-summaries-only'}:null;
    let cursor:string|null=null,scanned=0,complete=false;
    while(scanned<max){
      const limit=Math.min(pageSize,max-scanned);
      const page=await options.source.pageCampaign(campaignId,cursor,limit);
      if(!Array.isArray(page)||page.length>limit)throw new Error('Invalid campaign report page');
      if(!page.length){complete=true;break;}
      for(const row of page){
        if(!row||!messagePattern.test(row.id)||row.campaignId!==campaignId||cursor!==null&&row.id<=cursor||!states.includes(row.state)||!validTime(row.updatedAt)||
          row.completedAt!==undefined&&!validTime(row.completedAt))throw new Error('Invalid or unordered campaign report row');
        cursor=row.id;counts[row.state]++;scanned++;
        const day=new Date(row.completedAt??row.updatedAt).toISOString().slice(0,10);
        let group=days.get(day);
        if(!group){group={day,sent:0,suppressed:0,uncertain:0,other:0};days.set(day,group);}
        const category=row.state==='sent'||row.state==='suppressed'||row.state==='uncertain'?row.state:'other';group[category]++;
        if(activity){
          const a=await options.activity!.get(row.id);
          if(a!==null){
            if(!a||![a.opens,a.clicks,a.downloadClicks,a.downloads,a.downloadedBytes].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('Invalid activity summary');
            activity.summariesAvailable++;activity.opens+=a.opens;activity.clicks+=a.clicks;
            activity.uniqueOpens+=Number(a.opens>0);activity.uniqueClicks+=Number(a.clicks>0);
            activity.downloadClicks+=a.downloadClicks;activity.downloads+=a.downloads;activity.downloadedBytes+=a.downloadedBytes;
          }
        }
      }
      if(page.length<limit){complete=true;break;}
    }
    // Exactly maxRecords may also be the exact end. Probe one extra row rather than
    // labelling a complete report as truncated or implying incomplete data are exact.
    if(!complete&&scanned===max){
      const extra=await options.source.pageCampaign(campaignId,cursor,1);
      if(!Array.isArray(extra)||extra.length>1||extra.some(r=>!r||r.campaignId!==campaignId||!messagePattern.test(r.id)||r.id<=cursor!))throw new Error('Invalid campaign report continuation');
      complete=extra.length===0;
    }
    return {campaignId,complete,scanned,counts,days:[...days.values()].sort((a,b)=>a.day.localeCompare(b.day)),
      sentPercent:complete&&scanned>0?100*counts.sent/scanned:null,activity};
  };
}
