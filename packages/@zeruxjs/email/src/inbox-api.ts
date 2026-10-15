import type {EmailReceiver,InboundMessage,InboundStore} from './inbound.js';

/** Server-side inbox API for custom UIs. Never publish this without a host identity/authorization check. */
export type InboxOperation='list'|'read'|'search'|'poll'|'markSeen'|'markUnread'|'flag'|'unflag'|'folders'|'erase';
export interface InboxAccess {operation:InboxOperation;account:string;messageId?:string;mailbox?:string;}
export interface InboxApiOptions {
  store:InboundStore;
  /** Required. Resolve the current user/session and enforce account permissions for EVERY call. */
  authorize:(access:InboxAccess)=>Promise<boolean>|boolean;
  receiver?:Pick<EmailReceiver,'poll'|'markSeen'|'markUnread'|'setFlagged'|'folders'|'accounts'>;
  /** A separate, explicit legal-hold/retention approval for irreversible local erasure. */
  canErase?:(message:Readonly<InboundMessage>)=>Promise<boolean>|boolean;
}
export interface InboxQuery {
  account:string;cursor?:string|null;limit?:number;
}
export interface InboxSearch extends InboxQuery {
  subject?:string;sender?:string;mailbox?:string;
  fromTime?:number;toTime?:number;
  risk?:'low'|'review'|'high';hasAttachments?:boolean;
  /** Maximum number of underlying messages to inspect in this call; default 1000, at most 5000. */
  maxScanned?:number;
}
export interface InboxSummary {
  id:string;account:string;mailbox:string;protocol:InboundMessage['protocol'];
  subject:string;from:string[];date?:number;receivedAt:number;
  attachmentCount:number;bodyTruncated:boolean;
  risk:'low'|'review'|'high'|'unknown';flags:string[];
}
function integer(n:number|undefined,fallback:number,max:number,name:string){
  const value=n??fallback;
  if(!Number.isSafeInteger(value)||value<1||value>max)throw new RangeError(`Invalid ${name}`);
  return value;
}
function accountName(value:string){if(typeof value!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(value))throw new TypeError('Invalid inbox account');return value;}
function msgId(value:string){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new TypeError('Invalid message id');return value;}
function pageCursor(value:string|null|undefined){if(value!==undefined&&value!==null)msgId(value);return value??null;}
function summary(m:InboundMessage):InboxSummary{return {
  id:m.id,account:m.account,mailbox:m.mailbox,protocol:m.protocol,
  subject:m.subject,from:[...m.from],...(m.date!==undefined?{date:m.date}:{}),receivedAt:m.receivedAt,
  attachmentCount:m.attachments.length,bodyTruncated:m.bodyTruncated,
  risk:m.safety?.risk??'unknown',flags:[...(m.safety?.flags??[])]
};}
function condition(value:number|undefined,name:string){
  if(value!==undefined&&(!Number.isSafeInteger(value)||value<0||value>Number.MAX_SAFE_INTEGER))throw new RangeError(`Invalid ${name}`);
}
/**
 * Unlike the lower-level storage adapter, this provides account-scoped operations and summary-only pages.
 * Search is deliberately scan-bounded because existing inbox tables may only have id/account/payload_json.
 * A page's `done=false` means *more records to examine*, not that matches are guaranteed.
 */
export function createInboxApi(options:InboxApiOptions){
  if(!options?.store||typeof options.authorize!=='function')throw new TypeError('Inbox API requires a store and authorization callback');
  const {store}=options;
  async function allow(operation:InboxOperation,account:string,messageId?:string,mailbox?:string){
    accountName(account);if(messageId)msgId(messageId);
    if(mailbox!==undefined&&(typeof mailbox!=='string'||!mailbox||mailbox.length>255||/[\r\n\0]/.test(mailbox)))
      throw new TypeError('Invalid inbox mailbox');
    if(await options.authorize({operation,account,...(messageId?{messageId}:{}),...(mailbox?{mailbox}:{})})!==true)throw new Error('Inbox access denied');
  }
  async function scoped(account:string,id:string){
    const record=await store.get(msgId(id));
    // Return identical not-found behavior for non-existent and cross-account messages.
    if(!record||record.account!==account)return null;
    return record;
  }
  return {
    /** Minimal metadata for inbox rows; no HTML, plaintext body, attachment bytes or raw headers. */
    async list(query:InboxQuery){
      const account=accountName(query?.account),limit=integer(query.limit,50,200,'inbox page limit');
      const cursor=pageCursor(query.cursor);
      await allow('list',account);
      const result=await store.page(account,cursor,limit);
      if(result.items.length>limit||result.items.some(m=>m.account!==account))throw new Error('Inbox store returned out-of-scope records');
      return {items:result.items.map(summary),nextCursor:result.nextCursor,done:result.done};
    },
    /** Full stored message, including sanitized HTML and metadata; no underlying server credentials. */
    async get(account:string,id:string){
      accountName(account);msgId(id);await allow('read',account,id);
      const record=await scoped(account,id);
      return record?structuredClone(record):null;
    },
    /** Server-side bounded filtering for use with applications' paginated inbox interfaces. */
    async search(query:InboxSearch){
      const account=accountName(query?.account),limit=integer(query.limit,50,200,'search page limit');
      const maxScanned=integer(query.maxScanned,1000,5000,'search scan bound');
      condition(query.fromTime,'start time');condition(query.toTime,'end time');
      if(query.fromTime!==undefined&&query.toTime!==undefined&&query.fromTime>query.toTime)throw new RangeError('Invalid time window');
      if(query.risk!==undefined&&!['low','review','high'].includes(query.risk))throw new TypeError('Invalid risk filter');
      if(query.hasAttachments!==undefined&&typeof query.hasAttachments!=='boolean')throw new TypeError('Invalid attachment filter');
      for(const term of [query.subject,query.sender,query.mailbox])if(term!==undefined&&(typeof term!=='string'||term.length>256))throw new TypeError('Invalid inbox search term');
      const start=pageCursor(query.cursor);
      await allow('search',account);
      const items:InboxSummary[]=[];let scanned=0,cursor=start,done=false;
      const subject=query.subject?.toLowerCase(),sender=query.sender?.toLowerCase();
      while(scanned<maxScanned&&items.length<limit){
        const page=await store.page(account,cursor,Math.min(200,maxScanned-scanned));
        if(page.items.length>200||page.items.some(m=>m.account!==account))throw new Error('Inbox store returned out-of-scope records');
        if(page.items.length===0){if(!page.done)throw new Error('Inbox store returned an empty nonterminal page');done=true;break;}
        for(const m of page.items){
          scanned++;cursor=m.id;
          if((!subject||m.subject.toLowerCase().includes(subject))&&
            (!sender||m.from.some(x=>x.toLowerCase().includes(sender)))&&
            (query.mailbox===undefined||m.mailbox===query.mailbox)&&
            (query.fromTime===undefined||m.receivedAt>=query.fromTime)&&
            (query.toTime===undefined||m.receivedAt<=query.toTime)&&
            (query.risk===undefined||m.safety?.risk===query.risk)&&
            (query.hasAttachments===undefined||(m.attachments.length>0)===query.hasAttachments))items.push(summary(m));
          if(items.length===limit)break;
        }
        if(items.length===limit){done=page.done&&cursor===page.items.at(-1)!.id;break;}
        if(page.done){done=true;break;}
      }
      return {items,nextCursor:done?null:cursor,done,scanned,scanLimited:!done&&scanned>=maxScanned};
    },
    /** Require explicit remote mutation permission and UIDVALIDITY fencing in the receiver. */
    async markSeen(account:string,id:string){
      accountName(account);msgId(id);await allow('markSeen',account,id);
      if(!options.receiver)throw new Error('IMAP receiver is not configured');
      const message=await scoped(account,id);
      if(!message)return false;
      return options.receiver.markSeen(account,message);
    },
    /** Local inbox erasure only. This does not modify IMAP/POP3 servers or suppression history. */
    async markUnread(account:string,id:string){
      accountName(account);msgId(id);await allow('markUnread',account,id);
      if(!options.receiver)throw new Error('IMAP receiver is not configured');
      const message=await scoped(account,id);return message?options.receiver.markUnread(account,message):false;
    },
    async setFlagged(account:string,id:string,flagged:boolean){
      accountName(account);msgId(id);
      if(typeof flagged!=='boolean')throw new TypeError('Invalid flagged state');
      await allow(flagged?'flag':'unflag',account,id);
      if(!options.receiver)throw new Error('IMAP receiver is not configured');
      const message=await scoped(account,id);return message?options.receiver.setFlagged(account,message,flagged):false;
    },
    async folders(account:string){
      await allow('folders',account);
      if(!options.receiver)throw new Error('IMAP receiver is not configured');
      return options.receiver.folders(account);
    },
    async eraseLocal(account:string,id:string){
      accountName(account);msgId(id);await allow('erase',account,id);
      if(!store.erase||!options.canErase)throw new Error('Local inbox erasure requires explicit retention approval');
      const message=await scoped(account,id);
      if(!message)return false;
      if(await options.canErase(structuredClone(message))!==true)throw new Error('Inbox erasure denied by retention policy');
      return store.erase(id,account);
    },
    async poll(account:string,mailbox?:string){
      await allow('poll',account,undefined,mailbox);
      if(!options.receiver)throw new Error('Inbox receiver is not configured');
      const result=await options.receiver.poll(account,mailbox===undefined?{}:{mailbox});
      // The host controls polling; do not expose parsed message bodies via this operation.
      return {account,protocol:result.protocol,scanned:result.scanned,stored:result.stored,
        duplicates:result.duplicates,oversized:result.oversized};
    }
  };
}
export type InboxApi=ReturnType<typeof createInboxApi>;
