import type {MessageAuthenticatorOptions} from '@zeruxjs/security/crypto';
export class WebhookError extends Error {constructor(readonly code:string,cause?:unknown){super(`Webhook error (${code})`);this.name='WebhookError';if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}}
export const fail=(code:string,cause?:unknown)=>new WebhookError(code,cause);
export function id(value:unknown):asserts value is string {if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))throw fail('INVALID_REFERENCE');}
export function number(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw fail('INVALID_LIMIT');return value;}
export function fields(value:unknown,allowed:readonly string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!allowed.includes(key))||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!('value'in d)))throw fail('INVALID_INPUT');}
export function bodyJSON(value:unknown):string {
 let nodes=0,chars=0;const seen=new Set<object>();
 const copy=(v:unknown,depth:number):any=>{if(++nodes>8192||depth>16)throw fail('BODY_LIMIT');if(typeof v==='string'){chars+=v.length;if(chars>65536)throw fail('BODY_LIMIT');return v;}if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
 if(!v||typeof v!=='object'||seen.has(v)||![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(v)))throw fail('INVALID_BODY');const keys=Object.keys(v);if(keys.length>8192||Array.isArray(v)&&(v.length>8192||keys.length!==v.length||keys.some((key,i)=>key!==String(i))))throw fail('BODY_LIMIT');seen.add(v);const out:any=Array.isArray(v)?[]:{};for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key)!;if(['__proto__','constructor','prototype'].includes(key)||!('value'in d))throw fail('INVALID_BODY');chars+=key.length;if(chars>65536)throw fail('BODY_LIMIT');out[key]=copy(d.value,depth+1);}seen.delete(v);return out;};
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('INVALID_BODY');const body=JSON.stringify(copy(value,0));if(Buffer.byteLength(body)>65536)throw fail('BODY_LIMIT');return body;
}
export type WebhookState='pending'|'sending'|'delivered'|'uncertain'|'dead';
export interface WebhookReference {tenant:string;deliveryId:string}
export interface WebhookInput extends WebhookReference {eventId:string;destination:string;schemaVersion:number;payload:Record<string,unknown>}
export interface WebhookAttempt {at:number;durationMs:number;outcome:WebhookState;code:string;httpStatus?:number}
export interface WebhookRecord extends WebhookReference {
 contract:1;eventId:string;destination:string;schemaVersion:number;body:string;bodyHash:string;
 revision:number;state:WebhookState;attempts:number;createdAt:number;updatedAt:number;nextAt:number;
 lease:null|{token:string;until:number};history:WebhookAttempt[];
}
/** Host-owned linearizable durable CAS. Methods must scope every key/condition to tenant+deliveryId. */
export interface WebhookStore {
 readonly contract:'webhook-cas-v1';
 get(reference:WebhookReference):Promise<WebhookRecord|null>;
 cas(reference:WebhookReference,revision:number,next:WebhookRecord):Promise<boolean>;
 /** Ordered, finite refs: pending due records and expired sending leases only. */
 due(tenant:string,now:number,cursor:string|null,limit:number):Promise<{ids:string[];next:string|null}>;
}
export interface WebhookDestination {tenant:string;ref:string;url:string;enabled:true;consumerIdempotency:true;keys:MessageAuthenticatorOptions}
export interface WebhookResponse {status:number;retryAfter?:string}
export interface WebhookTransport {
 readonly contract:'webhook-https-v1';
 validate(url:string):void;
 send(request:{url:string;body:string;headers:Record<string,string>;signal:AbortSignal;timeoutMs:number}):Promise<WebhookResponse>;
}
export interface WebhookQueuePublisher {
 readonly acknowledged:true;readonly destructiveRead:false;
 publish(reference:WebhookReference):Promise<unknown>;
}
export interface WebhookPolicy {maxAttempts:number;maxAgeMs:number;baseDelayMs:number;maxDelayMs:number;retryAfterMaxMs:number;transientStatuses:readonly number[];retryNotSent:boolean}
