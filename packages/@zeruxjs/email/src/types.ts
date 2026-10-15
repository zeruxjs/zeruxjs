import type { Readable } from 'node:stream';

export type EmailAddress = string | { name?:string; address:string };
export type EmailRecipients = EmailAddress | readonly EmailAddress[];
export interface MailAttachment {
  filename: string; content?: string | Uint8Array | Readable; path?: string; cid?: string;
  contentType?: string; contentDisposition?: 'attachment'|'inline'; encoding?:string;
  /** File-address attachment resolved through @zeruxjs/files; manager must be explicitly supplied. */
  file?: {storage?:string; bucket:string; key:string};
}
export interface EmailMessage {
  from?:EmailAddress; to:EmailRecipients; cc?:EmailRecipients; bcc?:EmailRecipients; replyTo?:EmailRecipients;
  subject:string; text?:string; html?:string; amp?:string;
  template?:string; data?:Record<string,unknown>;
  attachments?:MailAttachment[];
  headers?:Record<string,string>; listUnsubscribe?:{url?:string;email?:string};
  priority?:'high'|'normal'|'low';
  /** Must be explicit for marketing; an account default cannot silently mark mail as marketing. */
  purpose?:'transactional'|'marketing';
  /** Explicit account; if absent use manager default. */
  account?:string;
  /** Prevent accidental duplicate sends within a manager lifetime. */
  idempotencyKey?:string;
  /** Mail tags are internal metadata: never forwarded as headers. */
  tags?:readonly string[];
  /** Opt-in per message; opens are approximate because email clients proxy and preload images. */
  tracking?: {enabled?:boolean;opens?:boolean;clicks?:boolean;downloads?:boolean;downloadLinks?:readonly string[];campaign?:string};
}
export interface SmtpAuthPassword {type:'password';user:string;pass:string}
export interface SmtpAuthOAuth2 {type:'oauth2';user:string;clientId?:string;clientSecret?:string;refreshToken?:string;accessToken?:string;expires?:number;accessUrl?:string;serviceClient?:string;privateKey?:string}
export type SmtpAuth = SmtpAuthPassword | SmtpAuthOAuth2;
export interface SmtpSettings {
  host:string;port:number;secure?:boolean;requireTLS?:boolean;ignoreTLS?:boolean;
  auth?:SmtpAuth; pool?:boolean;maxConnections?:number;maxMessages?:number;
  connectionTimeout?:number;greetingTimeout?:number;socketTimeout?:number;
  tls?: {servername?:string;minVersion?:'TLSv1.2'|'TLSv1.3';rejectUnauthorized?:boolean;ca?:string|string[]};
  /** Nodemailer DKIM signing; keep the private key in your secret manager. */
  dkim?: {domainName:string;keySelector:string;privateKey:string;cacheDir?:string};
}
export interface TransportLike {
  sendMail(mail:Record<string,unknown>):Promise<{messageId?:string;accepted?:unknown[];rejected?:unknown[];response?:string}>;
  verify?():Promise<boolean>;
  close?():void|Promise<void>;
}
export interface EmailAccount {name:string; smtp?:SmtpSettings;transport?:TransportLike;
  /** Optional incoming side of this logical account, started through ZeruxJS email.receive. */
  receive?:Omit<import('./inbound.js').IncomingAccount,'name'>;
  defaults?:Partial<EmailMessage>;maxRecipients?:number;enabled?:boolean}
export interface EmailResult {account:string;messageId?:string;accepted:string[];rejected:string[];response?:string;skipped?:boolean;reason?:string;trackingId?:string;
  /** SMTP envelope result only; not evidence of delivery or inbox placement. */
  submissionStatus?:'accepted'|'partial'|'rejected'|'unknown';acceptanceComplete?:boolean}
export interface EmailManagerOptions {
  accounts:EmailAccount[];defaultAccount?:string;maxRecipients?:number;
  /** Globally suppress blocked recipients. Local memory; persist separately if needed. */
  suppressions?:string[];
  rules?:RecipientRule[];
  /** Called before every send, fail closed. Integrate @zeruxjs/auth here. */
  authorize?:(message:Readonly<EmailMessage>,account:string)=>boolean|Promise<boolean>;
  /** Optional @zeruxjs/files StorageManager; attachments are streamed, not buffered. */
  files?:{ stat(addr:{storage?:string;bucket:string;key:string}):Promise<{size:number;contentType:string}|null>;read(addr:{storage?:string;bucket:string;key:string}):Promise<AsyncIterable<Uint8Array>>};
  maxAttachmentBytes?:number;idempotencyTtlMs?:number;maxIdempotencyKeys?:number;
  /** Optional @zeruxjs/analytics tracking service; this interface avoids a hard dependency. */
  tracking?: {instrumentHtml(html:string,context:{id:string;account:string;message:Readonly<EmailMessage>}):string|Promise<string>;
    onSent?(event:{id:string;account:string;message:Readonly<EmailMessage>;result:Readonly<EmailResult>}):void|Promise<void>};
  /** Optional service with explicit opt-in and unsubscribe; required for marketing delivery. */
  /** Independent durable bounce/complaint suppression check; required by host for campaign sends. */
  marketingSuppression?:{isSuppressed(address:EmailAddress):Promise<boolean>};
  preferences?:{
    isSubscribed(address:EmailAddress):Promise<boolean>;
    makeUnsubscribeUrl(address:EmailAddress):string;
  };
  /** Shared, provider-neutral account reputation guard. Marketing blocks on read errors. */
  reputation?: {
    checkBeforeSend:(account:string,purpose:'marketing'|'transactional')=>Promise<{allowed:boolean}>;
    recordAccepted:(account:string,email:string,messageId:string)=>Promise<boolean|unknown>;
  };
  /** PII-free diagnostic callback. A resolved SMTP call with unknown recipients is not a confirmed acceptance. */
  onSmtpWarning?:(warning:{account:string;status:'accepted'|'partial'|'rejected'|'unknown';reason:string})=>void;
  onReputationError?:(error:unknown)=>void;
  onTrackingError?:(error:unknown)=>void;
}
export interface RecipientRule {action:'allow'|'block';pattern:string;reason?:string;account?:string}
export interface EmailTemplate {id:string;subject:string;html?:string;text?:string;description?:string;layout?:'default'|'none'}
