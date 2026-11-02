import type {ReactElement} from 'react';
import {ReactAdapterError,checkReactAbort,reactPrefix,reactByteLimit,validateReactVersions,importedDefault} from './render-errors.js';
export {ReactAdapterError} from './render-errors.js';
export interface ReactServerOptions{identifierPrefix?:string;signal?:AbortSignal;maxBytes?:number}
async function peers(){
 try{
  const [reactModule,serverModule]=await Promise.all([import('react'),import('react-dom/server')]);
  const React=importedDefault(reactModule),server=importedDefault(serverModule);
  validateReactVersions(React.version,server.version);
  if(typeof React.isValidElement!=='function'||typeof server.renderToString!=='function'||typeof server.renderToStaticMarkup!=='function')throw new ReactAdapterError('REACT_CAPABILITY_UNAVAILABLE');
  return {React,server};
 }catch(cause){throw cause instanceof ReactAdapterError?cause:new ReactAdapterError('REACT_DEPENDENCY_UNAVAILABLE',cause)}
}
async function render(view:ReactElement|null,options:ReactServerOptions,staticOnly:boolean):Promise<string>{
 options={...options};
 const prefix=options.identifierPrefix??'',limit=reactByteLimit(options.maxBytes);reactPrefix(prefix);checkReactAbort(options.signal);
 const {React,server}=await peers();checkReactAbort(options.signal);
 if(view!==null&&!React.isValidElement(view))throw new ReactAdapterError('INVALID_REACT_ELEMENT');
 try{
  const html=staticOnly?server.renderToStaticMarkup(view,{identifierPrefix:prefix}):server.renderToString(view,{identifierPrefix:prefix});
  checkReactAbort(options.signal);
  // React development fallback templates may contain private error stacks/messages.
  // Incomplete native string-SSR boundaries need a streaming/data contract we do not provide.
  if(html.includes('<!--$!-->'))throw new ReactAdapterError('REACT_INCOMPLETE_SSR');
  if(new TextEncoder().encode(html).length>limit)throw new ReactAdapterError('HTML_BYTE_LIMIT');
  return html;
 }catch(cause){throw cause instanceof ReactAdapterError?cause:new ReactAdapterError('REACT_RENDER_FAILED',cause)}
}
/** Native synchronous SSR behind an async peer-load boundary; does not wait for suspended data. */
export function renderReactToString(view:ReactElement|null,options:ReactServerOptions={}):Promise<string>{return render(view,options,false)}
/** Static HTML is deliberately separate and must not be supplied to hydrateRoot. */
export function renderReactToStaticMarkup(view:ReactElement|null,options:ReactServerOptions={}):Promise<string>{return render(view,options,true)}
export async function getReactServerCapabilities(){const {React}=await peers();return Object.freeze({version:React.version,ssr:true,staticHtml:true,hydration:true,streaming:false})}
