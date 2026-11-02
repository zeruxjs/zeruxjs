import {NavigationError,type PublicNavigationRoute,type PublicRouteAsset} from './navigation-manifest.js';
export interface BrowserNavigationContext {
  readonly signal:AbortSignal;
  readonly url:URL;
  readonly route:PublicNavigationRoute;
  readonly params:Readonly<Record<string,string>>;
  readonly scope:string;
  onDispose(cleanup:()=>void|Promise<void>):void;
  /** Memoized only within this navigation and authenticated scope. Never persisted. */
  load<T>(key:string,producer:(signal:AbortSignal)=>Promise<T>):Promise<T>;
}
export interface BrowserPageOwner {dispose():void|Promise<void>}
export interface BrowserRouteModule {
  /** Mount only the detached page component. Structural layouts remain host-owned. */
  prepare(root:HTMLElement,context:BrowserNavigationContext):BrowserPageOwner|Promise<BrowserPageOwner>;
}
export interface PreparedBrowserPage extends BrowserPageOwner {commit():void}
export interface BrowserNavigationRenderer {
  prepare(input:{root:HTMLElement;incoming:HTMLElement;previous:PublicNavigationRoute|null;context:BrowserNavigationContext}):Promise<PreparedBrowserPage>;
}
/** Static server DOM works without modules. Optional modules can hydrate a specific runtime. */
export function createDocumentNavigationRenderer(options:{loadModule?:(asset:PublicRouteAsset,signal:AbortSignal)=>Promise<BrowserRouteModule>}={}):BrowserNavigationRenderer {
  if(!options||options.loadModule!==undefined&&typeof options.loadModule!=='function')throw new NavigationError('NAVIGATION_RENDERER_INVALID');
  const loadModule=options.loadModule;
  return {async prepare({root,incoming,previous,context}){
    context.signal.throwIfAborted();
    // Scripts from fetched HTML are never executed. Bootstrap code comes only from
    // manifest modules. Reject active embeds/handlers instead of treating DOMParser as a sanitizer.
    for(const element of [incoming,...incoming.querySelectorAll('*')]){
      if(element.namespaceURI!=='http://www.w3.org/1999/xhtml'||['BASE','IFRAME','OBJECT','EMBED','META'].includes(element.tagName)||[...element.attributes].some(attribute=>/^on/i.test(attribute.name)||/^(?:href|src|action|formaction|xlink:href)$/i.test(attribute.name)&&!['http:','https:','mailto:','tel:'].includes(new URL(attribute.value,'https://localhost/').protocol)))throw new NavigationError('NAVIGATION_DOCUMENT_UNSAFE');
      if(element.tagName==='SCRIPT'&&element.getAttribute('type')!=='application/json')element.remove();
    }
    const chain=(container:HTMLElement,ids:readonly string[])=>{
      const outlets:HTMLElement[]=[];let parent=container;
      for(const id of ids){
        const layouts=[...parent.querySelectorAll<HTMLElement>('[data-zerux-layout]')].filter(node=>node.getAttribute('data-zerux-layout')===id);
        if(layouts.length!==1)throw new NavigationError('NAVIGATION_LAYOUT_INVALID');
        const layout=layouts[0],outlet=layout.querySelector<HTMLElement>(':scope > [data-zerux-outlet]');
        if(!outlet)throw new NavigationError('NAVIGATION_LAYOUT_INVALID');
        outlets.push(outlet);parent=outlet;
      }
      return outlets;
    };
    const nextChain=chain(incoming,context.route.layouts),oldChain=previous?chain(root,previous.layouts):[];
    let common=0;
    if(previous)while(common<previous.layouts.length&&previous.layouts[common]===context.route.layouts[common])common++;
    const target=common?oldChain[common-1]:root,source=common?nextChain[common-1]:incoming;
    let owner:BrowserPageOwner|undefined;
    if(context.route.asset){
      if(!loadModule)throw new NavigationError('NAVIGATION_MODULE_LOADER_REQUIRED');
      const module=await loadModule(context.route.asset,context.signal);context.signal.throwIfAborted();
      if(!module||typeof module.prepare!=='function')throw new NavigationError('NAVIGATION_MODULE_INVALID');
      owner=await module.prepare(incoming,context);
      if(!owner||typeof owner.dispose!=='function')throw new NavigationError('NAVIGATION_MODULE_INVALID');
    }
    let disposed:Promise<void>|undefined,committed=false;
    const dispose=()=>disposed??=Promise.resolve().then(()=>owner?.dispose());
    if(context.signal.aborted){await dispose();context.signal.throwIfAborted();}
    return {commit(){context.signal.throwIfAborted();if(committed||disposed)throw new NavigationError('NAVIGATION_PAGE_CLOSED');committed=true;target.replaceChildren(...source.childNodes);},dispose};
  }};
}
