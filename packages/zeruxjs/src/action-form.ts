import {createFormFeedback,type FormFeedbackOptions,type ClientIssue} from '@zeruxjs/validator/browser';
export interface ActionFormOptions {
 fetch?:typeof fetch;
 resolveField?:FormFeedbackOptions['resolveField'];
 optimistic?:{apply():void;rollback():void;commit?():void};
 navigate?:(url:string)=>void|Promise<void>;
 timeoutMs?:number;
 maxBytes?:number;
}
const owners=new WeakSet<HTMLFormElement>();
/** Optional progressive enhancement. No server action functions or DOM access on import. */
export function enhanceActionForm(form:HTMLFormElement,options:ActionFormOptions={}){
 const win=form?.ownerDocument?.defaultView;
 if(!win||form.tagName!=='FORM'||owners.has(form)||form.method.toLowerCase()!=='post'||form.enctype!=='application/x-www-form-urlencoded'||(!/^https?:$/.test(new URL(form.action).protocol)||new URL(form.action).origin!==win.location.origin)||!form.querySelector('[name="_action_key"]')||!form.querySelector('[name="_action_csrf"]')||options.fetch!==undefined&&typeof options.fetch!=='function'||options.resolveField!==undefined&&typeof options.resolveField!=='function'||options.navigate!==undefined&&typeof options.navigate!=='function'||options.optimistic&&(['apply','rollback'] as const).some(key=>typeof options.optimistic![key]!=='function')||options.optimistic?.commit!==undefined&&typeof options.optimistic.commit!=='function')throw new TypeError('Invalid action form');
 if(options.optimistic&&[options.optimistic.apply,options.optimistic.rollback,options.optimistic.commit].some(fn=>fn?.constructor.name==='AsyncFunction'))throw new TypeError('Optimistic callbacks must be synchronous');
 options={...options,optimistic:options.optimistic?{apply:options.optimistic.apply.bind(options.optimistic),rollback:options.optimistic.rollback.bind(options.optimistic),commit:options.optimistic.commit?.bind(options.optimistic)}:undefined};
 const synchronous=(run:()=>void)=>{const value=run() as unknown;if(value&&typeof (value as PromiseLike<unknown>).then==='function'){void Promise.resolve(value).catch(()=>{});throw new TypeError('Expected synchronous callback');}};
 const transport=options.fetch??win.fetch?.bind(win),timeout=options.timeoutMs??10000,maxBytes=options.maxBytes??32768;
 if(!transport||!Number.isSafeInteger(timeout)||timeout<10||timeout>60000||!Number.isSafeInteger(maxBytes)||maxBytes<128||maxBytes>131072)throw new TypeError('Invalid form limits');
 const feedback=createFormFeedback({resolveField:options.resolveField??(()=>undefined)}),status=form.ownerDocument.createElement('p');status.setAttribute('role','alert');status.tabIndex=-1;form.append(status);
 let closed=false,busy=false,pending:Promise<void>|undefined,controller:AbortController|undefined,closing:Promise<void>|undefined;
 const submit=(event:SubmitEvent)=>{
  if(closed||event.defaultPrevented)return;
  const submitter=event.submitter as HTMLElement|null;
  if(form.target&&form.target!=='_self'||submitter&&['formaction','formmethod','formenctype','formtarget'].some(name=>submitter.hasAttribute(name)))return;
  event.preventDefault();if(busy)return;busy=true;status.textContent='';feedback.clear();
  const disabled=[...form.elements].filter(element=>['submit','image'].includes((element as HTMLInputElement).type)).map(element=>({element:element as HTMLButtonElement,disabled:(element as HTMLButtonElement).disabled})),priorBusy=form.getAttribute('aria-busy');
  const requestController=new AbortController();controller=requestController;const signal=requestController.signal,timer=setTimeout(()=>requestController.abort(),timeout);let applied=false,confirmed=false;
  pending=(async()=>{try{
   const data=new win.FormData(form,submitter as HTMLButtonElement|null),body=new URLSearchParams();let fields=0;
   for(const [name,value]of data){if(++fields>200||typeof value!=='string')throw Error('Unsupported form');body.append(name,value);}
   if(new TextEncoder().encode(body.toString()).length>maxBytes)throw Error('Form limit');
   for(const item of disabled)item.element.disabled=true;form.setAttribute('aria-busy','true');
   if(options.optimistic){applied=true;synchronous(options.optimistic.apply);}
   const response=await transport(form.action,{method:'POST',credentials:'same-origin',headers:{accept:'application/json'},body,signal,redirect:'error'});
   let size=0,text='';const reader=response.body?.getReader(),decoder=new TextDecoder(),abort=()=>void reader?.cancel().catch(()=>{});signal.addEventListener('abort',abort,{once:true});
   try{if(reader)while(true){signal.throwIfAborted();const item=await reader.read();signal.throwIfAborted();if(item.done)break;size+=item.value.byteLength;if(size>32768)throw Error('Response limit');text+=decoder.decode(item.value,{stream:true});}text+=decoder.decode();}finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();signal.removeEventListener('abort',abort);}
   if(closed||signal.aborted)throw Error('Cancelled');
   const payload=JSON.parse(text);
   if(response.ok&&payload?.ok===true&&typeof payload.redirect==='string'){
    const destination=new URL(payload.redirect,form.action);if(destination.origin!==win.location.origin||!/^https?:$/.test(destination.protocol))throw Error('Invalid redirect');confirmed=true;if(options.optimistic?.commit)synchronous(options.optimistic.commit);const navigation=(options.navigate??(url=>win.location.assign(url)))(destination.href);if(navigation&&typeof navigation.then==='function')void navigation.catch(()=>{if(!closed){status.textContent='Saved, but the page could not be updated.';status.focus();}});return;
   }
   if(payload?.outcome==='committed'&&response.status===503){confirmed=true;if(options.optimistic?.commit)synchronous(options.optimistic.commit);status.textContent='Saved, but refresh is required.';status.focus();return;}
   if(response.ok)throw Error('Invalid action response');
   const issues:ClientIssue[]=Array.isArray(payload?.issues)?payload.issues.slice(0,20).filter((issue:any)=>issue&&typeof issue.path==='string'&&issue.path.length<=300).map((issue:any)=>({path:issue.path,code:typeof issue.code==='string'?issue.code:'validation',message:'Invalid input'})):[];
   feedback.update(issues);status.textContent=response.status===422?'Correct the highlighted fields.':response.status===409?'This submission is already pending, expired or conflicts with an earlier submission.':response.status>=500?'Submission outcome is unknown. Check before trying again.':'Form was not submitted.';
   const target=issues[0]?options.resolveField?.(issues[0].path)?.control:undefined;
   if(target&&'focus'in target&&typeof target.focus==='function')target.focus();else status.focus();
  }catch{if(!closed){status.textContent=confirmed?'Saved, but the page could not be updated.':'Submission outcome is unknown. Check before trying again.';status.focus();}}
  finally{clearTimeout(timer);if(applied&&!confirmed)try{synchronous(options.optimistic!.rollback);}catch{if(!closed)status.textContent='The view could not be restored. Reload to check the result.';}for(const item of disabled)item.element.disabled=item.disabled;if(priorBusy===null)form.removeAttribute('aria-busy');else form.setAttribute('aria-busy',priorBusy);busy=false;}})();
 };
 form.addEventListener('submit',submit);owners.add(form);
 return {get pending(){return busy;},get settled(){return pending??Promise.resolve();},close(){return closing??=(async()=>{closed=true;controller?.abort();form.removeEventListener('submit',submit);await pending;feedback.destroy();status.remove();owners.delete(form);})();}};
}
