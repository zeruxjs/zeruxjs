import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {addressString,validateEmailAddress} from './validation.js';
import type {EmailAddress} from './types.js';

export type ConsentStatus='subscribed'|'unsubscribed';
export interface ConsentRecord {status:ConsentStatus;updatedAt:string;source:string;proof?:string}
/** Implement get/set using one shared, durable store for production and queued workers.
 * A consent write must be committed before set() resolves; never cache stale consent checks.
 */
export interface ConsentStore {
  get(email:string):Promise<ConsentRecord|null>;
  set(email:string,record:ConsentRecord):Promise<void>;
}
export interface EmailPreferencesOptions {
  baseUrl:string;
  secret:string;
  path?:string;
  /** No store means development-only in-process state, lost on restart. */
  store?:ConsentStore;
  /** Optional cap for generated links; defaults to no expiration, as unsubscribe links must stay usable. */
  maxAgeMs?:number;
  /** Maximum time to receive a one-click POST body, default 5 seconds. */
  postTimeoutMs?:number;
}

function canonical(input:EmailAddress){
  const email=addressString(validateEmailAddress(input)).trim().toLowerCase();
  if(email.length>320)throw new TypeError('Invalid email address');
  return email;
}
export function createMemoryConsentStore():ConsentStore & {snapshot():ReadonlyMap<string,ConsentRecord>} {
  const data=new Map<string,ConsentRecord>();
  return {async get(email){return data.get(email)??null;},async set(email,record){data.set(email,{...record});},snapshot(){return new Map(data);}};
}
const bodyLimit=256;
async function readOneClick(request:Request,timeoutMs:number):Promise<boolean>{
  if(!/^application\/x-www-form-urlencoded(?:\s*;.*)?$/i.test(request.headers.get('content-type')??''))return false;
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>bodyLimit))return false;
  if(!request.body)return false;
  const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];let expired=false;
  const timer=setTimeout(()=>{expired=true;void reader.cancel('deadline').catch(()=>{});},timeoutMs);
  timer.unref?.();
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>bodyLimit){await reader.cancel().catch(()=>{});return false;}chunks.push(value);}
  }finally{clearTimeout(timer);reader.releaseLock();}
  if(expired)return false;
  const body=Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('utf8');
  return body==='List-Unsubscribe=One-Click';
}
export function createEmailPreferenceService(options:EmailPreferencesOptions){
  const base=new URL(options.baseUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new TypeError('HTTPS preferences baseUrl required');
  if(typeof options.secret!=='string'||Buffer.byteLength(options.secret,'utf8')<32)throw new TypeError('Email preference secret must be at least 32 bytes');
  const path=options.path??'/_zerux/email/unsubscribe';
  if(!/^\/[a-zA-Z0-9/_-]{1,120}$/.test(path)||path.endsWith('/')||path.includes('//'))throw new TypeError('Invalid unsubscribe path');
  const postTimeoutMs=options.postTimeoutMs??5000;
  if(!Number.isSafeInteger(postTimeoutMs)||postTimeoutMs<10||postTimeoutMs>30_000)throw new RangeError('Invalid unsubscribe POST timeout');
  const maxAge=options.maxAgeMs;
  if(maxAge!==undefined&&(!Number.isSafeInteger(maxAge)||maxAge<86_400_000||maxAge>10*365*86_400_000))throw new RangeError('Invalid unsubscribe token lifetime');
  const key=createHash('sha256').update('zerux-email-unsubscribe-v1\0').update(options.secret).digest();
  const store=options.store??createMemoryConsentStore();
  // Long-lived unsubscribe links carry encrypted addresses, not plaintext email or campaign data.
  function makeUrl(address:EmailAddress){
    const email=canonical(address),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
    cipher.setAAD(Buffer.from('zerux-unsubscribe-v1'));
    const payload=JSON.stringify({email,createdAt:Date.now()});
    const ciphertext=Buffer.concat([cipher.update(payload,'utf8'),cipher.final()]);
    const token=Buffer.concat([iv,ciphertext,cipher.getAuthTag()]).toString('base64url');
    const url=new URL(base.href);url.pathname=path+'/'+token;url.search='';url.hash='';return url.href;
  }
  function verify(token:string):string|null{
    if(!/^[A-Za-z0-9_-]{35,800}$/.test(token))return null;
    try{
      const bytes=Buffer.from(token,'base64url');if(bytes.toString('base64url')!==token||bytes.length<29)return null;
      const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
      decipher.setAAD(Buffer.from('zerux-unsubscribe-v1'));
      decipher.setAuthTag(bytes.subarray(-16));
      const payload=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8')) as {email?:unknown;createdAt?:unknown};
      if(typeof payload.email!=='string'||!Number.isSafeInteger(payload.createdAt))return null;
      const createdAt=payload.createdAt as number;
      if(createdAt>Date.now()+60_000||createdAt<0||maxAge!==undefined&&Date.now()-createdAt>maxAge)return null;
      const email=canonical(payload.email);return email===payload.email?email:null;
    }catch{return null;}
  }
  const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
  return {
    /** No record and an unreachable store are never treated as opt-in. */
    async isSubscribed(address:EmailAddress){const entry=await store.get(canonical(address));return entry?.status==='subscribed';},
    async status(address:EmailAddress){return store.get(canonical(address));},
    /** Called only after the application has independently verified opt-in evidence. */
    async subscribe(address:EmailAddress,evidence:{source:string;proof:string}){
      if(typeof evidence?.source!=='string'||!/^[a-zA-Z0-9_.:-]{1,64}$/.test(evidence.source)||typeof evidence?.proof!=='string'||evidence.proof.trim().length<1||evidence.proof.length>512)throw new TypeError('Verified consent evidence required');
      await store.set(canonical(address),{status:'subscribed',updatedAt:new Date().toISOString(),source:evidence.source,proof:evidence.proof});
    },
    async unsubscribe(address:EmailAddress){
      await store.set(canonical(address),{status:'unsubscribed',updatedAt:new Date().toISOString(),source:'unsubscribe'});
    },
    makeUnsubscribeUrl:makeUrl,
    path,
    async handle(request:Request):Promise<Response>{
      const url=new URL(request.url);
      const prefix=path+'/';
      if(!url.pathname.startsWith(prefix)||url.search)return new Response(null,{status:404,headers});
      const email=verify(url.pathname.slice(prefix.length));if(!email)return new Response(null,{status:404,headers});
      if(request.method==='HEAD')return new Response(null,{status:200,headers});
      if(request.method==='GET'){
        // Link scanners GET pages. Only a real POST can change consent.
        const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Unsubscribe</title><body><h1>Unsubscribe from marketing emails</h1><form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Unsubscribe</button></form></body></html>';
        return new Response(html,{status:200,headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; form-action 'self'; style-src 'none'"}});
      }
      if(request.method!=='POST')return new Response(null,{status:405,headers:{...headers,allow:'GET, HEAD, POST'}});
      let validBody=false;
      try{validBody=await readOneClick(request,postTimeoutMs);}catch{/* Malformed or aborted request. */}
      if(!validBody)return new Response(null,{status:400,headers});
      try{await store.set(email,{status:'unsubscribed',updatedAt:new Date().toISOString(),source:'one-click'});}
      catch{return new Response(null,{status:503,headers:{...headers,'retry-after':'60'}});}
      return new Response(null,{status:200,headers});
    },
    routes(){return [{pattern:`${path}/:token`,handler:this.handle}];}
  };
}
export type EmailPreferenceService=ReturnType<typeof createEmailPreferenceService>;
