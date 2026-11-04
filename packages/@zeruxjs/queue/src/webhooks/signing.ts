import {createMessageAuthenticator,type MessageAuthenticatorOptions} from '@zeruxjs/security/crypto';
import {fail,id,number} from './contracts.js';
const context=(tenant:string,destination:string,deliveryId:string,timestamp:number)=>JSON.stringify(['zerux.webhook.v1',tenant,destination,deliveryId,timestamp]);
export function signWebhook(input:{tenant:string;destination:string;deliveryId:string;timestamp:number;body:string},keys:MessageAuthenticatorOptions){
 id(input.tenant);id(input.destination);id(input.deliveryId);number(input.timestamp,0,8640000000000);if(typeof input.body!=='string'||Buffer.byteLength(input.body)>65536)throw fail('BODY_LIMIT');
 const mac=createMessageAuthenticator({...keys,maxBytes:65536});try{const signature=mac.sign(input.body,context(input.tenant,input.destination,input.deliveryId,input.timestamp));return {'x-zerux-webhook-id':input.deliveryId,'x-zerux-webhook-timestamp':String(input.timestamp),'x-zerux-webhook-signature':`v1.${signature.kid}.${signature.tag}`};}finally{mac.destroy();}
}
/** Verify exact bytes before a host's durable, transactionally coordinated replay/idempotency claim. */
export function verifyWebhook(input:{tenant:string;destination:string;deliveryId:string;timestamp:string;signature:string;body:string},keys:MessageAuthenticatorOptions,options:{now?:number;maxAgeMs?:number}={}):boolean{
 try{id(input.tenant);id(input.destination);id(input.deliveryId);const now=number(options.now??Date.now(),0,8640000000000000),age=number(options.maxAgeMs??300000,1,3600000);if(typeof input.timestamp!=='string'||!/^\d{1,13}$/.test(input.timestamp)||typeof input.signature!=='string'||input.signature.length>160||typeof input.body!=='string'||Buffer.byteLength(input.body)>65536)return false;
 const timestamp=number(Number(input.timestamp),0,8640000000000);if(timestamp*1000>now||now-timestamp*1000>age)return false;const parts=/^v1\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{43})$/.exec(input.signature);if(!parts)return false;
 const mac=createMessageAuthenticator({...keys,maxBytes:65536});try{return mac.verify(input.body,{v:1,alg:'HS256',kid:parts[1],tag:parts[2]},context(input.tenant,input.destination,input.deliveryId,timestamp));}finally{mac.destroy();}
 }catch{return false;}
}
export interface WebhookReplayStore {
 readonly contract:'webhook-replay-v1';
 /** Linearizable unique claim, scoped to tenant+destination+deliveryId, retained through expiresAt.
  * The receiver must coordinate this with its durable business/idempotency transaction. */
 consume(scope:{tenant:string;destination:string;deliveryId:string;expiresAt:number}):Promise<boolean>;
}
export async function verifyAndConsumeWebhook(input:Parameters<typeof verifyWebhook>[0],keys:MessageAuthenticatorOptions,replay:WebhookReplayStore,options:{now?:number;maxAgeMs?:number;retentionMs:number}):Promise<'verified'|'duplicate'|'invalid'>{
 if(replay?.contract!=='webhook-replay-v1'||typeof replay.consume!=='function')throw fail('REPLAY_STORE_REQUIRED');const retention=number(options.retentionMs,1000,30*86400000),now=options.now??Date.now();if(!verifyWebhook(input,keys,options))return 'invalid';try{const claimed=await replay.consume({tenant:input.tenant,destination:input.destination,deliveryId:input.deliveryId,expiresAt:now+retention});if(typeof claimed!=='boolean')throw fail('REPLAY_STORE_FAILED');return claimed?'verified':'duplicate';}catch(cause){throw fail('REPLAY_STORE_FAILED',cause);}
}
