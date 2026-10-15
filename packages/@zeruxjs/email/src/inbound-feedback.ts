import {createHash} from 'node:crypto';
import type {InboundMessage} from './inbound.js';

export interface IncomingDeliveryNotice {
  id:string;inboundMessageId:string;recipient:string;
  kind:'hard-bounce'|'soft-bounce'|'complaint';
  /** Only a hint extracted from an untrusted inbound email, not a verified provider notification. */
  verified:false;
}
/**
 * Extract a conservative DSN/ARF candidate from received email text.
 * Never automatically trust or apply email-derived bounce/complaint claims:
 * forged DSNs can suppress arbitrary recipients without independent verification.
 */
export function classifyIncomingDeliveryNotice(message:InboundMessage):IncomingDeliveryNotice|null{
  if(!message||typeof message.text!=='string'||!message.text||message.text.length>24_000)return null;
  const text=message.text;
  const candidate=/^Final-Recipient:\s*rfc822\s*;\s*([^\s;]+)\s*$/im.exec(text);
  if(!candidate)return null;
  const recipient=candidate[1].toLowerCase();
  if(recipient.length>320||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient))return null;
  const code=/^Status:\s*([245])\.\d{1,3}\.\d{1,3}\s*$/im.exec(text)?.[1];
  const action=/^Action:\s*(failed|delayed)\s*$/im.exec(text)?.[1]?.toLowerCase();
  const reportType=/^Feedback-Type:\s*abuse\s*$/im.test(text);
  const kind=reportType?'complaint':code==='5'&&action==='failed'?'hard-bounce':code==='4'&&action==='delayed'?'soft-bounce':null;
  if(!kind)return null;
  return {id:createHash('sha256').update(message.id+'\0'+recipient+'\0'+kind).digest('hex'),inboundMessageId:message.id,recipient,kind,verified:false};
}
/** Separate trust boundary: host must validate the actual sender and provider metadata. */
export function createTrustedInboundFeedbackProcessor(options:{
  verify:(message:InboundMessage,notice:IncomingDeliveryNotice)=>boolean|Promise<boolean>;
  record:(notice:Omit<IncomingDeliveryNotice,'verified'>&{verified:true})=>Promise<unknown>;
}){
  if(!options||typeof options.verify!=='function'||typeof options.record!=='function')throw new TypeError('Feedback verifier and ledger required');
  return async(message:InboundMessage)=>{
    const candidate=classifyIncomingDeliveryNotice(message);if(!candidate)return {classified:false,recorded:false};
    if(await options.verify(message,candidate)!==true)return {classified:true,recorded:false};
    await options.record({...candidate,verified:true});return {classified:true,recorded:true};
  };
}
