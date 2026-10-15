import {createHash} from 'node:crypto';
import type {CampaignDatabaseConnection} from './campaign-storage.js';
import {inspectInboundSafety} from './inbound-safety.js';
import type {InboundSafety} from './inbound-safety.js';

const accountPattern=/^[a-z][a-z0-9_-]{0,63}$/;
const tablePattern=/^[a-z][a-z0-9_]{0,62}$/;
const MAX_IMAP_UID=0xffffffff;
export type IncomingProtocol='imap'|'pop3';
export type IncomingAuth={user:string;password:string;accessToken?:never}|{user:string;accessToken:string;password?:never};
export interface IncomingAccount {
  name:string; protocol:IncomingProtocol; host:string; port?:number;
  /** TLS is required. Plaintext POP3/IMAP is deliberately unsupported. */
  secure?:true;
  auth:IncomingAuth;
  mailbox?:string; // Default IMAP mailbox; POP3 always uses its single mailbox.
  /** Optional allowlist of additional IMAP folders that may be polled by name. */
  mailboxes?:string[];
  enabled?:boolean;
  timeoutMs?:number;
  maxMessageBytes?:number;
  maxMessagesPerPoll?:number;
  /** Refuse enormous mailboxes instead of allocating unbounded UID lists. */
  maxMailboxMessages?:number;
}
export interface InboundAddress {address:string;name?:string;}
export interface InboundAttachment {
  filename:string;contentType:string;size:number;contentId?:string;inline?:boolean;
  /** Opaque reference returned by a host-provided storage callback. */
  storedReference?:string;
  /** JSON mode only: base64 original binary (opt in; subject to strict total limits). */
  contentBase64?:string;
  contentOmitted?:boolean;
  scanVerdict?:'clean'|'suspicious'|'blocked'|'unscanned';
}
export interface InboundMessage {
  id:string; account:string;protocol:IncomingProtocol;mailbox:string;
  remoteId:string;uidValidity?:string;
  messageId?:string; subject:string; from:string[]; to:string[];cc:string[];
  bcc?:string[];replyTo?:string[];
  addressDetails?:{from:InboundAddress[];to:InboundAddress[];cc:InboundAddress[];bcc:InboundAddress[];replyTo:InboundAddress[]};
  inReplyTo?:string;references?:string[];priority?:'low'|'normal'|'high';
  date?:number;receivedAt:number;text?:string;html?:string;
  bodyTruncated:boolean;attachments:InboundAttachment[];safety?:InboundSafety;
}
export interface InboundStore {
  get(id:string):Promise<InboundMessage|null>;
  put(message:InboundMessage):Promise<boolean>; // atomic create-if-absent
  /** Optional, explicit local-retention deletion; must not delete remote server mail. */
  erase?(id:string,account:string):Promise<boolean>;
  page(account:string,cursor:string|null,limit:number):Promise<{items:InboundMessage[];nextCursor:string|null;done:boolean}>;
}
export interface ParsedIncomingMail {
  messageId?:string;subject?:string;
  from?:{value?:{address?:string;name?:string}[]};to?:{value?:{address?:string;name?:string}[]};
  cc?:{value?:{address?:string;name?:string}[]};bcc?:{value?:{address?:string;name?:string}[]};
  replyTo?:{value?:{address?:string;name?:string}[]};inReplyTo?:string;references?:string[]|string;
  priority?:'low'|'normal'|'high';
  date?:Date;text?:string;html?:string|false;
  attachments?:{filename?:string;contentType?:string;contentDisposition?:string;size?:number;cid?:string;content?:Buffer}[];
}
export interface ImapConnection {
  mailbox?:{exists?:number;uidValidity?:bigint|number|string;uidNext?:bigint|number|string};
  connect():Promise<void>;
  getMailboxLock(name:string,options:{readOnly:boolean}):Promise<{release():void}>;
  list?():Promise<{path:string;name?:string;delimiter?:string;flags?:Set<string>}[]>;
  messageFlagsAdd?(uid:number,flags:string[],options:{uid:true}):Promise<unknown>;
  messageFlagsRemove?(uid:number,flags:string[],options:{uid:true}):Promise<unknown>;
  search(query:{all?:true;uid?:string},options:{uid:true}):Promise<number[]|false>;
  fetchOne(uid:number,query:{source:true;size:true},options:{uid:true}):Promise<{source?:Buffer;size?:number}|false>;
  logout():Promise<void>;
}
export interface Pop3Connection {
  UIDL():Promise<(string|number)[][]>;
  NOOP?():Promise<unknown>;
  STAT?():Promise<unknown>;
  RETR(number:string|number):Promise<string|Buffer|AsyncIterable<Uint8Array>>;
  QUIT():Promise<unknown>;
}
export interface IncomingConnections {
  imap(account:IncomingAccount):Promise<ImapConnection>;
  pop3(account:IncomingAccount):Promise<Pop3Connection>;
}
export interface IncomingPollCursor {uidValidity?:string;afterUid:number;/** Bind resume state to exactly one IMAP folder. */mailbox?:string;}
export interface IncomingPollOptions {cursor?:IncomingPollCursor;/** Only a configured IMAP mailbox can be selected. */mailbox?:string;}
export interface EmailReceiverOptions {
  accounts:IncomingAccount[];
  /** If omitted, JSON mode returns parsed messages without installing/using any inbox tables. */
  store?:InboundStore;
  /** json mode never persists messages. Default: persist when store is provided, json otherwise. */
  mode?:'persist'|'json';
  /** Optional host-defined database mapping/handler. Rejected callbacks fail the poll. */
  onMessage?:(message:InboundMessage)=>Promise<void>|void;
  /** Trusted external classifier; receives the original bounded source. Failure aborts the poll. */
  inspectRaw?:(context:{account:string;raw:Buffer})=>Promise<'clean'|'spam'|'phishing'|'malware'|'review'>;
  /** Optional attachment scanner: blocked/suspicious bytes are never uploaded or emitted as base64. */
  inspectAttachment?:(context:{account:string;messageId:string;filename:string;content:Buffer})=>Promise<'clean'|'suspicious'|'blocked'>;
  /** JSON mode only; binary attachments are opt-in and base64 encoded with a total byte cap. */
  attachmentContent?:'metadata'|'base64';
  maxInlineAttachmentBytes?:number;
  connections?:IncomingConnections;
  parse?:(raw:Buffer)=>Promise<ParsedIncomingMail>;
  /** Override only with a trusted HTML sanitizer. Default strips scripts, images and unsafe URLs. */
  sanitizeHtml?:(html:string)=>string|Promise<string>;
  /** Attachments are NOT retained in the inbox table. Upload through this callback if desired. */
  saveAttachment?:(context:{account:string;messageId:string;attachment:InboundAttachment;content:Buffer})=>Promise<string>;
  now?:()=>number;
}
function bounds(n:number|undefined,fallback:number,min:number,max:number,name:string):number{
  const value=n??fallback;
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError(`Invalid ${name}`);
  return value;
}
function checkAccount(account:IncomingAccount){
  if(!accountPattern.test(account?.name)||!['imap','pop3'].includes(account.protocol))throw new TypeError('Invalid receive account');
  if(typeof account.host!=='string'||!/^([a-z0-9][a-z0-9.-]{0,252}|\[[0-9a-f:]+\])$/i.test(account.host)||account.host.includes('..'))throw new TypeError('Invalid inbound hostname');
  if(account.secure!==undefined&&account.secure!==true)throw new TypeError('Inbound connections require verified TLS');
  bounds(account.port,account.protocol==='imap'?993:995,1,65535,'mail port');
  bounds(account.timeoutMs,15000,1000,120000,'mail timeout');
  bounds(account.maxMessageBytes,8*1024*1024,1024,32*1024*1024,'mail size');
  bounds(account.maxMessagesPerPoll,50,1,500,'poll limit');
  bounds(account.maxMailboxMessages,5000,1,50000,'mailbox scan limit');
  if(!account.auth||typeof account.auth.user!=='string'||!account.auth.user.trim()||account.auth.user.length>320)throw new TypeError('Invalid inbound username');
  if(typeof account.auth.password!=='string'&&typeof account.auth.accessToken!=='string')throw new TypeError('Inbound authentication required');
  if(account.protocol==='pop3'&&'accessToken'in account.auth)throw new TypeError('POP3 OAuth2 is not supported by the selected POP3 driver');
  if(account.protocol==='pop3'&&(/[\r\n\0]/.test(account.auth.user)||typeof account.auth.password==='string'&&/[\r\n\0]/.test(account.auth.password)))throw new TypeError('Unsafe POP3 authentication data');
  if(account.protocol==='pop3'&&account.mailbox)throw new TypeError('POP3 does not support named mailboxes');
  if(account.mailbox&&!safeMailbox(account.mailbox))throw new TypeError('Invalid IMAP mailbox');
  if(account.mailboxes!==undefined){
    if(account.protocol!=='imap'||!Array.isArray(account.mailboxes)||account.mailboxes.length>100||
      account.mailboxes.some(folder=>!safeMailbox(folder))||new Set(account.mailboxes).size!==account.mailboxes.length)
      throw new TypeError('Invalid IMAP mailbox allowlist');
  }
}
function safeMailbox(value:unknown):value is string{
  return typeof value==='string'&&value.length>0&&value.length<=255&&!/[\r\n\0]/.test(value);
}
function resolveMailbox(account:IncomingAccount,requested:string|undefined):string{
  if(account.protocol==='pop3'){if(requested!==undefined)throw new TypeError('POP3 has no named mailboxes');return 'INBOX';}
  const mailbox=requested??account.mailbox??'INBOX';
  if(!safeMailbox(mailbox))throw new TypeError('Invalid IMAP mailbox');
  if(requested!==undefined&&requested!==account.mailbox&&requested!=='INBOX'&&!account.mailboxes?.includes(requested))
    throw new Error('IMAP mailbox not configured for this account');
  return mailbox;
}
function keyFor(account:string,protocol:IncomingProtocol,mailbox:string,uidValidity:string,remoteId:string):string{
  return createHash('sha256').update(JSON.stringify([account,protocol,mailbox,uidValidity,remoteId])).digest('hex');
}
function emails(value?:{value?:{address?:string;name?:string}[]}):string[]{
  return (value?.value??[]).map(item=>item.address??'').filter(Boolean).slice(0,100);
}
function safeFilename(value:unknown):string{
  const leaf=String(value??'attachment').split(/[\\/]/).at(-1)??'attachment';
  const cleaned=leaf.replace(/[\x00-\x1f\x7f]/g,'_').trim().slice(0,255);
  return cleaned&&!/^\.+$/.test(cleaned)?cleaned:'attachment';
}
function addressDetails(value?:{value?:{address?:string;name?:string}[]}):InboundAddress[]{
  return (value?.value??[]).filter(x=>typeof x.address==='string'&&x.address.length>0).slice(0,100)
    .map(x=>({address:x.address!.slice(0,320),...(x.name?{name:String(x.name).slice(0,256)}:{})}));
}
function clip(value:string|undefined,max:number):{value:string|undefined;truncated:boolean}{
  if(!value)return {value:undefined,truncated:false};
  return {value:value.length>max?value.slice(0,max):value,truncated:value.length>max};
}
/** Mapping for a pre-existing application inbox table. The three identity/JSON fields are required;
 * every other field is an optional denormalized column for application-owned indexes and queries.
 * Existing tables are never modified when createTable=false.
 */
export interface MappedInboxColumns {
  id:string;account:string;payload:string;
  subject?:string;mailbox?:string;receivedAt?:string;from?:string;
}
export interface MappedDatabaseInboxOptions {
  table:string;
  /** Defaults to false: the host owns migrations, indexes and column definitions. */
  createTable?:boolean;
  columns?:Partial<MappedInboxColumns>;
}
export function createMappedDatabaseInboxStore(db:CampaignDatabaseConnection,config:MappedDatabaseInboxOptions):InboundStore{
  const table=config?.table;
  if(typeof table!=='string'||!tablePattern.test(table))throw new TypeError('Invalid inbox table');
  const columns:MappedInboxColumns={id:'id',account:'account',payload:'payload_json',...config.columns};
  const keys=Object.values(columns);
  if(keys.some(v=>typeof v!=='string'||!tablePattern.test(v))||new Set(keys).size!==keys.length)
    throw new TypeError('Invalid or duplicate mapped inbox columns');
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{
    if(!config.createTable)return; // Existing application-owned table is not touched.
    const extra=[
      ...(columns.subject?[{name:columns.subject,type:'varchar',length:1024}]:[]),
      ...(columns.mailbox?[{name:columns.mailbox,type:'varchar',length:255}]:[]),
      ...(columns.receivedAt?[{name:columns.receivedAt,type:'bigint'}]:[]),
      ...(columns.from?[{name:columns.from,type:'varchar',length:320}]:[])
    ];
    const result=await db.createTable({table,ifNotExists:true,columns:[
      {name:columns.id,type:'varchar',length:64,primary:true,notNull:true},
      {name:columns.account,type:'varchar',length:64,notNull:true},
      {name:columns.payload,type:'text',notNull:true},...extra
    ]});
    if(!result?.ok)throw new Error('Inbox table initialization failed');
    if(db.createIndex){try{await db.createIndex({table,name:`${table}_account_idx`,columns:[columns.account,columns.id],unique:false,ifNotExists:true});}catch{/* optional index */}}
  })().catch(error=>{ready=undefined;throw error;});
  const decode=(row:Record<string,unknown>):InboundMessage=>{
    const serialized=row[columns.payload];
    if(typeof serialized!=='string')throw new Error('Corrupt inbox payload');
    const data=JSON.parse(serialized) as InboundMessage;
    if(data.id!==row[columns.id]||data.account!==row[columns.account])throw new Error('Corrupt inbox identity');
    return data;
  };
  const projection=[columns.id,columns.account,columns.payload];
  const adapter:InboundStore={
    async get(id){if(!/^[a-f0-9]{64}$/.test(id))throw new TypeError('Invalid inbox id');
      await ensure();const result=await db.select({table,columns:projection,where:{field:columns.id,operator:'eq',value:id},limit:1});
      if(!result?.ok||!Array.isArray(result.rows))throw new Error('Inbox read failed');
      return result.rows.length?decode(result.rows[0] as Record<string,unknown>):null;},
    async put(value){
      if(!/^[a-f0-9]{64}$/.test(value?.id)||!accountPattern.test(value.account))throw new TypeError('Invalid inbox identity');
      await ensure();const json=JSON.stringify(value);
      if(Buffer.byteLength(json)>60_000)throw new RangeError('Inbox metadata exceeds portable TEXT limit');
      const values:Record<string,unknown>={[columns.id]:value.id,[columns.account]:value.account,[columns.payload]:json};
      if(columns.subject)values[columns.subject]=value.subject.slice(0,1024);
      if(columns.mailbox)values[columns.mailbox]=value.mailbox.slice(0,255);
      if(columns.receivedAt)values[columns.receivedAt]=value.receivedAt;
      if(columns.from)values[columns.from]=(value.from[0]??'').slice(0,320);
      try{const result=await db.insert({table,values});if(result?.ok)return true;}
      catch(error){const existing=await adapter.get(value.id);if(existing)return false;throw error;}
      if(await adapter.get(value.id))return false;
      throw new Error('Inbox insert failed');},
    async erase(id,account){
      if(!/^[a-f0-9]{64}$/.test(id)||!accountPattern.test(account))throw new TypeError('Invalid inbox erase identity');
      if(!db.delete)throw new Error('Inbox retention requires a connector with delete support');
      await ensure();const r=await db.delete({table,where:{and:[{field:columns.id,operator:'eq',value:id},{field:columns.account,operator:'eq',value:account}]}});
      if(!r?.ok)throw new Error('Inbox erasure failed');const count=r.affectedCount??r.rowCount;
      if(!Number.isSafeInteger(count)||count!==0&&count!==1)throw new Error('Inbox erasure requires affectedCount');
      return count===1;
    },
    async page(account,cursor=null,limit=50){
      if(!accountPattern.test(account))throw new TypeError('Invalid account');const size=bounds(limit,50,1,500,'page limit');
      if(cursor!==null&&!/^[a-f0-9]{64}$/.test(cursor))throw new TypeError('Invalid cursor');
      await ensure();const conditions:[any,...any[]]=[{field:columns.account,operator:'eq',value:account}];
      if(cursor)conditions.push({field:columns.id,operator:'gt',value:cursor});
      const result=await db.select({table,columns:projection,where:{and:conditions},orderBy:[{by:columns.id,direction:'asc'}],limit:size+1});
      if(!result?.ok||!Array.isArray(result.rows))throw new Error('Inbox listing failed');
      if(result.rows.length>size+1)throw new Error('Inbox connector ignored page bound');
      const hasNext=result.rows.length>size;
      const items=result.rows.slice(0,size).map(row=>decode(row as Record<string,unknown>));
      return {items,nextCursor:hasNext?items.at(-1)!.id:null,done:!hasNext};
    }
  };
  return adapter;
}
/** Built-in ZeruxJS-owned inbox table. Created lazily, only when first used. */
export function createDatabaseInboxStore(db:CampaignDatabaseConnection,table='zerux_email_inbox'):InboundStore{
  return createMappedDatabaseInboxStore(db,{table,createTable:true});
}
export function createMemoryInboxStore():InboundStore{
  const items=new Map<string,InboundMessage>();return {
    async get(id){return items.has(id)?structuredClone(items.get(id)!):null;},
    async put(value){if(items.has(value.id))return false;items.set(value.id,structuredClone(value));return true;},
    async erase(id,account){if(items.get(id)?.account!==account)return false;return items.delete(id);},
    async page(account,cursor=null,limit=50){const size=bounds(limit,50,1,500,'page limit');const page=[...items.values()].filter(v=>v.account===account&&(cursor===null||v.id>cursor)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,size);
      return {items:page.map(v=>structuredClone(v)),nextCursor:page.length===size?page.at(-1)!.id:null,done:page.length<size};}
  };
}
const defaultConnections:IncomingConnections={
  async imap(account){const {ImapFlow}=await import('imapflow');return new ImapFlow({host:account.host,port:account.port??993,secure:true,
    auth:{user:account.auth.user,...('password'in account.auth?{pass:account.auth.password}:{accessToken:account.auth.accessToken})},
    connectionTimeout:account.timeoutMs??15000,greetingTimeout:account.timeoutMs??15000,socketTimeout:account.timeoutMs??15000,
    disableAutoIdle:true,logger:false,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}}) as unknown as ImapConnection;},
  async pop3(account){const {default:Pop3Command}=await import('node-pop3');return new Pop3Command({host:account.host,port:account.port??995,tls:true,
    user:account.auth.user,password:'password'in account.auth?account.auth.password:undefined,
    timeout:account.timeoutMs??15000,maxMailSize:account.maxMessageBytes??8*1024*1024,parseStreamToString:false,
    streamReadTimeout:account.timeoutMs??15000,tlsOptions:{minVersion:'TLSv1.2',rejectUnauthorized:true}}) as Pop3Connection;}
};
/** Consume POP3 RETR without lossy UTF-8 conversion; reject excessive output. */
async function readRaw(value:string|Buffer|AsyncIterable<Uint8Array>,maximum:number):Promise<Buffer>{
  if(typeof value==='string'){const buffer=Buffer.from(value,'utf8');if(buffer.length>maximum)throw new RangeError('POP3 message exceeds byte limit');return buffer;}
  if(Buffer.isBuffer(value)){if(value.length>maximum)throw new RangeError('POP3 message exceeds byte limit');return value;}
  if(!value||typeof value[Symbol.asyncIterator]!=='function')throw new TypeError('POP3 RETR returned invalid raw message');
  const chunks:Buffer[]=[];let size=0;
  for await(const part of value){
    if(!(part instanceof Uint8Array))throw new Error('Invalid POP3 stream chunk');
    size+=part.byteLength;if(size>maximum)throw new RangeError('POP3 message exceeds byte limit');
    chunks.push(Buffer.from(part));
  }
  return Buffer.concat(chunks,size);
}
export function createEmailReceiver(options:EmailReceiverOptions){
  if(!options||!Array.isArray(options.accounts)||!options.accounts.length)throw new TypeError('Receive accounts are required');
  const mode=options.mode??(options.store?'persist':'json');
  if(mode!=='persist'&&mode!=='json')throw new TypeError('Invalid inbound mode');
  if(mode==='persist'&&!options.store)throw new TypeError('Persistent receiving requires an inbox store');
  if(options.attachmentContent==='base64'&&mode!=='json')throw new TypeError('Binary attachment output requires JSON mode');
  const maxInline=bounds(options.maxInlineAttachmentBytes,2*1024*1024,1024,8*1024*1024,'inline attachment limit');
  const accounts=new Map<string,IncomingAccount>();
  for(const input of options.accounts){checkAccount(input);if(accounts.has(input.name))throw new TypeError('Duplicate receive account');accounts.set(input.name,input);}
  const connections=options.connections??defaultConnections;
  const parse=options.parse??(async(raw:Buffer)=>{const {simpleParser}=await import('mailparser');return await simpleParser(raw) as unknown as ParsedIncomingMail;});
  const sanitizeHtml=options.sanitizeHtml??(async(raw:string)=>{
    const {default:sanitize}=await import('sanitize-html');
    return sanitize(raw,{allowedTags:['p','br','b','strong','em','i','u','a','ul','ol','li','blockquote','div','span','table','tbody','tr','td','th','h1','h2','h3'],
      allowedAttributes:{a:['href']},allowedSchemes:['https','mailto'],allowProtocolRelative:false,
      nonTextTags:['script','style','textarea','noscript']});
  });
  let closed=false;
  async function save(account:IncomingAccount,mailbox:string,remoteId:string,uidValidity:string,raw:Buffer):Promise<InboundMessage|null>{
    const max=account.maxMessageBytes??8*1024*1024;
    if(raw.byteLength>max)throw new RangeError('Inbound message exceeds configured byte limit');
    const id=keyFor(account.name,account.protocol,mailbox,uidValidity,remoteId);
    if(mode==='persist'&&await options.store!.get(id))return null;
    const externalVerdict=options.inspectRaw?await options.inspectRaw({account:account.name,raw}):undefined;
    if(externalVerdict&&!['clean','spam','phishing','malware','review'].includes(externalVerdict))throw new Error('Invalid external mail verdict');
    const parsed=await parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
      (parsed.attachments!==undefined&&!Array.isArray(parsed.attachments))||
      (parsed.text!==undefined&&typeof parsed.text!=='string')||
      (parsed.html!==undefined&&parsed.html!==false&&typeof parsed.html!=='string'))
      throw new Error('Invalid MIME parser result');
    const text=clip(parsed.text,24000),html=clip(typeof parsed.html==='string'?await sanitizeHtml(parsed.html):undefined,24000);
    const attachments:InboundAttachment[]=[];let inlineBytes=0,omitted=false;
    for(const original of (parsed.attachments??[]).slice(0,100)){
      if(!original||typeof original!=='object'||
        (original.content!==undefined&&!Buffer.isBuffer(original.content))||
        (original.size!==undefined&&(!Number.isSafeInteger(original.size)||original.size<0)))
        throw new Error('Invalid MIME attachment');
      const actualSize=original.content?.length??0;
      const declaredSize=original.size??actualSize;
      const size=Math.max(actualSize,declaredSize);
      const attachment:InboundAttachment={filename:safeFilename(original.filename),
        contentType:String(original.contentType??'application/octet-stream').replace(/[\r\n\0]/g,'').slice(0,128),size,...(original.cid?{contentId:String(original.cid).slice(0,320)}:{}),
        ...((original.contentDisposition==='inline'||Boolean(original.cid))?{inline:true}:{})};
      if(size>max){attachment.contentOmitted=true;omitted=true;}
      if(original.content&&size<=max){
        attachment.scanVerdict=options.inspectAttachment?await options.inspectAttachment({account:account.name,messageId:id,filename:attachment.filename,content:original.content}):'unscanned';
        if(!['clean','suspicious','blocked','unscanned'].includes(attachment.scanVerdict))throw new Error('Invalid attachment scanner verdict');
      }
      const safeBytes=original.content&&size<=max&&attachment.scanVerdict!=='blocked'&&attachment.scanVerdict!=='suspicious'&&externalVerdict!=='malware';
      if(options.attachmentContent==='base64'&&mode==='json'&&original.content&&!safeBytes){attachment.contentOmitted=true;omitted=true;}
      if(options.attachmentContent==='base64'&&mode==='json'&&safeBytes){
        if(inlineBytes+original.content!.length<=maxInline){attachment.contentBase64=original.content!.toString('base64');inlineBytes+=original.content!.length;}
        else{attachment.contentOmitted=true;omitted=true;}
      }
      if(options.saveAttachment&&safeBytes){
        const ref=await options.saveAttachment({account:account.name,messageId:id,attachment,content:original.content!});
        if(typeof ref!=='string'||!ref||ref.length>1024)throw new Error('Attachment store returned invalid reference');attachment.storedReference=ref;
      }
      attachments.push(attachment);
    }
    const message:InboundMessage={id,account:account.name,protocol:account.protocol,mailbox,remoteId, ...(account.protocol==='imap'?{uidValidity}:{}),
      messageId:parsed.messageId?.slice(0,320),subject:(parsed.subject??'').slice(0,1024),from:emails(parsed.from),to:emails(parsed.to),cc:emails(parsed.cc),
      bcc:emails(parsed.bcc),replyTo:emails(parsed.replyTo),
      addressDetails:{from:addressDetails(parsed.from),to:addressDetails(parsed.to),cc:addressDetails(parsed.cc),
        bcc:addressDetails(parsed.bcc),replyTo:addressDetails(parsed.replyTo)},
      inReplyTo:parsed.inReplyTo?.slice(0,320),
      references:(Array.isArray(parsed.references)?parsed.references:[parsed.references??'']).filter(Boolean).slice(0,100).map(v=>String(v).slice(0,320)),
      ...(parsed.priority&&['low','normal','high'].includes(parsed.priority)?{priority:parsed.priority}:{}),
      ...(parsed.date instanceof Date&&Number.isFinite(parsed.date.getTime())?{date:parsed.date.getTime()}:{}),receivedAt:options.now?.()??Date.now(),
      text:text.value,html:html.value,bodyTruncated:text.truncated||html.truncated||Boolean(parsed.attachments&&parsed.attachments.length>100),attachments};
    message.safety=inspectInboundSafety({subject:message.subject,from:message.from,html:typeof parsed.html==='string'?parsed.html:undefined,
      text:message.text,attachments,bodyTruncated:message.bodyTruncated,attachmentContentOmitted:omitted,
      externalVerdict,attachmentVerdicts:attachments.map(a=>a.scanVerdict??'unscanned')});
    if(mode==='persist'&&!(await options.store!.put(message)))return null;
    if(options.onMessage)await options.onMessage(structuredClone(message));
    return message;
  }
  /** Mutations always re-open the mailbox and fence on UIDVALIDITY before targeting a UID. */
  async function mutateImapFlag(name:string,messageId:string|InboundMessage,flag:'\\Seen'|'\\Flagged',set:boolean):Promise<boolean>{
    if(closed)throw new Error('Email receiver closed');const account=accounts.get(name);
    if(!account||account.enabled===false||account.protocol!=='imap')throw new Error('Only IMAP accounts support message flags');
    const message=typeof messageId==='string'?await options.store?.get(messageId):messageId;
    if(message&&message.id!==keyFor(message.account,message.protocol,message.mailbox,message.uidValidity??'',message.remoteId))
      throw new Error('Invalid IMAP message identity');
    if(!message||message.account!==name||message.protocol!=='imap'||!/^[1-9]\d*$/.test(message.remoteId)||
      !Number.isSafeInteger(Number(message.remoteId))||Number(message.remoteId)>MAX_IMAP_UID||
      !message.uidValidity||!safeMailbox(message.mailbox)||
      ![account.mailbox??'INBOX','INBOX',...(account.mailboxes??[])].includes(message.mailbox))throw new Error('IMAP message not found');
    const client=await connections.imap(account);let connected=false;
    try{await client.connect();connected=true;const lock=await client.getMailboxLock(message.mailbox,{readOnly:false});
      try{if(String(client.mailbox?.uidValidity)!==message.uidValidity)throw new Error('IMAP UIDVALIDITY changed; refusing to modify a different message');
        const change=set?client.messageFlagsAdd:client.messageFlagsRemove;
        if(!change)throw new Error('IMAP flag changes unsupported by driver');
        await change.call(client,Number(message.remoteId),[flag],{uid:true});return true;
      }finally{lock.release();}
    }finally{if(connected)await client.logout();}
  }
  return {
    accounts(){return [...accounts.values()].map(({name,protocol,host,port,enabled,mailbox,mailboxes})=>({name,protocol,host,port:port??(protocol==='imap'?993:995),enabled:enabled!==false,mailbox:mailbox??'INBOX',...(protocol==='imap'?{mailboxes:[...new Set([mailbox??'INBOX',...(mailboxes??[])])]}:{})}));},
    get:(id:string)=>{if(!options.store)throw new Error('No inbox store configured; handle messages returned by poll()');return options.store.get(id);},
    /** Verify authentication and TLS without changing remote mail or local inbox state. */
    async verify(name:string):Promise<boolean>{
      if(closed)throw new Error('Email receiver closed');const account=accounts.get(name);
      if(!account||account.enabled===false)throw new Error('Receive account unavailable');
      if(account.protocol==='imap'){
        const client=await connections.imap(account);let connected=false;
        try{await client.connect();connected=true;const lock=await client.getMailboxLock(account.mailbox??'INBOX',{readOnly:true});lock.release();return true;}
        finally{if(connected)await client.logout();}
      }
      const client=await connections.pop3(account);try{if(client.NOOP)await client.NOOP();else if(client.STAT)await client.STAT();else await client.UIDL();return true;}finally{await client.QUIT();}
    },
    page:(account:string,cursor:string|null=null,limit=50)=>{if(!options.store)throw new Error('No inbox store configured; implement your own pagination');return options.store.page(account,cursor,limit);},
    /** Polls one mailbox; duplicate messages remain on the server and are not re-inserted. */
    async poll(name:string,pollOptions:IncomingPollOptions={}){
      if(closed)throw new Error('Email receiver closed');const account=accounts.get(name);
      if(!account||account.enabled===false)throw new Error('Receive account unavailable');
      const mailbox=resolveMailbox(account,pollOptions.mailbox);
      const limit=account.maxMessagesPerPoll??50,maxScan=account.maxMailboxMessages??5000;
      let scanned=0,stored=0,duplicates=0,oversized=0;const newIds:string[]=[],messages:InboundMessage[]=[];
      const cursor=pollOptions.cursor;
      if(cursor&&(account.protocol!=='imap'||!Number.isSafeInteger(cursor.afterUid)||cursor.afterUid<0||cursor.afterUid>MAX_IMAP_UID||
        (cursor.uidValidity!==undefined&&!/^\d+$/.test(cursor.uidValidity))||
        (cursor.mailbox!==undefined&&(!safeMailbox(cursor.mailbox)||cursor.mailbox!==mailbox))||
        (cursor.mailbox===undefined&&cursor.afterUid>0&&mailbox!==(account.mailbox??'INBOX'))))throw new TypeError('Invalid or cross-mailbox IMAP cursor');
      let nextCursor:IncomingPollCursor|undefined;
      if(account.protocol==='imap'){
        const client=await connections.imap(account);let connected=false;
        try{
          await client.connect();connected=true;
          const lock=await client.getMailboxLock(mailbox,{readOnly:true});
          try{
            if(!cursor&&(client.mailbox?.exists??0)>maxScan)throw new RangeError('IMAP mailbox exceeds scan bound; use incremental cursor polling');
            const validity=String(client.mailbox?.uidValidity??'');if(!/^\d+$/.test(validity))throw new Error('IMAP server did not expose UIDVALIDITY');
            if(cursor?.uidValidity&&cursor.uidValidity!==validity)throw new Error('IMAP UIDVALIDITY changed; reset incremental cursor explicitly');
            const upper=cursor?Math.min(MAX_IMAP_UID,cursor.afterUid+maxScan):undefined;
            const uids=cursor?.afterUid===MAX_IMAP_UID?[]:
              await client.search(cursor?{uid:`${cursor.afterUid+1}:${upper}`}:{all:true},{uid:true});
            if(uids===false)throw new Error('IMAP UID search failed');
            if(uids.length>maxScan)throw new RangeError('IMAP UID search exceeded bound');
            const candidateUids=uids.filter(uid=>!cursor||(uid>cursor.afterUid&&uid<=upper!)).sort((a,b)=>cursor?a-b:b-a);
            let lastProcessed=cursor?.afterUid??0,visited=0;
            for(const uid of candidateUids){
              if(scanned>=limit)break;
              visited++;
              if(!Number.isSafeInteger(uid)||uid<1||uid>MAX_IMAP_UID)throw new Error('Invalid IMAP UID');
              const id=keyFor(name,'imap',mailbox,validity,String(uid));
              if(mode==='persist'&&await options.store!.get(id)){duplicates++;lastProcessed=uid;continue;}
              const msg=await client.fetchOne(uid,{source:true,size:true},{uid:true});
              if(!msg||!msg.source||!(msg.source instanceof Uint8Array))throw new Error('IMAP source unavailable or invalid; retry the cursor instead of skipping the UID');
              if(msg.size!==undefined&&msg.size>(account.maxMessageBytes??8*1024*1024)){oversized++;lastProcessed=uid;continue;}
              scanned++;
              try{const message=await save(account,mailbox,String(uid),validity,Buffer.from(msg.source));if(message){stored++;newIds.push(id);if(mode==='json')messages.push(message);}else duplicates++;lastProcessed=uid;}
              catch(error){if(error instanceof RangeError){oversized++;lastProcessed=uid;continue;}throw error;}
            }
            if(cursor){
              // Never skip a UID that may be assigned to a future message. Without UIDNEXT,
              // advancing across an empty UID range could lose late messages.
              const next=Number(client.mailbox?.uidNext);
              const knownUpper=Number.isSafeInteger(next)&&next>0?Math.max(cursor.afterUid,next-1):lastProcessed;
              nextCursor={uidValidity:validity,mailbox,afterUid:visited<candidateUids.length?lastProcessed:Math.min(upper!,Math.max(lastProcessed,knownUpper))};
            }
          }finally{lock.release();}
        }finally{if(connected)await client.logout();}
      }else{
        const client=await connections.pop3(account);
        try{
          const pairs=await client.UIDL();if(!Array.isArray(pairs)||pairs.length>maxScan)throw new RangeError('POP3 UIDL mailbox exceeds scan bound');
          const numbers=new Set<string>(),ids=new Set<string>();
          for(const pair of pairs){
            const number=String(pair?.[0]??''),uidl=String(pair?.[1]??'');
            if(!/^[1-9]\d*$/.test(number)||!uidl||uidl.length>512||/[\r\n\0]/.test(uidl)||numbers.has(number)||ids.has(uidl))
              throw new Error('Invalid or duplicate POP3 UIDL entry');
            numbers.add(number);ids.add(uidl);
          }
          for(const pair of pairs.slice().reverse()){
            if(scanned>=limit)break;
            const number=String(pair?.[0]??''),remoteId=String(pair?.[1]??'');
            if(!/^[1-9]\d*$/.test(number)||!remoteId||remoteId.length>512)throw new Error('Invalid POP3 UIDL entry');
            const id=keyFor(name,'pop3','INBOX','',remoteId);
            if(mode==='persist'&&await options.store!.get(id)){duplicates++;continue;}
            const source=await client.RETR(number);scanned++;
            try{const message=await save(account,'INBOX',remoteId,'',await readRaw(source,account.maxMessageBytes??8*1024*1024));if(message){stored++;newIds.push(id);if(mode==='json')messages.push(message);}else duplicates++;}
            catch(error){if(error instanceof RangeError){oversized++;continue;}throw error;}
          }
        }finally{await client.QUIT();}
      }
      return {account:name,protocol:account.protocol,scanned,stored,duplicates,oversized,newIds,
        ...(mode==='json'?{messages}:{}),...(nextCursor?{nextCursor}:{})};
    },
    async pollAll(){const results=[];for(const name of accounts.keys())if(accounts.get(name)?.enabled!==false)results.push(await this.poll(name));return results;},
    /** Explicitly poll all configured IMAP folders. For resumable synchronization use a separate
     * durable checkpoint per (account, mailbox); this helper alone does not persist cursors. */
    async pollConfiguredMailboxes(){
      const results=[];
      for(const account of accounts.values()){
        if(account.enabled===false)continue;
        if(account.protocol==='pop3'){results.push(await this.poll(account.name));continue;}
        for(const mailbox of new Set([account.mailbox??'INBOX',...(account.mailboxes??[])]))
          results.push(await this.poll(account.name,{mailbox,cursor:{afterUid:0,mailbox}}));
      }
      return results;
    },
    /** List folders on an IMAP account; never exposes server credentials. */
    async folders(name:string):Promise<{path:string;name?:string}[]>{
      if(closed)throw new Error('Email receiver closed');const account=accounts.get(name);
      if(!account||account.enabled===false||account.protocol!=='imap')throw new Error('IMAP account unavailable');
      const client=await connections.imap(account);let connected=false;
      try{await client.connect();connected=true;if(!client.list)throw new Error('IMAP folder listing unsupported by driver');
        const folders=await client.list();if(!Array.isArray(folders)||folders.length>2000)throw new Error('Invalid IMAP folder listing');
        return folders.map(f=>({path:String(f.path).slice(0,255),...(f.name?{name:String(f.name).slice(0,255)}:{})}));
      }finally{if(connected)await client.logout();}
    },
    /** Read/unread and starred state are remote IMAP operations; POP3 has no flags. */
    markSeen:(name:string,messageId:string|InboundMessage)=>mutateImapFlag(name,messageId,'\\Seen',true),
    markUnread:(name:string,messageId:string|InboundMessage)=>mutateImapFlag(name,messageId,'\\Seen',false),
    setFlagged:(name:string,messageId:string|InboundMessage,flagged:boolean)=>mutateImapFlag(name,messageId,'\\Flagged',flagged),
    async close(){closed=true;}
  };
}
export type EmailReceiver=ReturnType<typeof createEmailReceiver>;
/** Handler for @zeruxjs/queue named task registration. Never puts credentials or mail into Redis. */
export function createIncomingPollProcessor(receiver:Pick<EmailReceiver,'poll'>){
  return async(job:{data:{account:string}})=>{
    if(!job?.data||Object.keys(job.data).length!==1||!accountPattern.test(job.data.account))throw new TypeError('Poll jobs may contain only a receive account name');
    return receiver.poll(job.data.account);
  };
}
