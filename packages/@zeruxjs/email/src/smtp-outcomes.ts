import {addressString,validateEmailAddress} from './validation.js';
import type {EmailAddress} from './types.js';

/** SMTP server acceptance is not evidence of provider delivery or inbox placement. */
export type SmtpAcceptanceStatus = 'accepted'|'partial'|'rejected'|'unknown';
export interface SmtpAcceptance {
  status:SmtpAcceptanceStatus;
  accepted:string[];
  rejected:string[];
  /** True only if the provider's returned envelope accounts for every intended recipient. */
  complete:boolean;
  /** No addresses or transport responses appear in diagnostic reason codes. */
  warning?:'unreported-recipients'|'unrecognized-recipient'|'conflicting-recipient'|'unreported-outcome';
}
function normalized(value:unknown):string|null{
  try{
    const address=(typeof value==='string')?value:(((typeof value==='object')&&(value!==null))&&('address' in value))?(value as {address:unknown}).address:null;
    if(typeof address!=='string')return null;
    return addressString(validateEmailAddress(address)).toLowerCase();
  }catch{return null;}
}
/** Classifies one SMTP submission; never retries a potentially submitted message. */
export function classifySmtpAcceptance(
  intended:readonly EmailAddress[],
  result:{accepted?:unknown[];rejected?:unknown[]}
):SmtpAcceptance{
  if((!Array.isArray(intended)||!intended.length)||(intended.length>1000))throw new RangeError('Invalid SMTP recipient count');
  const requested=new Set(intended.map(value=>addressString(validateEmailAddress(value)).toLowerCase()));
  const accepted=new Set<string>(),rejected=new Set<string>();
  let invalid=false;
  for(const [kind,items] of [['accepted',result.accepted],['rejected',result.rejected]] as const){
    if(items===undefined)continue;
    if(!Array.isArray(items)){invalid=true;continue;}
    if(items.length>1000)invalid=true;
    for(const item of items.slice(0,1000)){const key=normalized(item);
      if(!key||!requested.has(key)){invalid=true;continue;}
      ((kind==='accepted')?accepted:rejected).add(key);
    }
  }
  const conflict=[...accepted].some(key=>rejected.has(key));
  const complete=(!invalid&&!conflict)&&[...requested].every(key=>accepted.has(key)||rejected.has(key));
  const warning:SmtpAcceptance['warning']=conflict?'conflicting-recipient':invalid?'unrecognized-recipient':
    (!accepted.size&&!rejected.size)?'unreported-outcome':!complete?'unreported-recipients':undefined;
  // Provider lists may not be complete; never guess at acceptance of an unlisted recipient.
  const status:SmtpAcceptanceStatus=(!accepted.size&&!rejected.size)?'unknown':
    !complete?'unknown':(accepted.size===requested.size)?'accepted':accepted.size?'partial':'rejected';
  return {status,accepted:[...accepted],rejected:[...rejected],complete,warning};
}

/** Safe operator-facing diagnostics. No credentials, recipient addresses, message bodies or responses. */
export function describeSmtpOutcome(value:SmtpAcceptance){
  return {status:value.status,acceptedCount:value.accepted.length,rejectedCount:value.rejected.length,complete:value.complete,warning:value.warning};
}

export interface SmtpRecipientOutcome {
 recipient:string;status:'accepted'|'rejected'|'transient'|'permanent'|'uncertain';
 retryable:boolean;responseCode?:number;
}
const responseCode=(value:unknown)=>((((typeof value==='number')&&Number.isInteger(value))&&(value>=400))&&(value<=599))?value:undefined;
/** Envelope lists on a fulfilled submission describe SMTP acceptance, never inbox delivery. */
export function classifySmtpRecipients(intended:readonly EmailAddress[],result:{accepted?:unknown[];rejected?:unknown[];rejectedErrors?:unknown[]}):SmtpRecipientOutcome[]{
 const aggregate=classifySmtpAcceptance(intended,result),accepted=new Set(aggregate.accepted),rejected=new Set(aggregate.rejected);
 const errors=new Map<string,number>();if(Array.isArray(result.rejectedErrors))for(const raw of result.rejectedErrors.slice(0,1000)){const e=raw as {recipient?:unknown;responseCode?:unknown};const recipient=normalized(e?.recipient),code=responseCode(e?.responseCode);if(recipient&&code)errors.set(recipient,code);}
 return [...new Set(intended.map(value=>addressString(validateEmailAddress(value)).toLowerCase()))].map(recipient=>{if(accepted.has(recipient)&&!rejected.has(recipient))return {recipient,status:'accepted',retryable:false};if(rejected.has(recipient)&&!accepted.has(recipient)){const code=errors.get(recipient);return {recipient,status:code?(code<500)?'transient':'permanent':'rejected',retryable:(code!==undefined)&&(code<500),...(code?{responseCode:code}:{})};}return {recipient,status:'uncertain',retryable:false};});
}
/** Only explicit negative SMTP replies or known pre-DATA connection phases permit retry. */
export function isRetryableSmtpError(error:unknown):boolean {
 if(error instanceof EmailSubmissionError)return (error.code!=='EMAIL_SMTP_UNCERTAIN')&&error.safeRetry;
 const e=error as {code?:unknown;command?:unknown;responseCode?:unknown};const code=responseCode(e?.responseCode);if(code!==undefined)return code<500;
 return ['CONN','CONNECT','EHLO','HELO','STARTTLS','AUTH','MAIL FROM','RCPT TO'].includes(String(e?.command??'').toUpperCase())&&['ECONNECTION','ETIMEDOUT','ESOCKET','ECONNRESET','EAI_AGAIN','ECONNREFUSED'].includes(String(e?.code??''));
}
export class EmailSubmissionError extends Error {
 readonly outcomes!:readonly SmtpRecipientOutcome[];
 constructor(readonly code:string,intended:readonly EmailAddress[],cause:unknown,readonly safeRetry=false,readonly responseCode?:number){
  super(`Email submission failed (${code})`);this.name='EmailSubmissionError';Object.defineProperty(this,'cause',{value:cause});
  const status=(code==='EMAIL_SMTP_UNCERTAIN')?'uncertain':responseCode?((responseCode<500)?'transient':'permanent'):safeRetry?'transient':'rejected';
  Object.defineProperty(this,'outcomes',{enumerable:false,writable:false,configurable:false,value:Object.freeze([...new Set(intended.map(v=>addressString(validateEmailAddress(v)).toLowerCase()))].map(recipient=>Object.freeze({recipient,status,retryable:safeRetry,...(responseCode?{responseCode}:{})})))});
 }
}
/** Error causes/recipient detail stay private; use this bounded projection for telemetry. */
export function describeSmtpRecipients(outcomes:readonly SmtpRecipientOutcome[]){const counts={accepted:0,rejected:0,transient:0,permanent:0,uncertain:0};for(const item of outcomes)if(Object.hasOwn(counts,item.status))counts[item.status]++;return counts;}
export function smtpSubmissionFailure(intended:readonly EmailAddress[],cause:unknown):EmailSubmissionError {
 const e=cause as {responseCode?:unknown};const code=responseCode(e?.responseCode),safeRetry=isRetryableSmtpError(cause);
 return new EmailSubmissionError(code?'EMAIL_SMTP_REJECTED':safeRetry?'EMAIL_SMTP_NOT_SENT':'EMAIL_SMTP_UNCERTAIN',intended,cause,safeRetry,code);
}
