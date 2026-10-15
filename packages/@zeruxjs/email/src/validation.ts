import type {EmailAddress, EmailRecipients, SmtpSettings, EmailMessage} from './types.js';

const badLine=/[\r\n\0]/;
const emailPattern=/^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+\.[^\s@<>\u0000-\u001f\u007f]+$/;
export function validateEmailAddress(input:EmailAddress):EmailAddress{
  const address=typeof input==='string'?input:input?.address;
  if(typeof address!=='string'||address.length>320||!emailPattern.test(address)||badLine.test(address))throw new TypeError('Invalid email address');
  if(typeof input!=='string'&&(typeof input.name!=='undefined'&&(typeof input.name!=='string'||input.name.length>200||badLine.test(input.name))))throw new TypeError('Invalid display name');
  return input;
}
export function recipientList(input?:EmailRecipients):EmailAddress[]{if(input===undefined)return [];const list=Array.isArray(input)?input:[input] as EmailAddress[];return list.map(validateEmailAddress);}
export function addressString(input:EmailAddress):string{return typeof input==='string'?input:input.address;}
export function validateSmtp(smtp:SmtpSettings){
  if(typeof smtp.host!=='string'||smtp.host.length>253||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(smtp.host))throw new TypeError('Invalid SMTP hostname');
  if(!Number.isSafeInteger(smtp.port)||smtp.port<1||smtp.port>65535)throw new RangeError('Invalid SMTP port');
  if(smtp.ignoreTLS===true)throw new TypeError('Ignoring TLS is unsafe for outbound SMTP');
  if(smtp.port===465&&smtp.secure===false)throw new TypeError('SMTP port 465 requires implicit TLS');
  if(smtp.secure!==true&&smtp.port!==465&&smtp.requireTLS===false)throw new TypeError('Disabling required STARTTLS is unsafe');
  if(smtp.tls?.minVersion!==undefined&&!['TLSv1.2','TLSv1.3'].includes(smtp.tls.minVersion))throw new TypeError('Invalid SMTP minimum TLS version');
  if(smtp.auth){const a=smtp.auth;if(!a.user||badLine.test(a.user))throw new TypeError('Invalid SMTP user');if(a.type==='password'){if(!a.pass)throw new TypeError('Missing SMTP password');}else if(a.type==='oauth2'){if(!a.accessToken&&!a.refreshToken&&!a.privateKey)throw new TypeError('Missing OAuth2 token source');}else throw new TypeError('Unsupported SMTP auth');}
  for(const timeout of [smtp.connectionTimeout,smtp.greetingTimeout,smtp.socketTimeout]){
    if(timeout!==undefined&&(!Number.isSafeInteger(timeout)||timeout<100||timeout>3_600_000))throw new RangeError('Invalid SMTP timeout');
  }
  if(smtp.dkim){
    if(!/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(smtp.dkim.domainName)||!/^[a-z0-9_-]{1,63}$/i.test(smtp.dkim.keySelector)||
      typeof smtp.dkim.privateKey!=='string'||smtp.dkim.privateKey.length<40)throw new TypeError('Invalid DKIM signing configuration');
  }
  if(smtp.maxConnections!==undefined&&(!Number.isSafeInteger(smtp.maxConnections)||smtp.maxConnections<1||smtp.maxConnections>100))throw new RangeError('Invalid SMTP pool size');
  if(smtp.tls?.rejectUnauthorized===false)throw new TypeError('Disabling SMTP certificate verification is unsafe');
}
export function validateMessage(message:EmailMessage,maxRecipients=100){
  const to=recipientList(message.to),cc=recipientList(message.cc),bcc=recipientList(message.bcc);
  if(!to.length)throw new TypeError('At least one To recipient required');
  if(to.length+cc.length+bcc.length>maxRecipients)throw new RangeError('Too many recipients');
  if(message.from)validateEmailAddress(message.from);
  if(message.replyTo)recipientList(message.replyTo);
  if(typeof message.subject!=='string'||message.subject.length>998||badLine.test(message.subject))throw new TypeError('Invalid message subject');
  if(!message.html&&!message.text&&!message.template)throw new TypeError('Email body or template required');
  if(message.headers){for(const [key,value] of Object.entries(message.headers)){if(!/^[a-zA-Z][a-zA-Z0-9-]{0,99}$/.test(key)||typeof value!=='string'||badLine.test(value))throw new TypeError('Invalid message headers');if(/^(bcc|cc|to|from|content-type|content-transfer-encoding|dkim-signature)$/i.test(key))throw new TypeError('Protected email header');}}
  if(message.idempotencyKey!==undefined&&(typeof message.idempotencyKey!=='string'||!/^[a-zA-Z0-9_:.@-]{1,150}$/.test(message.idempotencyKey)))throw new TypeError('Invalid idempotency key');
  if(message.attachments&&message.attachments.length>40)throw new RangeError('Too many attachments');
  return {to,cc,bcc};
}
