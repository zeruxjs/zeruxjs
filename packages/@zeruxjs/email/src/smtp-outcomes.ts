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
    const address=typeof value==='string'?value:typeof value==='object'&&value!==null&&'address' in value?(value as {address:unknown}).address:null;
    if(typeof address!=='string')return null;
    return addressString(validateEmailAddress(address)).toLowerCase();
  }catch{return null;}
}
/** Classifies one SMTP submission; never retries a potentially submitted message. */
export function classifySmtpAcceptance(
  intended:readonly EmailAddress[],
  result:{accepted?:unknown[];rejected?:unknown[]}
):SmtpAcceptance{
  const requested=new Set(intended.map(value=>addressString(validateEmailAddress(value)).toLowerCase()));
  const accepted=new Set<string>(),rejected=new Set<string>();
  let invalid=false;
  for(const [kind,items] of [['accepted',result.accepted],['rejected',result.rejected]] as const){
    if(items===undefined)continue;
    if(!Array.isArray(items)){invalid=true;continue;}
    for(const item of items){const key=normalized(item);
      if(!key||!requested.has(key)){invalid=true;continue;}
      (kind==='accepted'?accepted:rejected).add(key);
    }
  }
  const conflict=[...accepted].some(key=>rejected.has(key));
  const complete=!invalid&&!conflict&&[...requested].every(key=>accepted.has(key)||rejected.has(key));
  const warning:SmtpAcceptance['warning']=conflict?'conflicting-recipient':invalid?'unrecognized-recipient':
    !accepted.size&&!rejected.size?'unreported-outcome':!complete?'unreported-recipients':undefined;
  // Provider lists may not be complete; never guess at acceptance of an unlisted recipient.
  const status:SmtpAcceptanceStatus=!accepted.size&&!rejected.size?'unknown':
    !complete?'unknown':accepted.size===requested.size?'accepted':accepted.size?'partial':'rejected';
  return {status,accepted:[...accepted],rejected:[...rejected],complete,warning};
}

/** Safe operator-facing diagnostics. No credentials, recipient addresses, message bodies or responses. */
export function describeSmtpOutcome(value:SmtpAcceptance){
  return {status:value.status,acceptedCount:value.accepted.length,rejectedCount:value.rejected.length,complete:value.complete,warning:value.warning};
}
