import {RendererError, type RendererAdapter, type RendererContext} from './renderers.js';
import {validateResponseHeaders} from './response.js';

export interface RenderAsset {readonly url:string;readonly integrity:string}
function renderAsset(value:unknown):RenderAsset {
  const asset=value as RenderAsset;
  if(!asset||typeof asset.url!=='string'||asset.url.length>2048||!/^\/(?!\/)[A-Za-z0-9_./-]+$/.test(asset.url)||asset.url.split('/').some(part=>part==='.'||part==='..')||typeof asset.integrity!=='string'||!/^sha256-[A-Za-z0-9+/]{43}=$/.test(asset.integrity))throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
  return Object.freeze({url:asset.url,integrity:asset.integrity});
}
/** Consume only the generated public manifest; no private source paths enter HTML. */
export function createRenderAssets(input:unknown):{entry(name:string):RenderAsset} {
  if(!input||typeof input!=='object')throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
  const manifest=input as {schema?:unknown;assets?:unknown;namedEntries?:unknown};
  if(manifest.schema!==1||!Array.isArray(manifest.assets)||manifest.assets.length>10000||!manifest.namedEntries||typeof manifest.namedEntries!=='object'||Array.isArray(manifest.namedEntries)||Object.keys(manifest.namedEntries).length>32)throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
  const assets=new Map<string,RenderAsset>();
  for(const asset of manifest.assets){
    const captured=renderAsset(asset);
    if(assets.has(captured.url))throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
    assets.set(captured.url,captured);
  }
  const entries=new Map<string,RenderAsset>();
  for(const [name,url]of Object.entries(manifest.namedEntries)){
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(name)||typeof url!=='string'||!assets.has(url)||!/\.m?js$/.test(url))throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
    entries.set(name,assets.get(url)!);
  }
  return Object.freeze({entry(name:string){const asset=entries.get(name);if(!asset)throw new RendererError('RENDER_ASSET_ENTRY_MISSING');return asset;}});
}
export interface ZyroDocumentOutput {html:string;/** The encoded data from zyrojs/server, never HTML-escaped JSON. */data?:string;version?:1;idPrefix?:string}
export interface ZyroDocumentOptions<V> {
  render(view:V,context:RendererContext):ZyroDocumentOutput|Promise<ZyroDocumentOutput>;
  /** One host-owned security policy response per document, before any output. */
  security():{nonce?:string;headers:Record<string,string>};
  assets?:ReturnType<typeof createRenderAssets>;
  clientEntry?:string;
  rootId?:string;
  /** Trusted authored HTML surrounding the component root; not a second UI runtime. */
  layout?(view:V,context:RendererContext):{before:string;after:string};
  /** Handles pre-commit rendering failures only. Internal errors are not serialized. */
  errorBoundary?(error:unknown,context:RendererContext):ZyroDocumentOutput|Promise<ZyroDocumentOutput>;
}
/** Static HTTP document with optional explicit Zyro V1 bootstrap asset.
 * Document streaming chunks already-rendered HTML; incremental component streams remain separate adapters; no runtime or bundler is imported. */
export function createZyroDocumentRenderer<V>(options:ZyroDocumentOptions<V>):RendererAdapter<V>{
  if(!options||typeof options.render!=='function'||typeof options.security!=='function'||options.layout!==undefined&&typeof options.layout!=='function'||options.errorBoundary!==undefined&&typeof options.errorBoundary!=='function')throw new RendererError('RENDER_DOCUMENT_OPTIONS_INVALID');
  const {render,security,layout,errorBoundary,assets,clientEntry}=options,rootId=options.rootId??'zyro-root';
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(rootId)||clientEntry!==undefined&&(!assets||typeof clientEntry!=='string'))throw new RendererError('RENDER_DOCUMENT_OPTIONS_INVALID');
  // Resolve at registration, before this generation can serve requests.
  const asset=clientEntry===undefined?undefined:renderAsset(assets!.entry(clientEntry));
  return {name:'zyro-document',capabilities:{staticHtml:true,streaming:true,hydration:false,clientOnly:false},async render(view,context){
    context.signal.throwIfAborted();
    const policy=security();validateResponseHeaders(policy.headers);
    if(policy.nonce!==undefined&&(typeof policy.nonce!=='string'||!/^[A-Za-z0-9+/_-]{22,86}={0,2}$/.test(policy.nonce)))throw new RendererError('RENDER_DOCUMENT_NONCE_INVALID');
    const headers={...policy.headers,'cache-control':'no-store'};
    let output:ZyroDocumentOutput;
    try{output=await render(view,context);}catch(error){context.signal.throwIfAborted();if(!errorBoundary)throw error;output=await errorBoundary(error,context);}
    context.signal.throwIfAborted();
    if(!output||typeof output.html!=='string')throw new RendererError('RENDER_DOCUMENT_OUTPUT_INVALID');
    const shell=layout?.(view,context)??{before:'<!doctype html><html><head><meta charset="utf-8"></head><body>',after:'</body></html>'};
    if(!shell||typeof shell.before!=='string'||typeof shell.after!=='string')throw new RendererError('RENDER_DOCUMENT_LAYOUT_INVALID');
    let bootstrap='';
    if(output.data!==undefined){
      if(!asset||!policy.nonce||output.version!==1||typeof output.data!=='string'||Buffer.byteLength(output.data)>1048576||/[<>&\u2028\u2029]/.test(output.data))throw new RendererError('RENDER_DOCUMENT_HYDRATION_INVALID');
      let data;try{data=JSON.parse(output.data);}catch{throw new RendererError('RENDER_DOCUMENT_HYDRATION_INVALID');}
      if(data?.version!==1||data.idPrefix!==output.idPrefix||typeof data.idPrefix!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(data.idPrefix)||Object.keys(data).sort().join(',')!=='idPrefix,props,version')throw new RendererError('RENDER_DOCUMENT_HYDRATION_INVALID');
      const nonce=policy.nonce;
      const csp=Object.entries(headers).find(([key])=>key.toLowerCase()==='content-security-policy')?.[1];
      if(!csp?.split(';').some(directive=>/^\s*script-src\s/.test(directive)&&directive.split(/\s+/).includes(`'nonce-${nonce}'`)))throw new RendererError('RENDER_DOCUMENT_NONCE_POLICY_REQUIRED');
      bootstrap=`<script type="application/json" id="${rootId}-data" nonce="${nonce}">${output.data}</script><script type="module" src="${asset.url}" integrity="${asset.integrity}" crossorigin="anonymous" nonce="${nonce}"></script>`;
    }else if(asset)throw new RendererError('RENDER_DOCUMENT_HYDRATION_DATA_REQUIRED');
    const parts=[shell.before,`<div id="${rootId}">${output.html}</div>`,bootstrap,shell.after];
    if(context.feature==='streaming')return {kind:'stream',source:(async function*(){for(const part of parts){context.signal.throwIfAborted();yield part;}})(),headers};
    return {kind:'html',html:parts.join(''),headers};
  }};
}
