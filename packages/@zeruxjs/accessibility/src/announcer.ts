import {visuallyHiddenStyle} from './aria.js';
/** One live region per announcer; activate on demand and dispose on unmount. */
export function createLiveAnnouncer(doc:Document=document){const el=doc.createElement('div');el.setAttribute('aria-live','polite');el.setAttribute('aria-atomic','true');el.setAttribute('role','status');Object.assign(el.style,visuallyHiddenStyle());doc.body.appendChild(el);let disposed=false;
 return{announce(message:string,assertive=false){if(disposed)return;el.setAttribute('aria-live',assertive?'assertive':'polite');el.setAttribute('role',assertive?'alert':'status');el.textContent='';el.textContent=message},clear(){if(!disposed)el.textContent=''},destroy(){if(disposed)return;disposed=true;el.remove()}};
}
