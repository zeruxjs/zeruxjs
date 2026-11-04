import {attributeOwner} from './ownership.js';
import {observeReducedMotion} from './aria.js';
import type {PreferenceState} from './preferences.js';
const ids=new WeakMap<Document,number>(),mounted=new WeakSet<HTMLElement>();
export function preferenceId(doc:Document):string {const next=(ids.get(doc)??0)+1;ids.set(doc,next);return 'zx-preference-'+next;}
/** Explicit scoped CSS/media binding. No root-document filter, styles or listeners on import. */
export function bindPreferenceStyles(container:HTMLElement,state:PreferenceState,options:{nonce?:string;observeMedia?:boolean}={}) {
 if(options.observeMedia!==undefined&&typeof options.observeMedia!=='boolean')throw new TypeError('Invalid media observation option');
 if(mounted.has(container))throw new Error('Preference styles already bound to container');
 const doc=container.ownerDocument,win=doc.defaultView;if(!win)throw new TypeError('Preference styles require a live DOM window');
 if(options.nonce!==undefined&&(typeof options.nonce!=='string'||options.nonce.length>256||/[\r\n]/.test(options.nonce)))throw new TypeError('Invalid preference style nonce');
 state.getSnapshot();
 const owned=attributeOwner(),token=preferenceId(doc),selector=`[data-zx-preferences="${token}"]`,style=doc.createElement('style'),cleanup:(()=>void)[]=[];
 if(options.nonce)style.setAttribute('nonce',options.nonce);style.setAttribute('data-zx-preference-style','');
 const reduce=`animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important;`;
 style.textContent=`
${selector}[data-zx-text="125"]{font-size:125%;}${selector}[data-zx-text="150"]{font-size:150%;}${selector}[data-zx-text="200"]{font-size:200%;}
${selector}[data-zx-contrast="light"]{color:#111;background-color:#fff;color-scheme:light;}
${selector}[data-zx-contrast="dark"]{color:#fff;background-color:#111;color-scheme:dark;}
${selector}[data-zx-contrast="high"]{color:#000;background-color:#fff;color-scheme:light;}
${selector}:focus-visible,${selector} :where(button,input,select,textarea,a[href],[tabindex]):focus-visible{outline:2px solid currentColor;outline-offset:2px;}
${selector}[data-zx-motion="reduce"],${selector}[data-zx-motion="reduce"] *{${reduce}}
@media(prefers-reduced-motion:reduce){${selector},${selector} *{${reduce}}}
@media(forced-colors:active){${selector}[data-zx-contrast]{color:CanvasText;background-color:Canvas;color-scheme:normal;}${selector}:focus-visible,${selector} :where(button,input,select,textarea,a[href],[tabindex]):focus-visible{outline-color:Highlight;}}`;
 const update=()=>{const snapshot=state.getSnapshot();owned.set(container,'data-zx-preferences',token);owned.set(container,'data-zx-text',String(snapshot.values.textScale*100));owned.set(container,'data-zx-contrast',snapshot.values.contrast);owned.set(container,'data-zx-motion',snapshot.effective.reducedMotion?'reduce':'system');};
 try{
  mounted.add(container);container.appendChild(style);update();cleanup.push(state.subscribe(update));
  if(options.observeMedia!==false&&typeof win.matchMedia==='function'){
   cleanup.push(observeReducedMotion(reducedMotion=>state.setSystem({reducedMotion}),win));
   const colors=win.matchMedia('(forced-colors: active)'),changed=()=>state.setSystem({forcedColors:colors.matches});changed();colors.addEventListener('change',changed);cleanup.push(()=>colors.removeEventListener('change',changed));
  }
 }catch(error){for(const stop of cleanup.reverse())stop();style.remove();owned.release();mounted.delete(container);throw error;}
 let disposed=false;return {destroy(){if(disposed)return;disposed=true;for(const stop of cleanup.reverse())stop();style.remove();owned.release();mounted.delete(container);}};
}
