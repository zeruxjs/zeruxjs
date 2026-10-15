export function ariaBoolean(value:boolean):'true'|'false' {return value?'true':'false';}
export function visuallyHiddenStyle():Readonly<Record<string,string>> {return {position:'absolute',width:'1px',height:'1px',padding:'0',margin:'-1px',overflow:'hidden',clip:'rect(0, 0, 0, 0)',whiteSpace:'nowrap',border:'0'};}
export function setAriaExpanded(element:Element,expanded:boolean):void {element.setAttribute('aria-expanded',ariaBoolean(expanded));}
export function setAriaPressed(element:Element,pressed:boolean):void {element.setAttribute('aria-pressed',ariaBoolean(pressed));}
export function setAriaBusy(element:Element,busy:boolean):void {element.setAttribute('aria-busy',ariaBoolean(busy));}
export function prefersReducedMotion():boolean {return typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;}
export function observeReducedMotion(listener:(reduced:boolean)=>void, win:Window=window):()=>void {const media=win.matchMedia('(prefers-reduced-motion: reduce)');listener(media.matches);const onChange=(ev:MediaQueryListEvent)=>listener(ev.matches);media.addEventListener('change',onChange);return ()=>media.removeEventListener('change',onChange);}
