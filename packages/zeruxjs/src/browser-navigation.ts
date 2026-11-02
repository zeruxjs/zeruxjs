import {NavigationError,NAVIGATION_ERROR_CODES,readPublicRouteManifest,matchNavigationRoute,withinBase,type PublicNavigationRoute} from './navigation-manifest.js';
import {createDocumentNavigationRenderer,type BrowserNavigationRenderer,type BrowserNavigationContext,type BrowserPageOwner} from './browser-renderer.js';
export * from './navigation-manifest.js';
export * from './browser-renderer.js';
export interface BrowserRouterOptions {
  manifest:unknown;
  root:HTMLElement;
  /** Public opaque identity/tenant/session revision; never a bearer token or authorization decision. */
  scope():string;
  renderer?:BrowserNavigationRenderer;
  initialOwner?:BrowserPageOwner;
  fetch?:typeof fetch;
  timeoutMs?:number;
  maxBytes?:number;
  maxNodes?:number;
  maxActive?:number;
  prefetch?:boolean;
  maxPrefetch?:number;
  onError?:(code:string)=>void;
  /** Explicit host integration, useful for embedding/tests. Defaults to location.assign. */
  documentNavigate?:(url:string)=>void;
}
const own=(owner:BrowserPageOwner):BrowserPageOwner=>{let closing:Promise<void>|undefined;return {dispose:()=>closing??=Promise.resolve().then(()=>owner.dispose())};};
const routers=new WeakMap<HTMLElement,unknown>();
const windows=new WeakSet<Window>();
const token=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
/** Inert until explicitly created. No document/Node globals are read on import. */
export function createBrowserRouter(options:BrowserRouterOptions){
  if(!options||!options.root||typeof options.root.querySelector!=='function'||!options.root.isConnected||typeof options.scope!=='function'||options.fetch!==undefined&&typeof options.fetch!=='function'||options.onError!==undefined&&typeof options.onError!=='function'||options.documentNavigate!==undefined&&typeof options.documentNavigate!=='function'||options.initialOwner!==undefined&&typeof options.initialOwner.dispose!=='function'||options.prefetch!==undefined&&typeof options.prefetch!=='boolean')throw new NavigationError('NAVIGATION_OPTIONS_INVALID');
  const root=options.root,doc=root.ownerDocument,win=doc.defaultView;
  if(!win||!root.id||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(root.id)||routers.has(root)||windows.has(win))throw new NavigationError('NAVIGATION_ROOT_INVALID');
  const manifest=readPublicRouteManifest(options.manifest),renderer=options.renderer??createDocumentNavigationRenderer(),transport=options.fetch??win.fetch?.bind(win);
  const timeout=options.timeoutMs??10000,maxBytes=options.maxBytes??1048576,maxNodes=options.maxNodes??10000,maxActive=options.maxActive??4,maxPrefetch=options.maxPrefetch??8;
  if(!transport||!renderer||typeof renderer.prepare!=='function'||!Number.isSafeInteger(timeout)||timeout<1||timeout>120000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16777216||!Number.isSafeInteger(maxNodes)||maxNodes<1||maxNodes>100000||!Number.isSafeInteger(maxActive)||maxActive<1||maxActive>32||!Number.isSafeInteger(maxPrefetch)||maxPrefetch<0||maxPrefetch>32)throw new NavigationError('NAVIGATION_LIMIT_INVALID');
  const report=(code:string)=>{try{options.onError?.(NAVIGATION_ERROR_CODES.find(value=>value===code)??'NAVIGATION_FAILED');}catch{/* Observation cannot replace navigation. */}};
  const scope=()=>{const value=options.scope();if(!token(value))throw new NavigationError('NAVIGATION_SCOPE_INVALID');return value;};
  const currentScope=scope(),policy=root.getAttribute('data-zerux-policy');
  if(!token(policy)||root.getAttribute('data-zerux-scope')!==currentScope)throw new NavigationError('NAVIGATION_DOCUMENT_IDENTITY_REQUIRED');
  let closed=false,serial=0,currentUrl=new URL(win.location.href),currentRoute=matchNavigationRoute(manifest,currentUrl.pathname)?.route??null,currentOwner=options.initialOwner?own(options.initialOwner):undefined,currentController:AbortController|undefined,currentPageController:AbortController|undefined;
  if(!withinBase(currentUrl.pathname,manifest.basePath))throw new NavigationError('NAVIGATION_BASE_MISMATCH');
  const declaredInitial=manifest.routes.find(route=>route.id===root.getAttribute('data-zerux-route'));
  if(!declaredInitial||declaredInitial!==currentRoute&&![manifest.boundaries.notFound,manifest.boundaries.error].includes(declaredInitial.id))throw new NavigationError('NAVIGATION_INITIAL_ROUTE_INVALID');
  currentRoute=declaredInitial;
  const jobs=new Set<Promise<unknown>>(),prefetches=new Map<string,number>(),prefetchJobs=new Set<Promise<unknown>>(),prefetchControllers=new Set<AbortController>();
  const positions=new Map<number,{x:number;y:number;focus:string}>();let historyId=0,currentHistory=0,pageCounter=0,currentPageId=0,intentTimer:ReturnType<typeof setTimeout>|undefined,closing:Promise<void>|undefined;
  const oldRestoration=win.history.scrollRestoration;
  const announce=doc.createElement('div');announce.setAttribute('role','status');announce.setAttribute('aria-live','polite');announce.setAttribute('aria-atomic','true');Object.assign(announce.style,{position:'absolute',width:'1px',height:'1px',overflow:'hidden',clipPath:'inset(50%)'});doc.body.append(announce);
  const save=()=>{positions.set(currentHistory,{x:win.scrollX,y:win.scrollY,focus:doc.activeElement?.id??''});if(positions.size>128)positions.delete(positions.keys().next().value!);};
  const state=(id:number)=>({...win.history.state,__zeruxNavigation:{version:1,id,page:currentPageId}});
  try{win.history.replaceState(state(0),'');win.history.scrollRestoration='manual';}catch(error){announce.remove();throw new NavigationError('NAVIGATION_HISTORY_UNAVAILABLE');}
  const full=(url:URL)=>{if(closed)return;if(!/^https?:$/.test(url.protocol)||url.username||url.password){report('NAVIGATION_URL_DENIED');return;}try{(options.documentNavigate??(value=>win.location.assign(value)))(url.href);}catch{report('NAVIGATION_DOCUMENT_FAILED');}};
  const read=async(response:Response,signal:AbortSignal,budget=maxBytes)=>{
    if(!response.body)return '';
    const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
    const abort=()=>void reader.cancel().catch(()=>{});signal.addEventListener('abort',abort,{once:true});
    try{while(true){signal.throwIfAborted();const item=await reader.read();signal.throwIfAborted();if(item.done)break;size+=item.value.byteLength;if(size>budget)throw new NavigationError('NAVIGATION_BODY_LIMIT');text+=decoder.decode(item.value,{stream:true});}return text+decoder.decode();}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();signal.removeEventListener('abort',abort);}
  };
  const eligible=(url:URL)=>url.origin===win.location.origin&&!url.username&&!url.password&&/^https?:$/.test(url.protocol)&&url.href.length<=8192&&withinBase(url.pathname,manifest.basePath);
  const restore=(url:URL,position?:{x:number;y:number;focus:string})=>{
    let anchor:HTMLElement|null=null;if(url.hash)try{anchor=doc.getElementById(decodeURIComponent(url.hash.slice(1)));}catch{/* Invalid fragment keeps normal top restoration. */}
    const focus=position?.focus?doc.getElementById(position.focus):null;
    const target=focus??anchor??root.querySelector<HTMLElement>('[data-zerux-focus],h1')??root;
    const prior=target.getAttribute('tabindex');if(!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');target.focus({preventScroll:true});if(prior===null)target.removeAttribute('tabindex');
    if(position)win.scrollTo(position.x,position.y);else if(anchor)anchor.scrollIntoView?.();else win.scrollTo(0,0);
  };
  const navigate=(input:string|URL,mode:'push'|'replace'|'pop'='push',position?:{x:number;y:number;focus:string},page?:number):Promise<'committed'|'cancelled'|'document'>=>{
    let url:URL;try{url=new URL(input,currentUrl);}catch{return Promise.reject(new NavigationError('NAVIGATION_URL_INVALID'));}
    if(closed)return Promise.reject(new NavigationError('NAVIGATION_CLOSED'));
    if(!/^https?:$/.test(url.protocol)||url.username||url.password)return Promise.reject(new NavigationError('NAVIGATION_URL_DENIED'));
    if(!eligible(url)){full(url);return Promise.resolve('document');}
    const sequence=++serial;currentController?.abort();
    if(url.pathname===currentUrl.pathname&&url.search===currentUrl.search&&(mode==='pop'?page===currentPageId:url.hash!==currentUrl.hash||!!url.hash||url.href.endsWith('#'))){
      if(mode!=='pop'){save();win.history[mode==='replace'?'replaceState':'pushState'](state(++historyId),'',url);currentHistory=historyId;}currentUrl=url;restore(url,position);return Promise.resolve('committed');
    }
    if(jobs.size>=maxActive){report('NAVIGATION_OVERLOAD');full(url);return Promise.resolve('document');}
    const controller=new AbortController();currentController=controller;const timer=setTimeout(()=>controller.abort(),timeout);
    const job=(async()=>{
      let prepared:Awaited<ReturnType<BrowserNavigationRenderer['prepare']>>|undefined,committed=false,loading=true;
      const cleanups:(()=>void|Promise<void>)[]=[];let release:Promise<void>|undefined;
      const cleanup=()=>release??=(async()=>{const errors:unknown[]=[];try{await prepared?.dispose();}catch(error){errors.push(error);}for(const dispose of cleanups.reverse())try{await dispose();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Navigation cleanup failed');})();
      const cache=new Map<string,Promise<unknown>>();
      try{
        const authenticatedScope=scope();
        const response=await transport(url.href,{method:'GET',headers:{accept:'text/html'},credentials:'same-origin',cache:'no-store',signal:controller.signal,redirect:'follow'});
        if(sequence!==serial||controller.signal.aborted){await response.body?.cancel();if(sequence===serial)controller.signal.throwIfAborted();return 'cancelled' as const;}
        const finalUrl=new URL(response.url||url.href);if(!finalUrl.hash&&!response.redirected)finalUrl.hash=url.hash;
        const match=matchNavigationRoute(manifest,finalUrl.pathname),boundary=response.status===404?manifest.boundaries.notFound:response.status>=500?manifest.boundaries.error:undefined;
        const route=boundary?manifest.routes.find(route=>route.id===boundary):match?.route;
        if(!eligible(finalUrl)||response.status===401||response.status===403||response.status>=400&&!boundary||!route||!/^text\/html(?:;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();full(finalUrl);return 'document' as const;}
        const html=await read(response,controller.signal),parsed=new win.DOMParser().parseFromString(html,'text/html'),incoming=parsed.getElementById(root.id);
        if(parsed.querySelectorAll('*').length>maxNodes)throw new NavigationError('NAVIGATION_DOCUMENT_LIMIT');
        if(!incoming||parsed.querySelectorAll('[id]').length>10000||parsed.querySelectorAll('#'+root.id).length!==1||incoming.getAttribute('data-zerux-route')!==route.id||incoming.getAttribute('data-zerux-policy')!==policy||incoming.getAttribute('data-zerux-scope')!==authenticatedScope||authenticatedScope!==currentScope||scope()!==authenticatedScope){full(finalUrl);return 'document' as const;}
        const context:BrowserNavigationContext=Object.freeze({signal:controller.signal,url:finalUrl,route,params:match?.params??Object.freeze({}),scope:authenticatedScope,onDispose(dispose:()=>void|Promise<void>){if(!loading||typeof dispose!=='function'||cleanups.length>=32)throw new NavigationError('NAVIGATION_CLEANUP_INVALID');cleanups.push(dispose);},load<T>(key:string,producer:(signal:AbortSignal)=>Promise<T>):Promise<T>{if(!loading||!token(key)||typeof producer!=='function')throw new NavigationError('NAVIGATION_LOADER_INVALID');controller.signal.throwIfAborted();if(!cache.has(key)){if(cache.size>=16)throw new NavigationError('NAVIGATION_LOADER_LIMIT');cache.set(key,Promise.resolve().then(()=>{controller.signal.throwIfAborted();return producer(controller.signal);}));}return cache.get(key)! as Promise<T>;}});
        prepared=await renderer.prepare({root,incoming:doc.importNode(incoming,true),previous:currentRoute,context});
        loading=false;await Promise.all(cache.values());
        if(sequence!==serial)return 'cancelled' as const;controller.signal.throwIfAborted();
        if(scope()!==authenticatedScope){full(finalUrl);return 'document' as const;}
        if(!prepared||typeof prepared.commit!=='function'||typeof prepared.dispose!=='function')throw new NavigationError('NAVIGATION_RENDERER_INVALID');
        if(mode!=='pop')save();
        currentPageController?.abort();await currentOwner?.dispose();
        if(sequence!==serial)return 'cancelled' as const;controller.signal.throwIfAborted();
        prepared.commit();committed=true;currentOwner=own({dispose:cleanup});currentPageController=controller;currentController=undefined;currentRoute=route;currentUrl=finalUrl;
        root.setAttribute('data-zerux-route',route.id);doc.title=parsed.title;
        currentPageId=mode==='pop'?page??++pageCounter:++pageCounter;
        if(mode!=='pop'){win.history[mode==='replace'?'replaceState':'pushState'](state(++historyId),'',finalUrl);currentHistory=historyId;}
        else if(finalUrl.href!==win.location.href)win.history.replaceState(state(currentHistory),'',finalUrl);
        restore(finalUrl,position);announce.textContent=parsed.title||root.querySelector('h1')?.textContent||'Page changed';return 'committed' as const;
      }catch(error){if(sequence!==serial||controller.signal.aborted){if(sequence===serial&&!closed){report('NAVIGATION_TIMEOUT');full(url);return 'document' as const;}return 'cancelled' as const;}report(error instanceof NavigationError?error.code:'NAVIGATION_FAILED');full(url);return 'document' as const;}
      finally{loading=false;clearTimeout(timer);try{if(!committed){controller.abort();await cleanup();}}finally{await Promise.allSettled(cache.values());cache.clear();}}
    })();jobs.add(job);void job.finally(()=>jobs.delete(job)).catch(()=>{});return job;
  };
  const link=(event:Event)=>{
    const target=event.target as Element|null,anchor=target?.closest?.('a[href]') as HTMLAnchorElement|null;
    if(!anchor||anchor.namespaceURI!=='http://www.w3.org/1999/xhtml'||anchor.hasAttribute('download')||anchor.hasAttribute('data-zerux-reload')||anchor.target&&anchor.target.toLowerCase()!=='_self'||anchor.relList.contains('external')||anchor.closest('[contenteditable]:not([contenteditable="false"])'))return null;
    try{const url=new URL(anchor.href);return eligible(url)?url:null;}catch{return null;}
  };
  const click=(event:MouseEvent)=>{if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;const url=link(event);if(!url)return;event.preventDefault();void navigate(url).catch(()=>report('NAVIGATION_FAILED'));};
  const pop=(event:PopStateEvent)=>{const state=event.state?.__zeruxNavigation;if(!state||state.version!==1||!Number.isSafeInteger(state.id)||state.id<0||!Number.isSafeInteger(state.page)||state.page<0){full(new URL(win.location.href));return;}save();currentHistory=state.id;void navigate(win.location.href,'pop',positions.get(state.id),state.page).catch(()=>report('NAVIGATION_FAILED'));};
  const prefetch=async(input:string|URL)=>{
    if(closed||!options.prefetch||!maxPrefetch||prefetchJobs.size>=2)return false;
    const url=new URL(input,currentUrl);if(!eligible(url))return false;const asset=matchNavigationRoute(manifest,url.pathname)?.route.asset;if(!asset)return false;
    const key=asset.url+' '+asset.integrity;if((prefetches.get(key)??0)>Date.now())return true;
    for(const [cached,expires]of prefetches)if(expires<=Date.now())prefetches.delete(cached);
    if(prefetches.size>=maxPrefetch)return false;
    const controller=new AbortController();prefetchControllers.add(controller);prefetches.set(key,Date.now()+30000);const timer=setTimeout(()=>controller.abort(),timeout);
    const task=(async()=>{try{const response=await transport(new URL(asset.url,win.location.origin),{credentials:'omit',cache:'force-cache',integrity:asset.integrity,redirect:'error',signal:controller.signal});if(!response.ok){await response.body?.cancel();throw new NavigationError('NAVIGATION_PREFETCH_FAILED');}await read(response,controller.signal,Math.min(maxBytes,524288));return true;}catch{prefetches.delete(key);report('NAVIGATION_PREFETCH_FAILED');return false;}finally{clearTimeout(timer);prefetchControllers.delete(controller);}})();prefetchJobs.add(task);try{return await task;}finally{prefetchJobs.delete(task);}
  };
  const intent=(event:Event)=>{const url=link(event);if(!url)return;clearTimeout(intentTimer);intentTimer=setTimeout(()=>void prefetch(url),100);};
  const clearIntent=()=>clearTimeout(intentTimer);
  doc.addEventListener('click',click);win.addEventListener('popstate',pop);
  if(options.prefetch){doc.addEventListener('pointerover',intent);doc.addEventListener('focusin',intent);doc.addEventListener('pointerout',clearIntent);doc.addEventListener('focusout',clearIntent);}
  const api={navigate:(url:string|URL)=>navigate(url),prefetch,get pending(){return jobs.size;},get pendingPrefetch(){return prefetchJobs.size;},close(){return closing??=(async()=>{closed=true;serial++;clearTimeout(intentTimer);currentController?.abort();currentPageController?.abort();for(const controller of prefetchControllers)controller.abort();doc.removeEventListener('click',click);win.removeEventListener('popstate',pop);doc.removeEventListener('pointerover',intent);doc.removeEventListener('focusin',intent);doc.removeEventListener('pointerout',clearIntent);doc.removeEventListener('focusout',clearIntent);announce.remove();win.history.scrollRestoration=oldRestoration;const results=await Promise.allSettled([...jobs,...prefetchJobs]);const errors=results.filter(result=>result.status==='rejected').map(result=>(result as PromiseRejectedResult).reason);try{await currentOwner?.dispose();}catch(error){errors.push(error);}finally{positions.clear();prefetches.clear();routers.delete(root);windows.delete(win);}if(errors.length)throw new AggregateError(errors,'Navigation cleanup failed');})();}};
  routers.set(root,api);windows.add(win);return api;
}
