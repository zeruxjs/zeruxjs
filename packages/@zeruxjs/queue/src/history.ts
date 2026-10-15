/** Section 60: durable append-only journal of observed email state transitions.
 * The journal does not imply atomicity with the materialized delivery document. */
import {createHash} from 'node:crypto';
import type {DeliveryDatabase,CampaignDeliverySource} from './reporting.js';
import type {DurableEmailDeliveryRecord,DurableEmailDeliveryStore,EmailDeliveryState} from './delivery.js';

const tablePattern=/^[a-z][a-z0-9_]{0,62}$/;
const campaignPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const messagePattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const deliveryHistoryStates=['pending','claimed','sending','sent','suppressed','uncertain','rejected'] as const;
export interface EmailDeliveryTransition {
  messageId:string;campaignId:string;version:number;from:EmailDeliveryState|null;to:EmailDeliveryState;
  occurredAt:number;
}
export interface EmailDeliveryHistoryEntry extends EmailDeliveryTransition {id:string}
const validDate=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<8_640_000_000_000_000;
function validate(e:EmailDeliveryTransition){
  if(!e||!messagePattern.test(e.messageId)||!campaignPattern.test(e.campaignId)||!Number.isSafeInteger(e.version)||e.version<1||
    e.from!==null&&!deliveryHistoryStates.includes(e.from)||!deliveryHistoryStates.includes(e.to)||!validDate(e.occurredAt))throw new TypeError('Invalid delivery transition');
}
const eventKey=(e:EmailDeliveryTransition)=>createHash('sha256').update(e.messageId+'\0'+e.version).digest('hex');
export function createDatabaseEmailDeliveryHistory(db:DeliveryDatabase,table='zerux_email_delivery_history'){
  if(!db||!['createTable','insert','select'].every(k=>typeof (db as any)[k]==='function')||!tablePattern.test(table))throw new TypeError('Invalid history database');
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{
    const r=await db.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:64,primary:true,notNull:true},
      {name:'campaign_id',type:'varchar',length:96,notNull:true},
      {name:'message_id',type:'varchar',length:128,notNull:true},
      {name:'version',type:'bigint',notNull:true},
      {name:'from_state',type:'varchar',length:32},
      {name:'to_state',type:'varchar',length:32,notNull:true},
      {name:'occurred_at',type:'bigint',notNull:true}
    ]});
    if(!r?.ok)throw new Error('Delivery history table unavailable');
    if(db.createIndex){
      for(const [name,columns] of [['campaign_day_idx',['campaign_id','occurred_at']],['message_version_idx',['campaign_id','message_id','version']]] as const){
        try{await db.createIndex({table,name:`${table.slice(0,37)}_${name}`,columns:[...columns],ifNotExists:true});}catch{/* Optional index. */}
      }
    }
  })().catch(e=>{ready=undefined;throw e;});
  const columns=['id','campaign_id','message_id','version','from_state','to_state','occurred_at'];
  const decode=(raw:unknown):EmailDeliveryHistoryEntry=>{
    const row=raw as Record<string,unknown>;
    const entry:EmailDeliveryHistoryEntry={id:String(row.id),campaignId:String(row.campaign_id),messageId:String(row.message_id),
      version:Number(row.version),from:row.from_state===null||row.from_state===undefined?null:row.from_state as EmailDeliveryState,
      to:row.to_state as EmailDeliveryState,occurredAt:Number(row.occurred_at)};
    validate(entry);if(entry.id!==eventKey(entry))throw new Error('Invalid delivery history hash');return entry;
  };
  const equal=(a:EmailDeliveryHistoryEntry,b:EmailDeliveryHistoryEntry)=>a.messageId===b.messageId&&a.campaignId===b.campaignId&&a.version===b.version&&a.from===b.from&&a.to===b.to&&a.occurredAt===b.occurredAt;
  async function record(event:EmailDeliveryTransition):Promise<boolean>{
    validate(event);await ensure();const id=eventKey(event),candidate={...event,id};
    const lookup=async()=>{
      const r=await db.select({table,columns,where:{field:'id',operator:'eq',value:id},limit:1});
      if(!r?.ok||!Array.isArray(r.rows))throw new Error('Delivery history lookup failed');return r.rows.length?decode(r.rows[0]):null;
    };
    try{const r=await db.insert({table,values:{id,campaign_id:event.campaignId,message_id:event.messageId,version:event.version,
      from_state:event.from,to_state:event.to,occurred_at:event.occurredAt}});if(r?.ok)return true;}
    catch(error){const old=await lookup();if(!old)throw error;if(!equal(old,candidate))throw new Error('Conflicting delivery transition replay');return false;}
    const old=await lookup();if(old){if(!equal(old,candidate))throw new Error('Conflicting delivery transition replay');return false;}
    throw new Error('Delivery history insert unavailable');
  }
  /** Fetch last observed transition for an opaque durable message ID. */
  async function latest(campaignId:string,messageId:string):Promise<EmailDeliveryHistoryEntry|null>{
    if(!campaignPattern.test(campaignId)||!messagePattern.test(messageId))throw new TypeError('Invalid delivery history identity');
    await ensure();const r=await db.select({table,columns,where:{and:[{field:'campaign_id',operator:'eq',value:campaignId},
      {field:'message_id',operator:'eq',value:messageId}]},orderBy:[{by:'version',direction:'desc'}],limit:1});
    if(!r?.ok||!Array.isArray(r.rows)||r.rows.length>1)throw new Error('Delivery history latest lookup unavailable');
    const row=r.rows.length?decode(r.rows[0]):null;
    if(row&&(row.messageId!==messageId||row.campaignId!==campaignId))throw new Error('Out-of-scope history lookup');
    return row;
  }
  async function page(campaignId:string,{cursor=null,limit=100}:{cursor?:string|null;limit?:number}={}){
    if(!campaignPattern.test(campaignId)||cursor!==null&&!/^[a-f0-9]{64}$/.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid delivery history scan');
    await ensure();const clauses:any[]=[{field:'campaign_id',operator:'eq',value:campaignId}];
    if(cursor)clauses.push({field:'id',operator:'gt',value:cursor});
    const r=await db.select({table,columns,where:{and:clauses},orderBy:[{by:'id',direction:'asc'}],limit:limit+1});
    if(!r?.ok||!Array.isArray(r.rows)||r.rows.length>limit+1)throw new Error('Delivery history scan unavailable');
    const hasMore=r.rows.length>limit;
    const items=r.rows.slice(0,limit).map(decode);if(items.some(v=>v.campaignId!==campaignId||cursor!==null&&v.id<=cursor))throw new Error('Out of scope history row');
    return {events:items,nextCursor:hasMore?items.at(-1)!.id:null,done:!hasMore};
  }
  /** Verify the latest recorded transition matches each current durable delivery state.
   * A covered row does NOT prove that every intermediate transition was journaled.
   * Safe for multiple processes and never returns recipient, email or message IDs. */
  async function auditCurrent(campaignId:string,source:CampaignDeliverySource,options:{cursor?:string|null;limit?:number}={}){
    const cursor=options.cursor??null,limit=options.limit??100;
    if(!campaignPattern.test(campaignId)||cursor!==null&&!messagePattern.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>200||
      !source||typeof source.pageCampaign!=='function')throw new TypeError('Invalid delivery history audit');
    await ensure();
    const rows=await source.pageCampaign(campaignId,cursor,limit+1);
    if(!Array.isArray(rows)||rows.length>limit+1)throw new Error('Invalid durable delivery audit page');
    let covered=0,missing=0,stale=0;const selected=rows.slice(0,limit);
    let previous=cursor;
    for(const row of selected){
      if(!row||!messagePattern.test(row.id)||row.campaignId!==campaignId||previous!==null&&row.id<=previous||
        !deliveryHistoryStates.includes(row.state))throw new Error('Out of scope or unordered delivery audit row');
      previous=row.id;
      const result=await db.select({table,columns,where:{and:[{field:'campaign_id',operator:'eq',value:campaignId},{field:'message_id',operator:'eq',value:row.id}]},
        orderBy:[{by:'version',direction:'desc'}],limit:1});
      if(!result?.ok||!Array.isArray(result.rows)||result.rows.length>1)throw new Error('History audit lookup unavailable');
      if(!result.rows.length){missing++;continue;}
      const last=decode(result.rows[0]);
      if(last.messageId!==row.id||last.campaignId!==campaignId)throw new Error('Out of scope history audit row');
      // Metadata-only version increments do not create history transitions.
      // Matching states indicate latest-state coverage, not full version coverage.
      if(last.to===row.state)covered++;else stale++;
    }
    const hasMore=rows.length>limit;
    return {campaignId,checked:selected.length,covered,missing,stale,complete:!hasMore,
      nextCursor:hasMore?selected.at(-1)!.id:null,
      coverage:'latest-observed-state-only' as const,snapshotConsistent:false as const};
  }
  async function trends(campaignId:string,from:string,to:string){
    if(!campaignPattern.test(campaignId)||!/\d{4}-\d{2}-\d{2}/.test(from)||!/\d{4}-\d{2}-\d{2}/.test(to))throw new TypeError('Invalid history trend range');
    const parse=(s:string)=>{const t=Date.parse(s+'T00:00:00.000Z');if(!validDate(t)||new Date(t).toISOString().slice(0,10)!==s)throw new TypeError('Invalid UTC day');return t;};
    const start=parse(from),end=parse(to);if(end<start||(end-start)/86_400_000>91)throw new RangeError('History report limited to 92 days');
    await ensure();const days:{day:string;counts:Record<EmailDeliveryState,number>;total:number}[]=[];
    for(let t=start;t<=end;t+=86_400_000){
      const r=await db.select({table,columns:[{expr:{kind:'column',name:'to_state'},as:'state'},
        {expr:{kind:'function',name:'COUNT',args:[{kind:'column',name:'id'}]},as:'event_count'}],
        where:{and:[{field:'campaign_id',operator:'eq',value:campaignId},{field:'occurred_at',operator:'gte',value:t},{field:'occurred_at',operator:'lt',value:t+86_400_000}]},
        groupBy:['to_state'],limit:deliveryHistoryStates.length+1});
      if(!r?.ok||!Array.isArray(r.rows)||r.rows.length>deliveryHistoryStates.length)throw new Error('History aggregation unavailable');
      const counts=Object.fromEntries(deliveryHistoryStates.map(v=>[v,0])) as Record<EmailDeliveryState,number>;
      const seen=new Set<string>();
      for(const raw of r.rows){const row=raw as Record<string,unknown>,key=row.state;
        const n=typeof row.event_count==='string'&&/^\d+$/.test(row.event_count)?Number(row.event_count):row.event_count;
        if(typeof key!=='string'||!deliveryHistoryStates.includes(key as EmailDeliveryState)||seen.has(key)||typeof n!=='number'||!Number.isSafeInteger(n)||n<1)throw new Error('Invalid history aggregate');
        seen.add(key);counts[key as EmailDeliveryState]=n;
      }
      days.push({day:new Date(t).toISOString().slice(0,10),counts,total:Object.values(counts).reduce((sum,n)=>sum+n,0)});
    }
    return {campaignId,from,to,days,coverage:'recorded-transitions-only' as const,snapshotConsistent:false as const};
  }
  return {record,page,latest,trends,auditCurrent};
}
/** Record successful CAS updates once per immutable record version. A non-transactional
 * DB can commit the state before the history insert; missing versions need reconciliation.
 * The wrapper throws on a failed journal write rather than silently claiming completeness. */
export function createJournaledEmailDeliveryStore<T extends DurableEmailDeliveryStore & {create?:(row:DurableEmailDeliveryRecord)=>Promise<boolean>}>(
  store:T,history:{record:(event:EmailDeliveryTransition)=>Promise<boolean>},now:()=>number=Date.now){
  if(!store||typeof store.load!=='function'||typeof store.save!=='function'||typeof history?.record!=='function')throw new TypeError('Journaled delivery store requires persistence and history');
  return {
    load:(id:string)=>store.load(id),
    async create(row:DurableEmailDeliveryRecord){
      if(!store.create)throw new Error('Delivery store does not support inserts');
      const inserted=await store.create(row);
      if(inserted&&row.campaignId)await history.record({messageId:row.id,campaignId:row.campaignId,version:row.version,from:null,to:row.state,occurredAt:row.updatedAt});
      return inserted;
    },
    async save(id:string,next:DurableEmailDeliveryRecord,expectedVersion:number){
      const old=await store.load(id);
      if(!old||old.version!==expectedVersion)return false;
      const saved=await store.save(id,next,expectedVersion);
      if(saved&&next.campaignId&&old.state!==next.state)await history.record({messageId:next.id,campaignId:next.campaignId,
        version:next.version,from:old.state,to:next.state,occurredAt:next.updatedAt??now()});
      return saved;
    }
  };
}
