import {createFocusTrap,type FocusTrapOptions} from './focus.js';
import {attributeOwner} from './ownership.js';
import {AccessibilityValidationError,validateComponentProps} from './props.js';
export interface AccessibleDialogOptions {
 labelledBy?:string;describedBy?:string;label?:string;closeOnEscape?:boolean;onClose?:()=>void;focus?:FocusTrapOptions;
 /** Explicit native inert policy. true computes siblings along the ancestor path. */
 inertBackground?:boolean|readonly HTMLElement[];
}
interface Modal {element:HTMLElement;policy:AccessibleDialogOptions['inertBackground'];close:()=>void}
interface ModalState {entries:Modal[];owned:ReturnType<typeof attributeOwner>;applied:Set<HTMLElement>}
const modals=new WeakMap<Document,ModalState>();
function stateFor(doc:Document):ModalState {let state=modals.get(doc);if(!state){state={entries:[],owned:attributeOwner(),applied:new Set()};modals.set(doc,state);}return state;}
function backgrounds(element:HTMLElement):HTMLElement[] {
 const result:HTMLElement[]=[];let branch:HTMLElement|null=element;
 while(branch?.parentElement){for(const sibling of branch.parentElement.children)if(sibling!==branch)result.push(sibling as HTMLElement);branch=branch.parentElement;if(branch===element.ownerDocument.body)break;}
 if(result.length>1024)throw new RangeError('Dialog background budget exceeded');return result;
}
function synchronize(state:ModalState):void {
 const top=state.entries.at(-1),desired=new Set<HTMLElement>();
 if(top){
  if(state.entries.some(entry=>entry.policy===true))for(const target of backgrounds(top.element))desired.add(target);
  for(const entry of state.entries)if(Array.isArray(entry.policy))for(const target of entry.policy)if(target!==top.element&&!target.contains(top.element)&&!top.element.contains(target))desired.add(target);
 }
 for(const target of state.applied)if(!desired.has(target)){state.owned.release(target);state.applied.delete(target);}
 for(const target of desired)if(!state.applied.has(target)){state.owned.set(target,'inert','');state.applied.add(target);}
}
/** Managed custom modal. Existing dialog/alertdialog roles remain authored; incompatible roles reject.
 * Native <dialog>.showModal/top-layer behavior is intentionally owned by the host, not emulated here.
 */
export function createAccessibleDialog(element:HTMLElement,options:AccessibleDialogOptions={}) {
 options={...options,...(Array.isArray(options.inertBackground)?{inertBackground:[...options.inertBackground]}:{})};
 const doc=element.ownerDocument,existingRole=element.getAttribute('role');
 if(existingRole&&!['dialog','alertdialog'].includes(existingRole))throw new TypeError('Modal requires an authored dialog or alertdialog role');
 if(options.inertBackground!==undefined&&typeof options.inertBackground!=='boolean'&&(!Array.isArray(options.inertBackground)||options.inertBackground.length>256||options.inertBackground.some(target=>target.ownerDocument!==doc||typeof target.contains!=='function')))throw new TypeError('Invalid dialog inert background');
 let originalHidden=element.hidden;const owned=attributeOwner();let appliedHidden=element.hidden;
 const reflectedHidden=!!doc.defaultView&&element instanceof doc.defaultView.HTMLElement;
 const hidden=(value:boolean)=>{if(reflectedHidden)owned.set(element,'hidden',value?'':null);else{if(element.hidden!==appliedHidden)originalHidden=element.hidden;element.hidden=value;}appliedHidden=element.hidden;};
 if(!existingRole)owned.set(element,'role','dialog');owned.set(element,'aria-modal','true');
 for(const [option,attribute] of [['label','aria-label'],['labelledBy','aria-labelledby'],['describedBy','aria-describedby']] as const){
  const value=options[option];if(value!==undefined){if(typeof value!=='string'||!value.trim()||value.length>1024){owned.release();throw new TypeError('Invalid dialog label/reference');}owned.set(element,attribute,value);}
 }
 let disposed=false,open=false,opener:HTMLElement|null=null;
 const state=stateFor(doc);
 const focus=createFocusTrap(element,{...options.focus,returnFocusTo:options.focus?.returnFocusTo??(()=>opener),escapeDeactivates:false});
 const modal:Modal={element,policy:options.inertBackground,close:()=>api.close()};
 const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&open&&focus.topmost&&options.closeOnEscape!==false){event.preventDefault();api.close();options.onClose?.();}};
 const api={
  get open(){return open;},
  show(){
   if(disposed)throw new Error('Dialog destroyed');if(open)return;
   if(!['dialog','alertdialog'].includes(element.getAttribute('role')??''))throw new TypeError('Dialog role changed while managed');
   // Real DOM trees validate references at show time, so construction may precede mounting.
   if(typeof doc.querySelectorAll==='function'){
    const issues=validateComponentProps(element,{});if(issues.length)throw new AccessibilityValidationError(issues);
   }
   if(state.entries.length>=128)throw new RangeError('Dialog nesting budget exceeded');
   opener=doc.activeElement as HTMLElement|null;hidden(false);open=true;state.entries.push(modal);
   try{synchronize(state);doc.addEventListener('keydown',onKey);focus.activate();}
   catch(error){open=false;const index=state.entries.indexOf(modal);if(index>=0)state.entries.splice(index,1);doc.removeEventListener('keydown',onKey);focus.destroy();synchronize(state);hidden(true);throw error;}
  },
  refresh(){if(open){synchronize(state);if(typeof doc.querySelectorAll==='function'){const issues=validateComponentProps(element,{});if(issues.length)throw new AccessibilityValidationError(issues);}}},
  close(){
   if(!open)return;
   // Removing a DOM ancestor must not strand live traps inside its hidden subtree.
   for(const entry of [...state.entries].reverse())if(entry!==modal&&element.contains(entry.element))entry.close();
   open=false;const index=state.entries.indexOf(modal);if(index>=0)state.entries.splice(index,1);
   doc.removeEventListener('keydown',onKey);synchronize(state);
   try{focus.deactivate();}finally{hidden(true);}
  },
  destroy(){
   if(disposed)return;try{api.close();}finally{disposed=true;owned.release();if(!reflectedHidden&&element.hidden===appliedHidden)element.hidden=originalHidden;focus.destroy();}
  },
 };
 hidden(true);return api;
}
