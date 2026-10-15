/** Function-first marketing campaigns. One durable template, individually stored recipients,
 * stable queue message IDs, and delivery-time variable rendering. No HTML copies per recipient. */
import {createHash,randomBytes} from 'node:crypto';
import {validateEmailAddress,addressString} from './validation.js';
import {interpolateTemplate} from './templates.js';
import type {CampaignDatabaseConnection} from './campaign-storage.js';
import type {EmailMessage,EmailResult} from './types.js';

const validCode=(s:unknown):s is string=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(s);
const validTable=(s:string)=>/^[a-z][a-z0-9_]{0,62}$/.test(s);
const clone=<T>(v:T):T=>structuredClone(v);
const plain=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const canonical=(email:string)=>addressString(validateEmailAddress(email)).trim().toLowerCase();
const emailId=(code:string,email:string)=>'cmp_'+createHash('sha256').update(code+'\0'+email).digest('hex').slice(0,40);
const jsonData=(value:unknown,maxBytes:number)=>{
  if(!plain(value))throw new TypeError('Campaign dynamic data must be a JSON object');
  // Validate the original input, before JSON serialization can silently drop functions/undefined.
  const inspect=(v:unknown,depth=0):void=>{
    if(depth>8)throw new RangeError('Campaign JSON nesting too deep');
    if(Array.isArray(v)){for(const x of v)inspect(x,depth+1);return;}
    if(plain(v)){for(const [key,item] of Object.entries(v)){
      if(['__proto__','prototype','constructor'].includes(key))throw new TypeError('Forbidden dynamic data key');
      inspect(item,depth+1);
    }return;}
    if(v!==null&&typeof v!=='string'&&typeof v!=='boolean'&&!(typeof v==='number'&&Number.isFinite(v)))throw new TypeError('Invalid JSON value');
  };
  inspect(value);
  const string=JSON.stringify(value);
  if(typeof string!=='string'||Buffer.byteLength(string)>maxBytes)throw new RangeError('Campaign JSON data too large');
  const parsed=JSON.parse(string) as Record<string,unknown>;
  return parsed;
};
export interface MarketingRecipient {email:string;name?:string;data?:Record<string,unknown>}
export interface MarketingCampaignInput {
  name:string;subject:string;html?:string;text?:string;
  /** Convenient content shorthand; choose HTML (default) or plain text. */
  content?:string;contentType?:'html'|'text';
  /** Configured EmailManager account names (SMTP password, OAuth2 or custom transport). */
  account?:string;providers?:string[];
  /** Campaign-level JSON variables; overridden by recipient variables. */
  data?:Record<string,unknown>;
  recipients?:(string|MarketingRecipient)[];
  /** Alias for recipients, useful for one-call campaign creation. */
  emails?:(string|MarketingRecipient)[];
  isTracking?:boolean|NonNullable<EmailMessage['tracking']>;
  sendAt?:number;
  /** When false, store the campaign and recipients but leave delivery enqueueing to enqueue(). */
  autoEnqueue?:boolean;
}
export interface StoredMarketingCampaign {
  code:string;name:string;subject:string;html?:string;text?:string;providers:string[];
  data:Record<string,unknown>;tracking:NonNullable<EmailMessage['tracking']>;
  sendAt:number;status:'building'|'ready'|'queue_failed'|'paused'|'cancelled';
  version:number;createdAt:number;updatedAt:number;recipientCount:number;
}
export interface StoredMarketingRecipient {
  id:string;campaignCode:string;email:string;name:string;data:Record<string,unknown>;
  enqueuedAt:number|null;
}
export interface MarketingQueue {
  add(name:string,data:{messageId:string},options:{jobId:string;delay:number;attempts:number}):Promise<unknown>;
}
export interface MarketingDeliveryStore {
  create(record:{id:string;version:1;purpose:'marketing';recipient:string;campaignId:string;
    state:'pending';lease:null;updatedAt:number}):Promise<boolean>;
  load(id:string):Promise<{id:string;state:string;campaignId?:string;recipient?:string}|null>;
}
export interface MarketingRenderer {
  render(template:string,context:Readonly<Record<string,unknown>>,options?:{escape?:'text'|'html';missing?:'empty'|'keep'|'error'}):Promise<string>|string;
}
export interface MarketingCampaignServiceOptions {
  db:CampaignDatabaseConnection;queue:MarketingQueue;delivery:MarketingDeliveryStore;
  /** Pass zeruxjs createVariableRegistry() instance to support registered functions everywhere. */
  renderer?:MarketingRenderer;
  /** Trusted application authorization. The service is server-side and should never be exposed unauthenticated. */
  authorize?:(action:'create'|'read'|'enqueue'|'cancel'|'render'|'append'|'pause'|'resume'|'redrive',code?:string)=>Promise<boolean>|boolean;
  onQueueError?:(code:string,error:unknown)=>void|Promise<void>;
  /** Optional validation against configured EmailManager account names at creation. */
  verifyProvider?:(account:string)=>boolean|Promise<boolean>;
  /** Best-effort, PII-free operational audit. Errors never replay queue/SMTP actions. */
  onAudit?:(entry:{code:string;action:'create'|'append'|'enqueue'|'pause'|'resume'|'cancel'|'redrive';at:number;count?:number})=>void|Promise<void>;
  table?:string;recipientTable?:string;now?:()=>number;
}
export function createMarketingCampaignService(options:MarketingCampaignServiceOptions){
  const {db,queue,delivery}=options??{} as MarketingCampaignServiceOptions;
  if(!db||!['createTable','insert','select','update'].every(key=>typeof (db as any)[key]==='function')||
    typeof queue?.add!=='function'||typeof delivery?.create!=='function'||typeof delivery?.load!=='function')
    throw new TypeError('Marketing campaigns require DB, queue and durable delivery store');
  const table=options.table??'zerux_marketing_campaigns';
  const recipientTable=options.recipientTable??'zerux_marketing_recipients';
  if(!validTable(table)||!validTable(recipientTable)||table===recipientTable)throw new TypeError('Invalid campaign tables');
  const clock=options.now??Date.now;
  const now=()=>{const v=clock();if(!Number.isSafeInteger(v)||v<0)throw new Error('Invalid campaign clock');return v;};
  const audit=async(code:string,action:'create'|'append'|'enqueue'|'pause'|'resume'|'cancel'|'redrive',count?:number)=>{
    try{await options.onAudit?.({code,action,at:now(),...(count===undefined?{}:{count})});}catch{/* no side-effect replay */}
  };
  const authorize=async(action:'create'|'read'|'enqueue'|'cancel'|'render'|'append'|'pause'|'resume'|'redrive',code?:string)=>{
    if(options.authorize&&await options.authorize(action,code)!==true)throw Object.assign(new Error('Campaign access denied'),{code:'CAMPAIGN_FORBIDDEN'});
  };
  let initialization:Promise<void>|undefined;
  const ensure=()=>initialization??=(async()=>{
    for(const [name,columns] of [
      [table,[{name:'id',type:'varchar',length:96,primary:true,notNull:true},{name:'version',type:'bigint',notNull:true},{name:'created_at',type:'bigint',notNull:true},{name:'payload_json',type:'text',notNull:true}]],
      [recipientTable,[{name:'id',type:'varchar',length:64,primary:true,notNull:true},{name:'campaign_id',type:'varchar',length:96,notNull:true},{name:'enqueued_at',type:'bigint'},{name:'payload_json',type:'text',notNull:true}]]
    ] as const){
      const result=await db.createTable({table:name,ifNotExists:true,columns});
      if(!result?.ok)throw new Error('Campaign database initialization failed');
    }
    // Cover both paginated recipient reads and durable enqueue-checkpoint recovery.
    // Index failures are non-fatal; they affect performance, not correctness.
    if(db.createIndex){for(const [suffix,columns] of [
      ['campaign_cursor_idx',['campaign_id','id']],['campaign_queue_idx',['campaign_id','enqueued_at']]
    ] as const){try{await db.createIndex({table:recipientTable,name:`${recipientTable.slice(0,36)}_${suffix}`,
      columns:[...columns],ifNotExists:true});}catch{/* optional */}}}
  })().catch(error=>{initialization=undefined;throw error;});
  const encode=(value:unknown,max=60_000)=>{
    const text=JSON.stringify(value);if(typeof text!=='string'||Buffer.byteLength(text)>max)throw new RangeError('Campaign record exceeds portable TEXT size');return text;
  };
  const readCampaign=async(code:string):Promise<StoredMarketingCampaign|null>=>{
    if(!validCode(code))throw new TypeError('Invalid campaign code');
    await ensure();const result=await db.select({table,columns:['id','version','payload_json'],where:{field:'id',operator:'eq',value:code},limit:1});
    if(!result?.ok||!Array.isArray(result.rows))throw new Error('Campaign database read failed');
    if(!result.rows.length)return null;
    const row=result.rows[0] as Record<string,unknown>;
    const campaign=JSON.parse(String(row.payload_json)) as StoredMarketingCampaign;
    if(campaign.code!==code||campaign.version!==Number(row.version))throw new Error('Corrupt campaign record');
    return campaign;
  };
  const requireCampaign=async(code:string)=>{
    const item=await readCampaign(code);if(!item)throw new Error('Campaign not found');return item;
  };
  const updateCampaign=async(code:string,edit:(v:StoredMarketingCampaign)=>StoredMarketingCampaign)=>{
    for(let attempt=0;attempt<20;attempt++){
      const current=await requireCampaign(code),next=edit(clone(current));
      if(next.code!==code||next.version!==current.version+1)throw new Error('Invalid campaign transition');
      next.updatedAt=now();
      const result=await db.update({table,values:{version:next.version,payload_json:encode(next)},where:{and:[{field:'id',operator:'eq',value:code},{field:'version',operator:'eq',value:current.version}]}});
      if(!result?.ok)throw new Error('Campaign checkpoint failed');
      const changed=result.affectedCount??result.rowCount;
      if(typeof changed!=='number'||!Number.isSafeInteger(changed)||changed<0||changed>1)throw new Error('Campaign CAS unavailable');
      if(changed===1)return next;
    }
    throw new Error('Concurrent campaign checkpoint contention');
  };
  const countRecipients=async(code:string,onlyUnqueued=false):Promise<number>=>{
    await ensure();const clauses:any[]=[{field:'campaign_id',operator:'eq',value:code}];
    if(onlyUnqueued)clauses.push({field:'enqueued_at',operator:'isNull'});
    const result=await db.select({table:recipientTable,
      columns:[{expr:{kind:'function',name:'COUNT',args:[{kind:'column',name:'id'}]},as:'total'}],
      where:{and:clauses},limit:1});
    if(!result?.ok||!Array.isArray(result.rows)||result.rows.length!==1)throw new Error('Campaign recipient count unavailable');
    const raw=(result.rows[0] as Record<string,unknown>).total;
    const value=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw;
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Invalid campaign recipient count');
    return value;
  };
  const readRecipient=async(id:string):Promise<StoredMarketingRecipient|null>=>{
    if(!/^cmp_[a-f0-9]{40}$/.test(id))throw new TypeError('Invalid marketing message ID');
    await ensure();const result=await db.select({table:recipientTable,columns:['id','campaign_id','enqueued_at','payload_json'],where:{field:'id',operator:'eq',value:id},limit:1});
    if(!result?.ok||!Array.isArray(result.rows))throw new Error('Recipient lookup failed');
    if(!result.rows.length)return null;
    const row=result.rows[0] as Record<string,unknown>,value=JSON.parse(String(row.payload_json)) as StoredMarketingRecipient;
    if(value.id!==id||value.campaignCode!==row.campaign_id||value.enqueuedAt!==(row.enqueued_at===null||row.enqueued_at===undefined?null:Number(row.enqueued_at)))throw new Error('Corrupt recipient record');
    return value;
  };
  const pageRecipients=async(code:string,cursor:string|null,limit:number):Promise<{items:StoredMarketingRecipient[];nextCursor:string|null;done:boolean}>=>{
    if(!validCode(code)||cursor!==null&&!/^cmp_[a-f0-9]{40}$/.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new TypeError('Invalid campaign pagination');
    await ensure();const clauses:any[]=[{field:'campaign_id',operator:'eq',value:code}];
    if(cursor)clauses.push({field:'id',operator:'gt',value:cursor});
    const result=await db.select({table:recipientTable,columns:['id','campaign_id','enqueued_at','payload_json'],where:{and:clauses},orderBy:[{by:'id',direction:'asc'}],limit:limit+1});
    if(!result?.ok||!Array.isArray(result.rows)||result.rows.length>limit+1)throw new Error('Campaign recipient page unavailable');
    const hasMore=result.rows.length>limit;
    const items=result.rows.slice(0,limit).map(raw=>{
      const row=raw as Record<string,unknown>,value=JSON.parse(String(row.payload_json)) as StoredMarketingRecipient;
      if(value.id!==row.id||value.campaignCode!==code||cursor&&value.id<=cursor)throw new Error('Out of scope campaign recipient');
      return value;
    });
    return {items,nextCursor:hasMore?items.at(-1)!.id:null,done:!hasMore};
  };
  async function create(input:MarketingCampaignInput):Promise<string>{
    await authorize('create');
    if(!input||typeof input!=='object')throw new TypeError('Invalid campaign definition');
    const html=input.content!==undefined&&input.contentType!=='text'?input.content:input.html;
    const text=input.content!==undefined&&input.contentType==='text'?input.content:input.text;
    if(input.contentType!==undefined&&!['html','text'].includes(input.contentType)||input.content!==undefined&&
      (typeof input.content!=='string'||input.html!==undefined||input.text!==undefined))throw new TypeError('Ambiguous marketing content');
    if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||typeof input.subject!=='string'||!input.subject||input.subject.length>998||
      typeof html!=='string'&&typeof text!=='string'||html!==undefined&&html.length>55_000||text!==undefined&&text.length>55_000)
      throw new TypeError('Campaign name, subject and HTML or text are required');
    const providers=input.providers??(input.account?[input.account]:[]);
    if(!Array.isArray(providers)||providers.length<1||providers.length>10||providers.some(v=>typeof v!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(v)))throw new TypeError('Configured SMTP provider names are required');
    if(options.verifyProvider){for(const account of new Set(providers)){if(await options.verifyProvider(account)!==true)throw new Error('Marketing email provider unavailable');}}
    if(input.emails!==undefined&&input.recipients!==undefined)throw new TypeError('Choose emails or recipients, not both');
    const recipients=input.recipients??input.emails;
    if(!Array.isArray(recipients)||!recipients.length||recipients.length>1000)throw new RangeError('Campaign must have 1..1000 recipients per creation');
    if(input.autoEnqueue!==undefined&&typeof input.autoEnqueue!=='boolean')throw new TypeError('Invalid auto-enqueue flag');
    if(input.sendAt!==undefined&&(!Number.isSafeInteger(input.sendAt)||input.sendAt<0||input.sendAt>now()+365*86_400_000))throw new TypeError('Invalid campaign schedule');
    const globalData=jsonData(input.data??{},10_000);
    const unique=new Set<string>(),people:{email:string;name:string;data:Record<string,unknown>}[]=[];
    for(const entry of recipients){
      const person=typeof entry==='string'?{email:entry}:entry;
      if(!person||typeof person.email!=='string'||person.name!==undefined&&(typeof person.name!=='string'||person.name.length>200))throw new TypeError('Invalid campaign recipient');
      const email=canonical(person.email);
      if(unique.has(email))throw new TypeError('Duplicate campaign recipient');unique.add(email);
      people.push({email,name:person.name??'',data:jsonData(person.data??{},4000)});
    }
    const code='camp_'+randomBytes(16).toString('hex'),time=now();
    if(input.isTracking!==undefined&&typeof input.isTracking!=='boolean'){
      const policy=input.isTracking;
      if(!plain(policy)||Object.keys(policy).some(k=>!['enabled','opens','clicks','downloads','downloadLinks','campaign'].includes(k))||
        ['enabled','opens','clicks','downloads'].some(k=>(policy as Record<string,unknown>)[k]!==undefined&&typeof (policy as Record<string,unknown>)[k]!=='boolean')||
        (policy.downloadLinks!==undefined&&(!Array.isArray(policy.downloadLinks)||policy.downloadLinks.length>20||policy.downloadLinks.some(v=>typeof v!=='string'||v.length>2048))))throw new TypeError('Invalid tracking policy');
    }
    const tracking=input.isTracking===true?{enabled:true,opens:true,clicks:true,downloads:true,campaign:code}:input.isTracking===false||input.isTracking===undefined?{enabled:false}:{...input.isTracking,enabled:input.isTracking.enabled===true,campaign:code};
    const campaign:StoredMarketingCampaign={code,name:input.name,subject:input.subject,html,text,providers:[...new Set(providers)],
      data:globalData,tracking,sendAt:input.sendAt??time,status:'building',version:1,createdAt:time,updatedAt:time,recipientCount:people.length};
    await ensure();const created=await db.insert({table,values:{id:code,version:1,created_at:time,payload_json:encode(campaign)}});
    if(!created?.ok)throw new Error('Campaign creation unavailable');
    for(const person of people){
      const id=emailId(code,person.email);const record:StoredMarketingRecipient={id,campaignCode:code,...person,enqueuedAt:null};
      const result=await db.insert({table:recipientTable,values:{id,campaign_id:code,enqueued_at:null,payload_json:encode(record,8000)}});
      if(!result?.ok)throw new Error(`Campaign ${code} recipient insert failed; campaign remains in building state`);
    }
    await updateCampaign(code,c=>({...c,status:'ready',version:c.version+1}));
    await audit(code,'create',people.length);
    // Queue outages do not hide the durable campaign code; caller can retry enqueue(code).
    if(input.autoEnqueue===false)return code;
    try{let cursor:string|null=null;do{const page=await enqueue(code,{cursor,limit:200},true);cursor=page.nextCursor;}while(cursor!==null);}
    catch(error){await updateCampaign(code,c=>({...c,status:'queue_failed',version:c.version+1}));try{await options.onQueueError?.(code,error);}catch{/* never conceal durable campaign */}}
    return code;
  }
  async function enqueue(code:string,{cursor=null,limit=200}:{cursor?:string|null;limit?:number}={},internal=false){
    if(!internal)await authorize('enqueue',code);
    const campaign=await requireCampaign(code);
    if(!['ready','queue_failed'].includes(campaign.status))throw new Error('Campaign cannot be enqueued in current state');
    const page=await pageRecipients(code,cursor,limit);
    let queued=0;
    for(const row of page.items){
      if(row.enqueuedAt!==null)continue;
      const existing=await delivery.load(row.id);
      if(existing&&((existing.campaignId!==code)||(existing.recipient!==row.email)))throw new Error('Conflicting durable mail record');
      if(!existing){const inserted=await delivery.create({id:row.id,version:1,purpose:'marketing',recipient:row.email,campaignId:code,state:'pending',lease:null,updatedAt:now()});
        if(!inserted){const fresh=await delivery.load(row.id);if(!fresh||fresh.campaignId!==code||fresh.recipient!==row.email)throw new Error('Conflicting durable mail insertion');}
      }
      // Stable BullMQ job IDs prevent duplicate waiting entries; durable delivery claims prevent re-sends.
      try{await queue.add('email.deliver',{messageId:row.id},{jobId:row.id,delay:Math.max(0,campaign.sendAt-now()),attempts:5});}
      catch(error){
        try{await updateCampaign(code,c=>{if(!['ready','queue_failed'].includes(c.status))throw new Error('Campaign state changed');
          return {...c,status:'queue_failed',version:c.version+1};});}catch{/* Preserve original Redis failure. */}
        try{await options.onQueueError?.(code,error);}catch{/* Preserve original failure. */}
        throw error;
      }
      const next={...row,enqueuedAt:now()};
      const result=await db.update({table:recipientTable,values:{enqueued_at:next.enqueuedAt,payload_json:encode(next,8000)},
        where:{and:[{field:'id',operator:'eq',value:row.id},{field:'campaign_id',operator:'eq',value:code},{field:'enqueued_at',operator:'isNull'}]}});
      if(!result?.ok)throw new Error('Recipient enqueue checkpoint failed');
      const affected=result.affectedCount??result.rowCount;
      if(typeof affected!=='number'||!Number.isSafeInteger(affected)||affected<0||affected>1)throw new Error('Recipient enqueue checkpoint requires CAS');
      queued+=affected;
    }
    if(campaign.status==='queue_failed'&&page.done)await updateCampaign(code,c=>({...c,status:'ready',version:c.version+1}));
    if(queued)await audit(code,'enqueue',queued);
    return {campaignCode:code,queued,nextCursor:page.nextCursor,done:page.done};
  }

  /** Append a bounded audience batch. Replays compare persisted recipient data before
   * counting; retry an interrupted import with identical rows. This is a trusted
   * single-writer management operation; parallel audience imports must be serialized
   * by the host, and the stored count can be refreshed using audience(). */
  async function appendRecipients(code:string,entries:readonly (string|MarketingRecipient)[],enqueueNow=false){
    await authorize('append',code);
    const campaign=await requireCampaign(code);
    if(!['ready','queue_failed'].includes(campaign.status))throw new Error('Cannot append recipients to this campaign');
    if(!Array.isArray(entries)||entries.length<1||entries.length>1000||typeof enqueueNow!=='boolean')throw new RangeError('Append 1..1000 recipients');
    const seen=new Set<string>();let added=0,existing=0;
    for(const entry of entries){
      const person=typeof entry==='string'?{email:entry}:entry;
      if(!person||typeof person.email!=='string'||person.name!==undefined&&(typeof person.name!=='string'||person.name.length>200))throw new TypeError('Invalid campaign recipient');
      const email=canonical(person.email);
      if(seen.has(email))throw new TypeError('Duplicate recipient within batch');seen.add(email);
      const record:StoredMarketingRecipient={id:emailId(code,email),campaignCode:code,email,name:person.name??'',data:jsonData(person.data??{},4000),enqueuedAt:null};
      const old=await readRecipient(record.id);
      if(old){
        if(old.email!==record.email||old.name!==record.name||JSON.stringify(old.data)!==JSON.stringify(record.data))throw new Error('Conflicting recipient replay');
        existing++;continue;
      }
      try{const result=await db.insert({table:recipientTable,values:{id:record.id,campaign_id:code,enqueued_at:null,payload_json:encode(record,8000)}});
        if(!result?.ok)throw new Error('Recipient insertion failed');added++;
      }catch(error){
        const concurrent=await readRecipient(record.id);
        if(concurrent&&concurrent.email===record.email&&concurrent.name===record.name&&JSON.stringify(concurrent.data)===JSON.stringify(record.data)){existing++;continue;}
        throw error;
      }
    }
    const count=await countRecipients(code);
    await updateCampaign(code,c=>({...c,recipientCount:count,version:c.version+1}));
    let queued=0;
    if(enqueueNow){let cursor:string|null=null;do{const page=await enqueue(code,{cursor,limit:200},true);queued+=page.queued;cursor=page.nextCursor;}while(cursor!==null);}
    await audit(code,'append',added);
    return {campaignCode:code,added,existing,recipientCount:count,queued};
  }
  async function audience(code:string){
    await authorize('read',code);const campaign=await requireCampaign(code);
    const total=await countRecipients(code),unqueued=await countRecipients(code,true);
    if(unqueued>total)throw new Error('Corrupt campaign audience counts');
    return {campaignCode:code,status:campaign.status,storedRecipientCount:total,unqueued,enqueued:total-unqueued,
      storedCountMatches:campaign.recipientCount===total};
  }


  /** Explicit administrative redrive for lost/removed BullMQ entries. Re-adds only
   * durable pending records which were previously checkpointed as enqueued.
   * Stable job IDs plus durable worker CAS still gate actual SMTP delivery.
   * Submitted means accepted by the queue API, NOT newly created or delivered. */
  async function redrivePending(code:string,{cursor=null,limit=100}:{cursor?:string|null;limit?:number}={}){
    await authorize('redrive',code);
    const campaign=await requireCampaign(code);
    if(!['ready','queue_failed'].includes(campaign.status))throw new Error('Campaign cannot be redriven');
    const page=await pageRecipients(code,cursor,limit);
    let eligible=0,submitted=0;
    for(const row of page.items){
      if(row.enqueuedAt===null)continue;
      const state=await delivery.load(row.id);
      if(!state||state.campaignId!==code||state.recipient!==row.email)throw new Error('Missing or conflicting durable delivery identity');
      if(state.state!=='pending')continue;
      eligible++;
      await queue.add('email.deliver',{messageId:row.id},{jobId:row.id,delay:Math.max(0,campaign.sendAt-now()),attempts:5});
      submitted++;
    }
    if(submitted)await audit(code,'redrive',submitted);
    return {campaignCode:code,inspected:page.items.length,eligible,submitted,nextCursor:page.nextCursor,done:page.done};
  }

  async function renderRecipient(code:string,id:string):Promise<EmailMessage>{
    await authorize('render',code);
    const campaign=await requireCampaign(code),person=await readRecipient(id);
    if(!person||person.campaignCode!==code)throw new Error('Recipient not found in campaign');
    const context={...clone(campaign.data),...clone(person.data),name:person.name,email:person.email,campaign:{code,name:campaign.name}};
    const fields={subject:campaign.subject,...(campaign.html===undefined?{}:{html:campaign.html}),...(campaign.text===undefined?{}:{text:campaign.text})};
    // If the app registry supports renderFields, resolve shared dynamic variables once
    // across subject, HTML, and plain text for a consistent per-recipient snapshot.
    const registry=options.renderer as MarketingRenderer & {renderFields?:(fields:Record<string,string>,context:Readonly<Record<string,unknown>>,options?:{escape?:Record<string,'text'|'html'>;missing?:'empty'|'keep'|'error'})=>Promise<Record<string,string>>};
    const rendered=typeof registry?.renderFields==='function'?await registry.renderFields(fields,context,{escape:{subject:'text',html:'html',text:'text'},missing:'empty'}):null;
    const render=async(key:'subject'|'html'|'text',template:string,escape:'html'|'text')=>rendered?
      rendered[key]:options.renderer?await options.renderer.render(template,context,{escape,missing:'empty'}):interpolateTemplate(template,context,escape==='html');
    const providerNumber=parseInt(createHash('sha256').update(id).digest('hex').slice(0,8),16)%campaign.providers.length;
    return {to:person.name?{name:person.name,address:person.email}:person.email,account:campaign.providers[providerNumber],purpose:'marketing',
      subject:await render('subject',campaign.subject,'text'),html:campaign.html===undefined?undefined:await render('html',campaign.html,'html'),
      text:campaign.text===undefined?undefined:await render('text',campaign.text,'text'),tracking:{...campaign.tracking}};
  }
  const api={
    create,enqueue,appendRecipients,audience,redrivePending,
    /** Aggregate, recipient-safe campaign progress. The caller needs campaign read permission. */
    async overview(code:string){
      await authorize('read',code);
      const campaign=await requireCampaign(code);
      const total=await countRecipients(code),unqueued=await countRecipients(code,true);
      if(unqueued>total)throw new Error('Corrupt campaign recipient counters');
      return {code:campaign.code,name:campaign.name,status:campaign.status,sendAt:campaign.sendAt,
        createdAt:campaign.createdAt,updatedAt:campaign.updatedAt,recipientCount:total,
        enqueued:total-unqueued,unqueued,storedCountMatches:campaign.recipientCount===total,
        trackingEnabled:campaign.tracking.enabled===true,
        providerCount:campaign.providers.length};
    },
    /** Bounded recipient previews for trusted server-side administration. */
    async previewPage(code:string,{cursor=null,limit=10}:{cursor?:string|null;limit?:number}={}){
      await authorize('render',code);
      if(!Number.isSafeInteger(limit)||limit<1||limit>20)throw new RangeError('Preview page limit is 1..20');
      const campaign=await requireCampaign(code),page=await pageRecipients(code,cursor,limit);
      const items=[];
      for(const person of page.items){
        // Render through the same service path used for actual SMTP delivery.
        const message=await renderRecipient(campaign.code,person.id);
        items.push({messageId:person.id,subject:message.subject,html:message.html,text:message.text,
          recipient:person.email,provider:message.account,trackingEnabled:message.tracking?.enabled===true});
      }
      return {items,nextCursor:page.nextCursor,done:page.done};
    },
    async get(code:string){await authorize('read',code);const item=await readCampaign(code);return item?clone(item):null;},
    async list({cursor=null,limit=25}:{cursor?:string|null;limit?:number}={}){
      await authorize('read');
      if(cursor!==null&&!validCode(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new TypeError('Invalid campaign list cursor or limit');
      await ensure();const result=await db.select({table,columns:['id','version','payload_json'],...(cursor?{where:{field:'id',operator:'gt',value:cursor}}:{}),orderBy:[{by:'id',direction:'asc'}],limit:limit+1});
      if(!result?.ok||!Array.isArray(result.rows)||result.rows.length>limit+1)throw new Error('Campaign list unavailable');
      const hasMore=result.rows.length>limit;
      const campaigns=result.rows.slice(0,limit).map(row=>{const r=row as Record<string,unknown>,c=JSON.parse(String(r.payload_json)) as StoredMarketingCampaign;
        if(c.code!==r.id||c.version!==Number(r.version))throw new Error('Corrupt campaign list');return c;});
      return {campaigns,nextCursor:hasMore?campaigns.at(-1)!.code:null,done:!hasMore};
    },
    async recipients(code:string,{cursor=null,limit=50,withDelivery=true}:{cursor?:string|null;limit?:number;withDelivery?:boolean}={}){
      await authorize('read',code);await requireCampaign(code);
      const page=await pageRecipients(code,cursor,limit);
      const rows=await Promise.all(page.items.map(async person=>({ ...person,
        deliveryState:withDelivery?(await delivery.load(person.id))?.state??'not_registered':undefined})));
      return {recipients:rows,nextCursor:page.nextCursor,done:page.done};
    },
    preview:renderRecipient,
    /** Wire into createDurableEmailDeliveryProcessor.campaignGate for pause/cancel enforcement. */
    async deliveryGate(record:{campaignId?:string}):Promise<'allow'|'defer'|'suppress'>{
      if(!record.campaignId)return 'allow';
      const campaign=await requireCampaign(record.campaignId);
      if(campaign.status==='cancelled')return 'suppress';
      if(campaign.status==='building'||campaign.status==='paused'||campaign.sendAt>now())return 'defer';
      return 'allow';
    },
    /** Bridge for createDurableEmailDeliveryProcessor({send:...}). Keep durable state machine in charge of SMTP retries. */
    async sendById(id:string,manager:{send(message:EmailMessage):Promise<EmailResult>}):Promise<EmailResult>{
      const row=await readRecipient(id);if(!row)throw new Error('Marketing recipient missing');
      const campaign=await requireCampaign(row.campaignCode);
      if(campaign.status==='cancelled')throw new Error('Campaign cancelled');
      if(campaign.status==='paused'||campaign.status==='building'||campaign.sendAt>now())throw Object.assign(new Error('Campaign delivery deferred'),{code:'CAMPAIGN_DELIVERY_DEFERRED'});
      return manager.send(await renderRecipient(row.campaignCode,id));
    },
    async pause(code:string){await authorize('pause',code);const item=await updateCampaign(code,c=>{if(!['ready','queue_failed'].includes(c.status))throw new Error('Campaign cannot be paused');return {...c,status:'paused',version:c.version+1};});await audit(code,'pause');return item;},
    async resume(code:string){await authorize('resume',code);const item=await updateCampaign(code,c=>{if(c.status!=='paused')throw new Error('Campaign is not paused');return {...c,status:'ready',version:c.version+1};});await audit(code,'resume');return item;},
    async cancel(code:string){await authorize('cancel',code);const item=await updateCampaign(code,c=>{if(c.status==='cancelled')throw new Error('Campaign already cancelled');return {...c,status:'cancelled',version:c.version+1};});await audit(code,'cancel');return item;}
  };
  return api;
}
export type MarketingCampaignService=ReturnType<typeof createMarketingCampaignService>;
