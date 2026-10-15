import {createFocusTrap,type FocusTrapOptions} from './focus.js';
/** Turns an existing DOM element into a managed modal dialog without allocating global overlays. */
export function createAccessibleDialog(element:HTMLElement,options:{labelledBy?:string;describedBy?:string;closeOnEscape?:boolean;onClose?:()=>void;focus?:FocusTrapOptions}={}){
 const original={role:element.getAttribute('role'),modal:element.getAttribute('aria-modal'),hidden:element.hidden,
  label:element.getAttribute('aria-labelledby'),description:element.getAttribute('aria-describedby')};
 element.setAttribute('role','dialog');element.setAttribute('aria-modal','true');
 if(options.labelledBy)element.setAttribute('aria-labelledby',options.labelledBy);
 if(options.describedBy)element.setAttribute('aria-describedby',options.describedBy);
 let disposed=false,open=false;
 const focus=createFocusTrap(element,{...options.focus,escapeDeactivates:false});
 const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&open&&focus.topmost&&options.closeOnEscape!==false){event.preventDefault();api.close();options.onClose?.()}};
 const api={get open(){return open},show(){if(disposed)throw new Error('Dialog destroyed');if(open)return;open=true;element.hidden=false;
  element.ownerDocument.addEventListener('keydown',onKey);focus.activate()},
  close(){if(!open)return;open=false;element.ownerDocument.removeEventListener('keydown',onKey);focus.deactivate();element.hidden=true},
  destroy(){if(disposed)return;api.close();disposed=true;
   for(const [name,value] of [['role',original.role],['aria-modal',original.modal],['aria-labelledby',original.label],['aria-describedby',original.description]] as const)
    if(value===null)element.removeAttribute(name);else element.setAttribute(name,value);
   element.hidden=original.hidden;focus.destroy()}};
 element.hidden=true;return api;
}
