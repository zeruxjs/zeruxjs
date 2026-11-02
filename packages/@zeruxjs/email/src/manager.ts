import {createHash,randomUUID} from 'node:crypto';
import {classifySmtpRecipients,EmailSubmissionError,smtpSubmissionFailure,classifySmtpAcceptance} from './smtp-outcomes.js';
import type {EmailAccount, EmailAddress, EmailManagerOptions, EmailMessage, EmailResult, SmtpAuth, TransportLike} from './types.js';
import {validateEmailAddress,validateMessage,validateSmtp,recipientList,addressString} from './validation.js';
import {createRecipientFilter} from './filters.js';
import {createTemplateRegistry} from './templates.js';
import {convertHtmlToEmail,plainTextFromHtml} from './html.js';
import {resolveAttachmentScope,type AttachmentScope} from './attachments.js';

function toTransportConfig(account:EmailAccount):Record<string,unknown>{
  const smtp=account.smtp!;
  const auth:SmtpAuth|undefined=smtp.auth;
  return {
    host:smtp.host,port:smtp.port,secure:smtp.secure??smtp.port===465,
    requireTLS:smtp.requireTLS??(smtp.secure!==true&&smtp.port!==465),ignoreTLS:smtp.ignoreTLS??false,
    pool:smtp.pool??false,maxConnections:smtp.maxConnections??5,maxMessages:smtp.maxMessages??100,
    connectionTimeout:smtp.connectionTimeout??10000,greetingTimeout:smtp.greetingTimeout??10000,socketTimeout:smtp.socketTimeout??30000,
    tls:{minVersion:'TLSv1.2',rejectUnauthorized:true,...smtp.tls},
    ...(auth?{auth:auth.type==='password'?{user:auth.user,pass:auth.pass}:{...auth,type:'OAuth2'}}:{}),
    ...(smtp.dkim?{dkim:{...smtp.dkim}}:{})
  };
}
function redactResult(value:{messageId?:string;accepted?:unknown[];rejected?:unknown[];response?:string},account:string):EmailResult {
  const asAddresses=(values?:unknown[])=>Array.isArray(values)?values.map(v=>String(v).slice(0,320)):[];
  return {account,messageId:value.messageId,accepted:asAddresses(value.accepted),rejected:asAddresses(value.rejected),response:value.response};
}
function unsubscribeHeaders(value:EmailMessage['listUnsubscribe']):Record<string,string>{
  if(!value)return {};
  const targets:string[]=[];
  if(value.url){const url=new URL(value.url);if(url.protocol!=='https:'||url.username||url.password||url.href.length>2048)throw new TypeError('HTTPS unsubscribe URL required');targets.push(`<${url.href}>`);}
  if(value.email){validateEmailAddress(value.email);targets.push(`<mailto:${value.email}>`);}
  if(!targets.length)throw new TypeError('Unsubscribe target required');
  return {'List-Unsubscribe':targets.join(', '),...(value.url?{'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}:{})};
}
function fingerprintSend(message:EmailMessage,opts:EmailSendOptions):string{
  const {signal:_signal,timeoutMs:_timeout,deadline:_deadline,...fingerprintOptions}=opts;
  const seen=new WeakSet<object>();
  let encoded:string;
  try{encoded=JSON.stringify({message,opts:fingerprintOptions},(_key,value)=>{
    if(typeof value==='function'||typeof value==='symbol'||typeof value==='bigint')throw new TypeError('Non-serializable idempotent email');
    if(typeof value==='object'&&value!==null){
      if(seen.has(value))throw new TypeError('Repeated/cyclic object in idempotent email');
      seen.add(value);
      if(typeof value.pipe==='function'||typeof value.getReader==='function')throw new TypeError('Stream attachments require durable external idempotency');
      if(!Array.isArray(value)&&!(value instanceof Uint8Array)&&!Buffer.isBuffer(value)){
        return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
      }
    }
    return value;
  })!;}catch(error){throw Object.assign(new TypeError('Idempotent email must use serializable payloads'),{cause:error});}
  if(encoded.length>1_000_000)throw new RangeError('Idempotency fingerprint payload exceeds limit');
  return createHash('sha256').update(encoded).digest('hex');
}
function snapshotMessage(message:EmailMessage,maxBytes:number):EmailMessage {
  if(!message||typeof message!=='object')throw new TypeError('Invalid email message');
  const address=(value:EmailAddress)=>typeof value==='string'?value:{...value};
  const recipients=(value:EmailMessage['to']|undefined)=>value===undefined?undefined:recipientList(value).map(address);
  let bytes=0;const attachments=message.attachments?.map(a=>{let content=a.content;if(content instanceof Uint8Array){bytes+=content.byteLength;if(bytes>maxBytes)throw new RangeError('Attachments exceed aggregate limit');content=Buffer.from(content);}return {...a,...(a.file?{file:{...a.file}}:{}),...(content!==undefined?{content}:{})};});
  return {...message,...(message.from?{from:address(message.from)}:{}),to:recipients(message.to)??[],cc:recipients(message.cc),bcc:recipients(message.bcc),replyTo:recipients(message.replyTo),...(message.headers?{headers:{...message.headers}}:{}),...(message.listUnsubscribe?{listUnsubscribe:{...message.listUnsubscribe}}:{}),...(message.tracking?{tracking:{...message.tracking,...(message.tracking.downloadLinks?{downloadLinks:[...message.tracking.downloadLinks]}:{})}}:{}),...(attachments?{attachments}:{})};
}
export interface EmailSendOptions {
  signal?:AbortSignal;timeoutMs?:number;deadline?:number;
  htmlMode?:'email'|'trusted';allowLocalAttachmentPaths?:boolean;
  /** Overrides per-message tracking for this send. false always disables all tracking. */
  tracking?:boolean|NonNullable<EmailMessage['tracking']>;
}
export function createEmailManager(options:EmailManagerOptions){
  if(!options?.accounts?.length||options.accounts.length>64)throw new TypeError('At least one email connection required');
  const accounts=new Map<string,EmailAccount>();
  for(const account of options.accounts){
    if(!/^[a-z][a-z0-9_-]{0,63}$/.test(account?.name)||accounts.has(account.name))throw new TypeError('Invalid or duplicate email account name');
    if(Boolean(account.smtp)===Boolean(account.transport))throw new TypeError('Choose SMTP settings or injected transport');
    if(account.ownTransport!==undefined&&typeof account.ownTransport!=='boolean')throw new TypeError('Invalid transport ownership');
    if(account.smtp)validateSmtp(account.smtp);
    if(account.defaults?.from)validateEmailAddress(account.defaults.from);
    accounts.set(account.name,account);
  }
  const fallback=options.defaultAccount??options.accounts[0].name;
  if(!accounts.has(fallback))throw new Error('Unknown default email account');
  const limit=options.maxRecipients??100;
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new RangeError('Invalid recipient limit');
  const filter=createRecipientFilter(options.rules,options.suppressions);
  const templates=createTemplateRegistry();
  const created=new Map<string,Promise<TransportLike>>();
  const completed=new Map<string,{until:number;result?:EmailResult;error?:EmailSubmissionError;fingerprint:string}>();
  const pending=new Map<string,{task:Promise<EmailResult>;fingerprint:string;context:SendContext}>();
  const maxKeys=options.maxIdempotencyKeys??2000,ttl=options.idempotencyTtlMs??5*60_000;
  if(!Number.isSafeInteger(maxKeys)||maxKeys<1||maxKeys>100000||!Number.isSafeInteger(ttl)||ttl<1||ttl>86_400_000)throw new RangeError('Invalid idempotency policy');
  const maxSends=options.maxConcurrentSends??8,defaultTimeout=options.sendTimeoutMs??30000;
  if(!Number.isSafeInteger(maxSends)||maxSends<1||maxSends>128||!Number.isSafeInteger(defaultTimeout)||defaultTimeout<1||defaultTimeout>600000)throw new RangeError('Invalid send execution limits');
  interface SendContext {name:string;signal:AbortSignal;controller:AbortController;submitted:boolean;intended:EmailAddress[];known?:EmailResult;attachments?:AttachmentScope;check():void}
  const jobs=new Set<Promise<EmailResult>>(),verifications=new Map<Promise<boolean>,{name:string;controller:AbortController}>(),contexts=new Set<SendContext>(),released=new WeakSet<object>();
  let closed=false,closing:Promise<void>|undefined;
  async function release(name:string,transport:TransportLike){if(accounts.get(name)?.ownTransport===false||released.has(transport))return;released.add(transport);await transport.close?.();}
  function remember(key:string,fingerprint:string,result?:EmailResult,error?:EmailSubmissionError){for(const [old,item] of completed)if(item.until<=Date.now())completed.delete(old);if(!completed.has(key)&&completed.size>=maxKeys)completed.delete(completed.keys().next().value!);completed.set(key,{until:Date.now()+ttl,result,error,fingerprint});}
  let waiters=0;
  async function observeShared(running:{task:Promise<EmailResult>;context:SendContext},settings:EmailSendOptions){
    if(waiters>=Math.min(maxSends*4,512))throw Object.assign(new Error('Email waiter capacity exceeded'),{code:'EMAIL_SEND_OVERLOAD'});
    const ms=settings.timeoutMs??defaultTimeout;if(!Number.isSafeInteger(ms)||ms<1||ms>600000||settings.signal!==undefined&&!(settings.signal instanceof AbortSignal)||settings.deadline!==undefined&&(!Number.isSafeInteger(settings.deadline)||settings.deadline<0||settings.deadline>Date.now()+600000))throw new TypeError('Invalid send deadline/signal');
    waiters++;let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
    try{const stopped=new Promise<EmailResult>((resolve,reject)=>{abort=()=>{if(running.context.known)resolve({...running.context.known,telemetryIncomplete:true});else reject(new EmailSubmissionError('EMAIL_SMTP_UNCERTAIN',running.context.intended,new Error('Shared email observation cancelled or expired')));};settings.signal?.addEventListener('abort',abort,{once:true});if(settings.signal?.aborted)abort();timer=setTimeout(abort,Math.max(1,Math.min(Date.now()+ms,settings.deadline??Infinity)-Date.now()));});return await Promise.race([running.task,stopped]);}
    finally{waiters--;if(timer)clearTimeout(timer);settings.signal?.removeEventListener('abort',abort);}
  }
  async function transporter(name:string):Promise<TransportLike>{
    if(closed)throw new Error('Email manager closed');
    const account=accounts.get(name);if(!account)throw new Error('Unknown email account');
    if(account.transport&&released.has(account.transport))throw Object.assign(new Error('Owned email transport was released; provide a new handle'),{code:'EMAIL_TRANSPORT_RELEASED'});
    if(account.enabled===false)throw new Error(`Email account disabled: ${name}`);
    let current=created.get(name);
    if(!current){current=account.transport?Promise.resolve(account.transport):import('nodemailer').then(({default:nm})=>nm.createTransport(toTransportConfig(account)) as TransportLike);
      created.set(name,current);current.catch(()=>{if(created.get(name)===current)created.delete(name);});}
    return current;
  }
  async function doSend(message:EmailMessage,name:string,sendOpts:EmailSendOptions,context:SendContext):Promise<EmailResult>{
    context.check();
    const account=accounts.get(name)!;
    const merged:EmailMessage={...account.defaults,...message,account:name};
    // Tracking may only be enabled explicitly on THIS send, never silently through account defaults.
    const policy=sendOpts.tracking===false?{enabled:false}:sendOpts.tracking===true?{enabled:true}:
      sendOpts.tracking?{...sendOpts.tracking}:
      message.tracking?{...message.tracking}:{enabled:false};
    merged.tracking={enabled:policy.enabled===true,opens:policy.opens,clicks:policy.clicks,downloads:policy.downloads,downloadLinks:policy.downloadLinks,campaign:policy.campaign};
    const trackingEnabled=merged.tracking.enabled===true;
    const marketing=message.purpose==='marketing';
    if(message.purpose!==undefined&&!['marketing','transactional'].includes(message.purpose))throw new TypeError('Invalid email purpose');
    // Account defaults may not silently turn transactional sends into marketing campaigns.
    merged.purpose=marketing?'marketing':'transactional';
    function warnTracking(error:unknown){try{options.onTrackingError?.(error);}catch{/* logging must not break delivery */}}

    if(merged.template){const render=templates.render(merged.template,merged.data);merged.subject=merged.subject||render.subject;merged.html=merged.html??render.html;merged.text=merged.text??render.text;}
    const {to,cc,bcc}=validateMessage(merged,Math.min(limit,account.maxRecipients??limit));
    context.intended=[...to,...cc,...bcc];
    if(!merged.from)throw new TypeError(`Email account ${name} requires a From address`);
    if(options.authorize&&await options.authorize(merged,name)!==true)throw Object.assign(new Error('Email delivery not authorized'),{code:'EMAIL_FORBIDDEN'});
    context.check();
    for(const recipient of [...to,...cc,...bcc]){
      const evaluation=filter.evaluate(recipient,name);
      if(evaluation.rejected.length)throw Object.assign(new Error(`Recipient rejected: ${evaluation.rejected[0].reason}`),{code:'EMAIL_FILTERED'});
    }
    if(marketing){
      if(cc.length||bcc.length||to.length!==1)throw Object.assign(new Error('Marketing delivery requires exactly one To recipient and no Cc/Bcc'),{code:'EMAIL_MARKETING_RECIPIENTS'});
      if(!options.preferences)throw Object.assign(new Error('Marketing consent service unavailable'),{code:'EMAIL_CONSENT_UNAVAILABLE'});
      // Fail closed when the consent database cannot be read; do not deliver without consent.
      let subscribed=false;
      try{subscribed=await options.preferences.isSubscribed(to[0]);}
      catch{throw Object.assign(new Error('Marketing consent lookup unavailable'),{code:'EMAIL_CONSENT_UNAVAILABLE'});}
      context.check();
      if(typeof subscribed!=='boolean')throw Object.assign(new Error('Invalid marketing consent state'),{code:'EMAIL_CONSENT_UNAVAILABLE'});
      if(subscribed!==true)throw Object.assign(new Error('Recipient has not opted into marketing'),{code:'EMAIL_CONSENT_REQUIRED'});
      if(options.marketingSuppression){
        let blocked;try{blocked=await options.marketingSuppression.isSuppressed(to[0]);}
        catch{throw Object.assign(new Error('Marketing suppression unavailable'),{code:'EMAIL_SUPPRESSION_UNAVAILABLE'});}
        if(typeof blocked!=='boolean')throw Object.assign(new Error('Invalid marketing suppression state'),{code:'EMAIL_SUPPRESSION_UNAVAILABLE'});
        if(blocked)throw Object.assign(new Error('Recipient suppressed from marketing'),{code:'EMAIL_SUPPRESSED'});
      }
      merged.listUnsubscribe={...merged.listUnsubscribe,url:options.preferences.makeUnsubscribeUrl(to[0])};
    }
    context.check();
    const headers={...merged.headers,...unsubscribeHeaders(merged.listUnsubscribe)};
    let renderedHtml=merged.html?(sendOpts.htmlMode==='trusted'?merged.html:await convertHtmlToEmail(merged.html)):undefined;
    context.check();
    const untrackedHtml=renderedHtml;
    // The tracking service is explicitly injected; no hidden analytics requests or tracking by default.
    const trackingId=randomUUID();
    if(renderedHtml&&trackingEnabled&&options.tracking){
      try{renderedHtml=await options.tracking.instrumentHtml(renderedHtml,{id:trackingId,account:name,message:merged});if(typeof renderedHtml!=='string')throw new TypeError('Invalid tracking HTML');}
      catch(error){warnTracking(error);renderedHtml=untrackedHtml;}
    }
    context.check();
    const text=merged.text??(untrackedHtml?await plainTextFromHtml(untrackedHtml):undefined);
    context.check();
    context.attachments=await resolveAttachmentScope(merged.attachments,{files:options.files,maxAttachmentBytes:options.maxAttachmentBytes,maxAttachmentStreams:options.maxAttachmentStreams},sendOpts.allowLocalAttachmentPaths??false,context.signal);
    const attachments=context.attachments.attachments;context.check();
    const data:Record<string,unknown>={from:merged.from,to,cc,bcc,replyTo:merged.replyTo?recipientList(merged.replyTo):undefined,subject:merged.subject,html:renderedHtml,text,amp:merged.amp,headers,priority:merged.priority,attachments};
    const transport=await transporter(name);
    context.check();
    if(marketing){
      // Fresh pre-SMTP check protects against preference changes during HTML rendering.
      let allowed;try{allowed=await options.preferences!.isSubscribed(to[0]);}
      catch{throw Object.assign(new Error('Marketing consent unavailable'),{code:'EMAIL_CONSENT_UNAVAILABLE'});}
      if(typeof allowed!=='boolean')throw Object.assign(new Error('Invalid marketing consent state'),{code:'EMAIL_CONSENT_UNAVAILABLE'});
      if(allowed!==true)throw Object.assign(new Error('Marketing consent revoked'),{code:'EMAIL_CONSENT_REQUIRED'});
      if(options.marketingSuppression){
        let blocked;try{blocked=await options.marketingSuppression.isSuppressed(to[0]);}
        catch{throw Object.assign(new Error('Marketing suppression unavailable'),{code:'EMAIL_SUPPRESSION_UNAVAILABLE'});}
        if(typeof blocked!=='boolean')throw Object.assign(new Error('Invalid marketing suppression state'),{code:'EMAIL_SUPPRESSION_UNAVAILABLE'});
        if(blocked)throw Object.assign(new Error('Recipient suppressed from marketing'),{code:'EMAIL_SUPPRESSED'});
      }
    }
    // Provider-independent account health gate, executed immediately before SMTP acceptance.
    if(options.reputation){
      let decision;
      try{decision=await options.reputation.checkBeforeSend(name,merged.purpose!);if(!decision||typeof decision.allowed!=='boolean')throw new TypeError('Invalid reputation decision');}
      catch(error){
        if(marketing)throw Object.assign(new Error('Reputation store unavailable'),{code:'EMAIL_REPUTATION_UNAVAILABLE'});
        try{options.onReputationError?.(error);}catch{/* Logging must not interrupt transactional mail */}
      }
      if(decision?.allowed===false)throw Object.assign(new Error('Sender reputation paused'),{code:'EMAIL_REPUTATION_PAUSED'});
    }
    context.check();context.submitted=true;
    const reported=await transport.sendMail(data,account.transport?{signal:context.signal}:undefined);
    const outcome=classifySmtpAcceptance([...to,...cc,...bcc],reported);
    const result={...redactResult(reported,name),accepted:outcome.accepted,rejected:outcome.rejected,submissionStatus:outcome.status,acceptanceComplete:outcome.complete,recipientOutcomes:classifySmtpRecipients([...to,...cc,...bcc],reported)};
    context.known=trackingEnabled&&options.tracking?{...result,trackingId}:result;
    if(context.signal.aborted)return {...context.known,telemetryIncomplete:true};
    if(outcome.warning){try{options.onSmtpWarning?.({account:name,status:outcome.status,reason:outcome.warning});}catch{/* Diagnostics must not change SMTP acceptance */}}
    if(options.reputation){
      // Accepted SMTP recipients only. Do not retry an accepted email because telemetry failed.
      for(const address of result.accepted){
        if(context.signal.aborted)break;
        try{await options.reputation.recordAccepted(name,address,result.messageId??trackingId);}
        catch(error){try{options.onReputationError?.(error);}catch{/* report only */}}
      }
    }
    if(!context.signal.aborted&&trackingEnabled&&result.accepted.length>0&&options.tracking?.onSent){
      // Mail has been accepted. Telemetry failures must not trigger a duplicate send/retry.
      try{await options.tracking.onSent({id:trackingId,account:name,message:merged,result});}
      catch(error){warnTracking(error);}
    }
    return trackingEnabled&&options.tracking?{...result,trackingId}:result;
  }
  const manager={
    templates,filter,
    accounts(){return [...accounts.values()].map(({name,enabled,smtp})=>({name,enabled:enabled!==false,protocol:smtp?'smtp':'custom',host:smtp?.host,port:smtp?.port,secure:smtp?.secure}));},
    async verify(name=fallback,settings:Pick<EmailSendOptions,'signal'|'timeoutMs'|'deadline'>={}){
      if(closed)throw new Error('Email manager closed');if(jobs.size+verifications.size>=maxSends)throw Object.assign(new Error('Email send capacity exceeded'),{code:'EMAIL_SEND_OVERLOAD'});
      const ms=settings.timeoutMs??defaultTimeout;if(!Number.isSafeInteger(ms)||ms<1||ms>600000||settings.signal!==undefined&&!(settings.signal instanceof AbortSignal)||settings.deadline!==undefined&&(!Number.isSafeInteger(settings.deadline)||settings.deadline<0||settings.deadline>Date.now()+600000))throw new TypeError('Invalid verify deadline/signal');
      const controller=new AbortController(),abort=()=>controller.abort(),deadline=Math.min(Date.now()+ms,settings.deadline??Infinity);let expired=false;const check=()=>{if(controller.signal.aborted||Date.now()>=deadline)throw Object.assign(new Error('Email verification cancelled or deadline exceeded'),{code:expired||Date.now()>=deadline?'EMAIL_VERIFY_DEADLINE':'EMAIL_VERIFY_CANCELLED'});};settings.signal?.addEventListener('abort',abort,{once:true});if(settings.signal?.aborted)abort();
      let stop=()=>{};const stopped=new Promise<never>((_,reject)=>{stop=()=>{try{check();}catch(e){reject(e);}};controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();});const timer=setTimeout(()=>{expired=true;controller.abort();},Math.max(1,deadline-Date.now()));
      const native=Promise.resolve().then(async()=>{check();const transport=await transporter(name);try{check();const valid=transport.verify?await transport.verify():true;check();if(typeof valid!=='boolean')throw new TypeError('Invalid transport verification result');if(valid===false&&!contexts.size&&verifications.size===1&&accounts.get(name)?.ownTransport!==false){created.delete(name);await release(name,transport);}return valid;}catch(cause){if(![...contexts].some(c=>c.name===name)&&![...verifications.values()].some(v=>v.name===name&&v.controller!==controller)&&accounts.get(name)?.ownTransport!==false){created.delete(name);try{await release(name,transport);}catch{/* Preserve verification cause. */}}throw cause instanceof EmailSubmissionError?cause:new EmailSubmissionError('EMAIL_VERIFY_FAILED',[],cause);}});
      verifications.set(native,{name,controller});void native.finally(()=>verifications.delete(native)).catch(()=>{});try{return await Promise.race([native,stopped]);}finally{clearTimeout(timer);settings.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stop);}
    },

    async send(message:EmailMessage,sendOpts:EmailSendOptions={}):Promise<EmailResult>{
      if(closed)throw new Error('Email manager closed');
      message=snapshotMessage(message,options.maxAttachmentBytes??25*1024*1024);
      const name=message.account??fallback;
      if(!accounts.has(name))throw new Error('Unknown email account');
      const key=message.idempotencyKey?`${name}:${message.idempotencyKey}`:undefined;
      // A key cannot silently acknowledge a DIFFERENT message. Streams are not safe to fingerprint.
      const fingerprint=key?fingerprintSend(message,sendOpts):undefined;
      if(key){const prior=completed.get(key);if(prior&&prior.until>Date.now()){
          if(prior.fingerprint!==fingerprint)throw Object.assign(new Error('Idempotency key reused for different email'),{code:'EMAIL_IDEMPOTENCY_CONFLICT'});
          if(prior.error)throw prior.error;
          return {...prior.result!,skipped:true,reason:'idempotency replay'};
        }
        const running=pending.get(key);if(running){
          if(running.fingerprint!==fingerprint)throw Object.assign(new Error('Idempotency key reused for different email'),{code:'EMAIL_IDEMPOTENCY_CONFLICT'});
          return observeShared(running,sendOpts);
        }}
      if(jobs.size+verifications.size>=maxSends)throw Object.assign(new Error('Email send capacity exceeded'),{code:'EMAIL_SEND_OVERLOAD'});
      const timeout=sendOpts.timeoutMs??defaultTimeout;if(!Number.isSafeInteger(timeout)||timeout<1||timeout>600000||sendOpts.signal!==undefined&&!(sendOpts.signal instanceof AbortSignal)||sendOpts.deadline!==undefined&&(!Number.isSafeInteger(sendOpts.deadline)||sendOpts.deadline<0||sendOpts.deadline>Date.now()+600000))throw new TypeError('Invalid send deadline/signal');
      const controller=new AbortController(),deadline=Math.min(Date.now()+timeout,sendOpts.deadline??Infinity);let expired=false;
      const context:SendContext={name,controller,signal:controller.signal,submitted:false,intended:[],check(){if(controller.signal.aborted||Date.now()>=deadline)throw Object.assign(new Error(expired||Date.now()>=deadline?'Email send deadline exceeded':'Email send cancelled'),{code:expired||Date.now()>=deadline?'EMAIL_SEND_DEADLINE':'EMAIL_SEND_CANCELLED'});}};
      const abort=()=>controller.abort();sendOpts.signal?.addEventListener('abort',abort,{once:true});if(sendOpts.signal?.aborted)abort();contexts.add(context);
      let stop=()=>{};const stopped=new Promise<never>((_,reject)=>{stop=()=>reject(Object.assign(new Error(expired?'Email send deadline exceeded':'Email send cancelled'),{code:expired?'EMAIL_SEND_DEADLINE':'EMAIL_SEND_CANCELLED'}));controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();});const timer=setTimeout(()=>{expired=true;controller.abort();},Math.max(1,deadline-Date.now()));
      const native=Promise.resolve().then(()=>doSend(message,name,sendOpts,context)).catch(cause=>{throw context.submitted?smtpSubmissionFailure(context.intended,cause):cause;}).finally(async()=>{await context.attachments?.dispose();});
      jobs.add(native);void native.finally(()=>{jobs.delete(native);contexts.delete(context);if(key&&pending.get(key)?.task===task)pending.delete(key);}).catch(()=>{});
      const task=Promise.race([native,stopped]).catch(cause=>{if(context.known)return {...context.known,telemetryIncomplete:true};if(context.submitted&&!(cause instanceof EmailSubmissionError))throw new EmailSubmissionError('EMAIL_SMTP_UNCERTAIN',context.intended,cause);throw cause;}).finally(()=>{clearTimeout(timer);sendOpts.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stop);});
      if(key){pending.set(key,{task,fingerprint:fingerprint!,context});task.catch(error=>{if(error instanceof EmailSubmissionError&&error.code==='EMAIL_SMTP_UNCERTAIN')remember(key,fingerprint!,undefined,error);});native.then(result=>remember(key,fingerprint!,result),error=>{if(error instanceof EmailSubmissionError&&error.code==='EMAIL_SMTP_UNCERTAIN')remember(key,fingerprint!,undefined,error);}).catch(()=>{});}

      return task;
    },
    /** Explicit failover while the SMTP command has NOT started. Never retry on a send() error.
     * Requires a real verify() method; custom transports without verification are not failover candidates. */
    async sendWithVerifiedFailover(message:EmailMessage,names:readonly string[],sendOpts:EmailSendOptions={}):Promise<EmailResult>{
      if(closed)throw new Error('Email manager closed');
      if(!Array.isArray(names)||names.length<1||names.length>10||new Set(names).size!==names.length||
        names.some(name=>typeof name!=='string'||!accounts.has(name)))throw new TypeError('Invalid SMTP failover accounts');
      if(message.account!==undefined&&message.account!==names[0])throw new TypeError('Failover primary must match selected account');
      const deadline=Math.min(sendOpts.deadline??Infinity,Date.now()+(sendOpts.timeoutMs??defaultTimeout));
      let selected:string|undefined;
      for(const name of names){
        const account=accounts.get(name)!;if(account.enabled===false)continue;
        let transport:TransportLike;try{transport=await transporter(name);}catch{continue;}
        if(typeof transport.verify!=='function')continue;
        try{if(await manager.verify(name,{signal:sendOpts.signal,timeoutMs:sendOpts.timeoutMs,deadline})===true){selected=name;break;}}catch(error){if(Date.now()>=deadline||sendOpts.signal?.aborted||(error as {code?:string}).code==='EMAIL_SEND_OVERLOAD')throw error;/* No SMTP send occurred; another verified account is eligible. */}
      }
      if(!selected)throw Object.assign(new Error('No verified SMTP account available; no message submitted'),{code:'EMAIL_NO_VERIFIED_TRANSPORT'});
      // Once send begins, no automatic retry or failover is safe: SMTP acceptance might be uncertain.
      return manager.send({...message,account:selected},{...sendOpts,deadline});
    },
    async sendBatch(messages:readonly EmailMessage[],settings:{concurrency?:number;continueOnError?:boolean;signal?:AbortSignal;timeoutMs?:number;deadline?:number}={}):Promise<({ok:true;result:EmailResult}|{ok:false;error:Error})[]>{
      const workers=settings.concurrency??3;
      const budget=settings.timeoutMs??defaultTimeout;if(!Number.isSafeInteger(budget)||budget<1||budget>600000)throw new RangeError('Invalid batch deadline');
      const deadline=Math.min(settings.deadline??Infinity,Date.now()+budget);
      if(!Number.isSafeInteger(workers)||workers<1||workers>20||messages.length>10000)throw new RangeError('Invalid batch size');
      const results:Array<{ok:true;result:EmailResult}|{ok:false;error:Error}>=new Array(messages.length);let index=0;
      await Promise.all(Array.from({length:Math.min(workers,messages.length)},async()=>{
        while(index<messages.length){const i=index++;try{results[i]={ok:true,result:await manager.send(messages[i],{signal:settings.signal,deadline})};}catch(e){results[i]={ok:false,error:e instanceof Error?e:new Error(String(e))};}}
      }));
      if(settings.continueOnError===false&&results.some(r=>!r.ok))throw new AggregateError(results.filter(r=>!r.ok).map(r=>(r as {ok:false;error:Error}).error),'Email batch delivery failed');
      return results;
    },
    status(){return {closed,pending:jobs.size+verifications.size,waiters,transports:created.size};},
    close(){if(closing)return closing;closed=true;for(const context of contexts)context.controller.abort();for(const value of verifications.values())value.controller.abort();closing=(async()=>{await Promise.allSettled([...jobs,...verifications.keys()]);const entries=[...created.entries()],transports=await Promise.allSettled(entries.map(([,p])=>p));const cleanup=await Promise.allSettled(transports.map((r,i)=>r.status==='fulfilled'?release(entries[i]![0],r.value):Promise.resolve()));created.clear();pending.clear();completed.clear();const failed=cleanup.filter(r=>r.status==='rejected');if(failed.length)throw new Error('Email transport cleanup failed',{cause:new AggregateError(failed.map(r=>(r as PromiseRejectedResult).reason))});})();return closing;}

  };
  return manager;
}
export type EmailManager=ReturnType<typeof createEmailManager>;
