import type {FocusTrap} from './types.js';
import {attributeOwner} from './ownership.js';
const selector='a[href],button,input,select,textarea,[tabindex]';
/** Semantic availability, including disabled fieldsets and hidden/inert ancestors. */
export function isFocusAvailable(element:HTMLElement):boolean {
 if(element.isConnected===false||element.hidden||element.getAttribute?.('aria-disabled')==='true'||element.hasAttribute?.('disabled')||element.getAttribute?.('type')==='hidden')return false;
 if(element.closest?.('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]'))return false;
 if(element.matches?.(':disabled'))return false;
 const style=element.ownerDocument?.defaultView?.getComputedStyle(element);
 return !style||style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse';
}
export function focusableElements(container:HTMLElement):HTMLElement[]{
 return [...container.querySelectorAll<HTMLElement>(selector)].filter(el=>typeof el.focus==='function'&&el.tabIndex>=0&&isFocusAvailable(el)&&el.getClientRects().length>0);
}
interface Entry {trap:FocusTrap;container:HTMLElement;focus:()=>void}
const stacks=new WeakMap<Document,Entry[]>();
export interface FocusTrapOptions {
 initialFocus?:()=>HTMLElement|null;fallbackFocus?:()=>HTMLElement|null;returnFocus?:boolean;
 returnFocusTo?:()=>HTMLElement|null;returnFocusFallback?:()=>HTMLElement|null;
 escapeDeactivates?:boolean;onEscape?:(event:KeyboardEvent)=>void;
}
/** One document-local stack; activation failure rolls back listeners and temporary attributes. */
export function createFocusTrap(container:HTMLElement,options:FocusTrapOptions={}):FocusTrap {
 options={...options};
 const doc=container.ownerDocument;let previous:HTMLElement|null=null,active=false,redirecting=false,lastFocused:HTMLElement|null=null;
 const owned=attributeOwner();
 const stack=()=>{let value=stacks.get(doc);if(!value){value=[];stacks.set(doc,value);}return value;};
 const top=()=>stack().at(-1)?.trap===trap;
 const focus=(initial=false)=>{
  if(redirecting)return;redirecting=true;
  try{
   const selected=(initial?options.initialFocus?.():lastFocused&&isFocusAvailable(lastFocused)?lastFocused:null)??focusableElements(container)[0]??options.fallbackFocus?.()??container;
   if(!selected||typeof selected.focus!=='function'||!container.contains(selected)||!isFocusAvailable(selected))throw new TypeError('Focus target must be available inside the trap');
   if(selected===container&&!container.hasAttribute('tabindex'))owned.set(container,'tabindex','-1');
   selected.focus();lastFocused=selected;
  }finally{redirecting=false;}
 };
 const onKey=(event:KeyboardEvent)=>{
  if(!active||!top()||event.defaultPrevented)return;
  if(event.key==='Escape'&&options.escapeDeactivates){try{options.onEscape?.(event);}finally{trap.deactivate();}return;}
  if(event.key!=='Tab')return;
  const nodes=focusableElements(container);if(!nodes.length){event.preventDefault();focus();return;}
  const first=nodes[0],last=nodes[nodes.length-1],current=doc.activeElement;
  if(event.shiftKey&&(current===first||!container.contains(current))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(current===last||!container.contains(current))){event.preventDefault();first.focus();}
 };
 const onFocus=(event:FocusEvent)=>{if(!active||!top()||redirecting||!event.target)return;if(container.contains(event.target as Node)){if(typeof (event.target as HTMLElement).focus==='function')lastFocused=event.target as HTMLElement;}else focus();};
 const entry:Entry={get trap(){return trap;},container,focus:()=>focus()};
 const trap:FocusTrap={
  get active(){return active;},get topmost(){return active&&top();},
  activate(){
   if(active)return;previous=doc.activeElement as HTMLElement|null;active=true;stack().push(entry);
   try{doc.addEventListener('keydown',onKey);doc.addEventListener('focusin',onFocus);focus(true);}
   catch(error){active=false;stack().splice(stack().indexOf(entry),1);doc.removeEventListener('keydown',onKey);doc.removeEventListener('focusin',onFocus);owned.release();throw error;}
  },
  deactivate(){
   if(!active)return;const wasTop=top();active=false;const index=stack().indexOf(entry);if(index>=0)stack().splice(index,1);
   doc.removeEventListener('keydown',onKey);doc.removeEventListener('focusin',onFocus);owned.release();
   if(!wasTop||options.returnFocus===false)return;
   const parent=stack().at(-1),candidate=options.returnFocusTo?.()??previous;
   const target=candidate&&isFocusAvailable(candidate)&&(!parent||parent.container.contains(candidate))?candidate:options.returnFocusFallback?.();
   if(target&&isFocusAvailable(target)&&(!parent||parent.container.contains(target)))target.focus();else parent?.focus();
  },
  destroy(){trap.deactivate();},
 };
 return trap;
}
export function onEscape(target:EventTarget,callback:(event:KeyboardEvent)=>void):()=>void{const handler=(event:Event)=>{const key=event as KeyboardEvent;if(key.key==='Escape')callback(key);};target.addEventListener('keydown',handler);return()=>target.removeEventListener('keydown',handler);}
