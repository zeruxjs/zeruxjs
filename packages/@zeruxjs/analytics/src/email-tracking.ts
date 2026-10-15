import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {AnalyticsManager} from './manager.js';
import {createMemoryEmailActivityStore} from './email-activity.js';
import type {EmailActivityEvent,EmailActivityKind,EmailActivityStore,EmailActivitySummary} from './email-activity.js';
export {createMemoryEmailActivityStore} from './email-activity.js';
export type {EmailActivityEvent,EmailActivityKind,EmailActivityLink,EmailActivityStore,EmailActivitySummary} from './email-activity.js';

type Kind='open'|'click';
interface SignedPayload {kind:Kind;id:string;account:string;campaign:string;url?:string;download?:boolean;linkId?:string;expires:number;nonce:string}
/** Identifier is public; secret must be private and shared by every serving replica. */
export interface EmailTrackingKey {id:string;secret:string}
/** The first key signs new links. Previous keys ONLY verify already-issued links. */
export interface EmailTrackingKeyRing {current:EmailTrackingKey;previous?:readonly EmailTrackingKey[]}
export interface EmailTrackingOptions {
  analytics:AnalyticsManager;
  baseUrl:string;
  /** Use at least 32 random bytes, provisioned as a secret. Never send to the browser. */
  secret?:string;
  /** Alternative to secret: rotate without breaking already-issued v2/v3 tokens. */
  keyRing?:EmailTrackingKeyRing;
  /** Turn off readable Section 43 HMAC tokens independently of encrypted v2/v3 links. */
  acceptLegacyHmac?:boolean;
  path?:string;
  ttlMs?:number;
  /** Optional allowlist restricting outbound links to exact hosts. */
  allowedLinkHosts?:readonly string[];
  /** Optional activity aggregation; use durable atomic shared storage in production. Defaults to bounded process memory. */
  activityStore?:EmailActivityStore;
  onEvent?:(event:EmailActivityEvent)=>void|Promise<void>;
  enabled?:boolean;
  /** Upper bound on time spent waiting for each telemetry callback. */
  telemetryTimeoutMs?:number;
  /** Cap unresolved telemetry operations when a DB connection hangs. */
  maxPendingTelemetry?:number;
  onWarning?:(message:string)=>void;
}
export interface TrackedEmailMessage {tracking?:{enabled?:boolean;opens?:boolean;clicks?:boolean;downloads?:boolean;downloadLinks?:readonly string[];campaign?:string}}
const PIXEL=Uint8Array.from(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64'));
function escapeAttr(value:string){return value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}
function decodeHref(value:string){return value.replace(/&amp;/gi,'&').replace(/&#38;/g,'&');}
/** Signed, expiring server-side email tracking; no tracking JavaScript, no PII in URL payloads. */
export function createEmailTrackingService(config:EmailTrackingOptions){
  const base=new URL(config.baseUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new TypeError('Email tracking requires an HTTPS base URL');
  if(config.keyRing!==undefined&&config.secret!==undefined)throw new TypeError('Use either email tracking secret or keyRing, not both');
  const hasRing=config.keyRing!==undefined;
  const ring=config.keyRing;
  if(hasRing&&(!ring||typeof ring!=='object'||!ring.current||
    !Array.isArray(ring.previous??[])||(ring.previous?.length??0)>4))throw new TypeError('Invalid email tracking key ring');
  const rawKeys:readonly EmailTrackingKey[]=hasRing
    ?[ring!.current,...(ring!.previous??[])]:[{id:'default',secret:config.secret as string}];
  const ids=new Set<string>();
  for(const entry of rawKeys){
    if(!entry||typeof entry!=='object'||typeof entry.secret!=='string'||Buffer.byteLength(entry.secret)<32)throw new TypeError('Email tracking secret must contain at least 32 bytes');
    if(!/^[A-Za-z0-9_-]{1,32}$/.test(entry.id)||ids.has(entry.id))throw new TypeError('Invalid or duplicate email tracking key ID');
    ids.add(entry.id);
  }
  if(config.acceptLegacyHmac!==undefined&&typeof config.acceptLegacyHmac!=='boolean')throw new TypeError('Invalid legacy tracking token policy');
  const acceptLegacyHmac=config.acceptLegacyHmac!==false;
  const path=(config.path??'/_analytics/email').replace(/\/$/,'');
  if(!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(path)||path.split('/').some(segment=>segment==='.'||segment==='..')||path.length>128)throw new TypeError('Invalid tracking path');
  const ttlMs=config.ttlMs??14*24*60*60_000;
  if(!Number.isSafeInteger(ttlMs)||ttlMs<60_000||ttlMs>30*86_400_000)throw new RangeError('Invalid tracking token lifetime');
  const timeoutMs=config.telemetryTimeoutMs??350,maxPending=config.maxPendingTelemetry??64;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>10_000||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>1000)throw new RangeError('Invalid email telemetry limits');
  const activityStore=config.activityStore??createMemoryEmailActivityStore();
  let pending=0;
  let enabled=config.enabled!==false;let warned=false;
  function warn(){if(warned)return;warned=true;try{(config.onWarning??console.warn)('[analytics] Email tracking telemetry unavailable; event skipped');}catch{}}
  async function telemetry(action:()=>Promise<unknown>|unknown):Promise<void>{
    if(pending>=maxPending){warn();return;}
    pending++;
    // Keep the unresolved operation counted until it actually settles, even if
    // the HTTP response or email send has already reached its wait deadline.
    const operation=Promise.resolve().then(action).then(()=>{},()=>{warn();}).finally(()=>{pending--;});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([operation,new Promise<void>(resolve=>{timer=setTimeout(()=>{warn();resolve();},timeoutMs);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
  const allowed=config.allowedLinkHosts?new Set(config.allowedLinkHosts.map(s=>s.toLowerCase())):undefined;
  // Domain-separated encryption keys. v2's derivation MUST NOT change: links
  // already delivered by Section 44 depend on it until their expiry.
  const keys=rawKeys.map(key=>({
    id:key.id,
    secret:key.secret,
    v2:createHash('sha256').update('zerux-email-tracking-v2\0').update(key.secret).digest(),
    v3:createHash('sha256').update('zerux-email-tracking-v3\0').update(key.secret).digest()
  }));
  const byId=new Map(keys.map(key=>[key.id,key]));
  function encrypt(data:SignedPayload){
    const current=keys[0], version=hasRing?'v3':'v2';
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',current[version],iv);
    if(version==='v3')cipher.setAAD(Buffer.from(`v3.${current.id}`));
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
    const body=Buffer.concat([iv,ciphertext,cipher.getAuthTag()]).toString('base64url');
    return version==='v3'?`v3.${current.id}.${body}`:`v2.${body}`;
  }
  function decrypt(encoded:string,key:Buffer,aad?:string):unknown{
    const bytes=Buffer.from(encoded,'base64url');
    // Node accepts non-canonical base64url trailing bits; reject aliases so a
    // changed URL string cannot be treated as the same authenticated token.
    if(bytes.toString('base64url')!==encoded||bytes.length<29)return null;
    const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
    if(aad)decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(bytes.subarray(bytes.length-16));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8'));
  }
  function decode(token:string):unknown{
    const parts=token.split('.');
    if(parts.length===3&&parts[0]==='v3'){
      const key=byId.get(parts[1]);
      if(!key)return null;
      return decrypt(parts[2],key.v3,`v3.${parts[1]}`);
    }
    if(parts.length!==2)return null;
    const [version,encoded]=parts;
    if(version==='v2'){
      // v2 did not include a key ID. Try the deliberately bounded key ring
      // so migration from the Section 44 single-secret format is seamless.
      for(const key of keys){try{const payload=decrypt(encoded,key.v2);if(payload!==null)return payload;}catch{/* Not this key. */}}
      return null;
    }
    if(!acceptLegacyHmac)return null;
    // Section 43 HMAC token compatibility can be explicitly shut down. An
    // empty or malformed signature never passes constant-time comparison.
    const supplied=Buffer.from(encoded,'base64url');
    if(supplied.length!==32||supplied.toString('base64url')!==encoded)return null;
    for(const key of keys){
      const expected=createHmac('sha256',key.secret).update(version).digest();
      if(timingSafeEqual(supplied,expected))return JSON.parse(Buffer.from(version,'base64url').toString('utf8'));
    }
    return null;
  }
  function open(token:string,kind:Kind):SignedPayload|null{
    if(token.length>4096||!(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||/^v3\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+$/.test(token)))return null;
    try{const parsed=decode(token) as SignedPayload|null;
      if(!parsed||typeof parsed!=='object')return null;
      if(parsed.kind!==kind||typeof parsed.id!=='string'||parsed.id.length>128||typeof parsed.account!=='string'||parsed.account.length>64||typeof parsed.campaign!=='string'||parsed.campaign.length>128||!Number.isSafeInteger(parsed.expires)||parsed.expires<Date.now()||parsed.expires>Date.now()+30*86_400_000)return null;
      if(kind==='click'){
        if(typeof parsed.url!=='string'||parsed.download!==undefined&&typeof parsed.download!=='boolean'||parsed.linkId!==undefined&&typeof parsed.linkId!=='string')return null;
        const link=new URL(parsed.url);if(link.protocol!=='https:'||link.username||link.password||allowed&&!allowed.has(link.hostname.toLowerCase()))return null;
      }
      return parsed;
    }catch{return null;}
  }
  function linkId(url:string){return createHash('sha256').update(url).digest('hex').slice(0,32);}
  function makeUrl(kind:Kind,context:{id:string;account:string;campaign:string},url?:string,download=false){
    const token=encrypt({kind,id:context.id,account:context.account,campaign:context.campaign,url,
      ...(kind==='click'?{download,linkId:linkId(url!)}:{}),expires:Date.now()+ttlMs,nonce:randomBytes(8).toString('hex')});
    // Do not emit tracking links the request handler would refuse to decode.
    if(token.length>4096)throw new RangeError('Tracking URL exceeds token limit');
    const result=new URL(base.href);result.pathname=path+`/${kind}/${token}`;result.search='';return result.href;
  }
  async function record(event:EmailActivityEvent){
    if(!enabled)return;
    // Store and event callbacks are best-effort. Failed or slow telemetry must
    // never change the actual email delivery or HTTP redirect response.
    const properties:Record<string,string|number>={message_id:event.id,account:event.account,campaign:event.campaign};
    if(event.linkId)properties.link_id=event.linkId;
    if(event.bytes!==undefined)properties.bytes=event.bytes;
    await Promise.all([
      telemetry(()=>config.analytics.track({name:event.kind==='download_click'?'email.download_click':`email.${event.kind}`,source:'email',occurredAt:event.at,properties})),
      telemetry(()=>activityStore.record(event)),
      ...(config.onEvent?[telemetry(()=>config.onEvent!(event))]:[])
    ]);
  }
  const service={
    path,
    /** Aggregated per-email activity, including first timestamps and repeat counts.
     * In-memory results are process-local. Use a shared store for multi-server deployments.
     */
    async getActivity(id:string):Promise<EmailActivitySummary|null>{
      if(!/^[a-zA-Z0-9._:-]{1,128}$/.test(id))return null;
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{return await Promise.race([activityStore.get(id),new Promise<null>(resolve=>{timer=setTimeout(()=>{warn();resolve(null);},timeoutMs);timer.unref?.();})]);}
      catch{warn();return null;}
      finally{if(timer)clearTimeout(timer);}
    },
    /** Call only after your application has successfully served a tracked file.
     * A redirect click never counts as a completed download; attachments cannot report opens/downloads.
     */
    async recordDownload(context:{id:string;account:string;campaign?:string;url?:string;bytes?:number}):Promise<void>{
      if(!/^[a-zA-Z0-9._:-]{1,128}$/.test(context.id)||!/^[a-z][a-z0-9_-]{0,63}$/.test(context.account))return;
      if(context.campaign!==undefined&&context.campaign.length>128)return;
      if(context.bytes!==undefined&&(!Number.isSafeInteger(context.bytes)||context.bytes<0))return;
      let targetId: string|undefined;
      if(context.url){
        try{const url=new URL(context.url);if(url.protocol!=='https:'||url.username||url.password||allowed&&!allowed.has(url.hostname.toLowerCase()))return;targetId=linkId(url.href);}catch{return;}
      }
      await record({kind:'download',id:context.id,account:context.account,campaign:context.campaign??'',at:Date.now(),...(targetId?{linkId:targetId}:{}),...(context.bytes!==undefined?{bytes:context.bytes}:{})});
    },
    setEnabled(value:boolean){enabled=value===true;},
    /** Used by @zeruxjs/email's manager.tracking callback after HTML sanitization and inlining. */
    instrumentHtml(html:string,context:{id:string;account:string;message:TrackedEmailMessage}):string{
      const policy=context.message.tracking;
      if(!enabled||!policy?.enabled)return html;
      if(!/^[a-zA-Z0-9._:-]{1,128}$/.test(context.id))throw new TypeError('Invalid tracking message ID');
      if(!/^[a-z][a-z0-9_-]{0,63}$/.test(context.account))throw new TypeError('Invalid tracking account');
      const campaign=policy.campaign??'';if(campaign.length>128)throw new TypeError('Invalid campaign');
      const info={id:context.id,account:context.account,campaign};
      const explicitDownloads=new Set<string>();
      for(const target of policy.downloadLinks??[]){
        try{const url=new URL(target);if(url.protocol==='https:'&&!url.username&&!url.password)explicitDownloads.add(url.href);}catch{/* Non-URL is not a downloadable destination */}
      }
      let updated=html;
      if(policy.clicks!==false){let links=0;
        updated=updated.replace(/<a\b[^>]*>/gi,(tag:string)=>{
          if(++links>100||/(?:\bdata-no-track\b|\bdata-tracking\s*=\s*["']off["']|\brel\s*=\s*["'][^"']*\bunsubscribe\b)/i.test(tag))return tag;
          return tag.replace(/(\bhref\s*=\s*)(["'])(.*?)\2/i,(full,prefix:string,quote:string,raw:string)=>{
            try{
              const link=new URL(decodeHref(raw));
              // Unsubscribe and opt-out links must remain untouched, even when
              // their function is expressed as a query parameter.
              const optOut=/(?:unsubscribe|unsub|opt[-_]?out|one[-_]?click)/i;
              if(link.protocol!=='https:'||link.username||link.password||
                allowed&&!allowed.has(link.hostname.toLowerCase())||
                (link.origin===base.origin&&link.pathname.startsWith(path+'/'))||
                optOut.test(link.pathname)||[...link.searchParams.keys()].some(key=>optOut.test(key)))return full;
              const download=policy.downloads!==false&&(explicitDownloads.has(link.href)||/\b(?:data-track-download|data-email-download|download)(?:\s|=|>)/i.test(tag));
              return prefix+quote+escapeAttr(makeUrl('click',info,link.href,download))+quote;
            }catch{return full;}
          });
        });
      }
      // A message can pass through multiple renderers; add at most one pixel
      // for this tracking service and never wrap a previously wrapped click.
      const hasPixel=[...updated.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi)].some(match=>{
        try{const existing=new URL(decodeHref(match[2]));return existing.origin===base.origin&&existing.pathname.startsWith(path+'/open/');}
        catch{return false;}
      });
      if(policy.opens!==false&&!hasPixel){
        const img=`<img src="${escapeAttr(makeUrl('open',info))}" alt="" width="1" height="1" style="display:none!important;width:1px;height:1px;border:0" />`;
        updated=/<\/body>/i.test(updated)?updated.replace(/<\/body>/i,img+'</body>'):updated+img;
      }
      return updated;
    },
    async onSent(event:{id:string;account:string;message:TrackedEmailMessage}){
      if(!enabled||!event.message.tracking?.enabled)return;
      const campaign=event.message.tracking.campaign??'';
      await record({kind:'sent',id:event.id,account:event.account,campaign,at:Date.now()});
    },
    async handle(request:Request):Promise<Response>{
      if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
      const url=new URL(request.url);
      const match=url.pathname.match(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}/(open|click)/([A-Za-z0-9_.-]+)$`));
      if(!match)return new Response(null,{status:404});
      const kind=match[1] as Kind,decoded=open(match[2],kind);
      if(!decoded)return new Response(null,{status:404,headers:{'cache-control':'no-store'}});
      if(request.method==='GET'){
        if(enabled){
          const eventKind:EmailActivityKind=kind==='open'?'open':decoded.download?'download_click':'click';
          await record({kind:eventKind,id:decoded.id,account:decoded.account,campaign:decoded.campaign,at:Date.now(),...(kind==='click'?{linkId:decoded.linkId??linkId(decoded.url!)}:{})});
        }
      }
      return kind==='open'?new Response(request.method==='HEAD'?null:PIXEL,{status:200,headers:{'content-type':'image/gif','cache-control':'private, no-store, max-age=0','content-length':String(PIXEL.byteLength),'x-content-type-options':'nosniff'}}):new Response(null,{status:302,headers:{location:decoded.url!,'cache-control':'private, no-store','referrer-policy':'no-referrer'}});
    },
    routes(){return [{pattern:`${path}/open/:token`,handler:service.handle},{pattern:`${path}/click/:token`,handler:service.handle}];}
  };
  return service;
}
