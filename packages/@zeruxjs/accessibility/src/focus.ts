import type {FocusTrap} from './types.js';
const selector='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function focusableElements(container:HTMLElement):HTMLElement[]{return [...container.querySelectorAll<HTMLElement>(selector)].filter(el=>!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&el.getAttribute('aria-disabled')!=='true'&&el.getClientRects().length>0&&!el.closest('[inert]'))}
const stacks=new WeakMap<Document,Set<FocusTrap>>();
export interface FocusTrapOptions { initialFocus?:()=>HTMLElement|null; fallbackFocus?:()=>HTMLElement|null; returnFocus?:boolean; escapeDeactivates?:boolean; onEscape?:(event:KeyboardEvent)=>void }
/** Nested focus traps share a document stack; only the topmost trap captures keyboard focus. */
export function createFocusTrap(container:HTMLElement,options:FocusTrapOptions={}):FocusTrap{
 const doc=container.ownerDocument;let previous:Element|null=null,active=false,addedTabindex=false;
 const stack=()=>{let value=stacks.get(doc);if(!value){value=new Set();stacks.set(doc,value)}return value};
 const top=()=>[...stack()].at(-1)===trap;
 const focus=()=>{const selected=options.initialFocus?.()??focusableElements(container)[0]??options.fallbackFocus?.()??container;
  if(selected===container&&!container.hasAttribute('tabindex')){container.setAttribute('tabindex','-1');addedTabindex=true}selected.focus()};
 const onKey=(event:KeyboardEvent)=>{if(!active||!top())return;
  if(event.key==='Escape'&&options.escapeDeactivates){options.onEscape?.(event);trap.deactivate();return}
  if(event.key!=='Tab')return;const nodes=focusableElements(container);if(!nodes.length){event.preventDefault();focus();return}
  const first=nodes[0],last=nodes[nodes.length-1],current=doc.activeElement;
  if(event.shiftKey&&(current===first||!container.contains(current))){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&(current===last||!container.contains(current))){event.preventDefault();first.focus()}
 };
 const onFocus=(event:FocusEvent)=>{if(!active||!top())return;const target=event.target;
  if(target&&typeof target==='object'&&!container.contains(target as Node))focus()};
 const trap:FocusTrap={get active(){return active},get topmost(){return active&&top()},activate(){if(active)return;active=true;previous=doc.activeElement;stack().add(trap);
   doc.addEventListener('keydown',onKey);doc.addEventListener('focusin',onFocus);focus()},
  deactivate(){if(!active)return;active=false;stack().delete(trap);doc.removeEventListener('keydown',onKey);doc.removeEventListener('focusin',onFocus);
   if(addedTabindex){container.removeAttribute('tabindex');addedTabindex=false}
   if(options.returnFocus!==false&&previous&&('focus' in previous)&&(previous as HTMLElement).isConnected)(previous as HTMLElement).focus()},destroy(){trap.deactivate()}};
 return trap;
}
