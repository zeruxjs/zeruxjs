import {compileRoutePattern,compareRoutePatterns,sanitizePathname} from './route-pattern.js';
export interface PublicRouteAsset {readonly url:string;readonly integrity:string}
export interface NavigationRouteMetadata {
  id:string;
  layouts?:readonly string[];
  clientEntry?:string;
}
export interface PublicNavigationRoute {
  readonly id:string;
  readonly pattern:string;
  readonly parameters:readonly {readonly name:string;readonly catchAll:boolean}[];
  readonly layouts:readonly string[];
  readonly asset?:PublicRouteAsset;
}
export interface PublicRouteManifest {
  readonly version:1;
  readonly basePath:string;
  readonly routes:readonly PublicNavigationRoute[];
  readonly boundaries:Readonly<{notFound?:string;error?:string}>;
}
export interface PublicRouteManifestOptions {
  basePath?:string;
  assets?:{entry(name:string):PublicRouteAsset};
  boundaries?:{notFound?:string;error?:string};
}
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value)&&!['constructor','prototype'].includes(value);
export const NAVIGATION_ERROR_CODES=Object.freeze(['NAVIGATION_ASSET_INVALID', 'NAVIGATION_ASSET_REQUIRED', 'NAVIGATION_BASE_MISMATCH', 'NAVIGATION_BODY_LIMIT', 'NAVIGATION_BOUNDARY_INVALID', 'NAVIGATION_CLEANUP_INVALID', 'NAVIGATION_CLOSED', 'NAVIGATION_DOCUMENT_FAILED', 'NAVIGATION_DOCUMENT_LIMIT', 'NAVIGATION_DOCUMENT_IDENTITY_REQUIRED', 'NAVIGATION_DOCUMENT_UNSAFE', 'NAVIGATION_FAILED', 'NAVIGATION_HISTORY_UNAVAILABLE', 'NAVIGATION_INITIAL_ROUTE_INVALID', 'NAVIGATION_LAYOUT_INVALID', 'NAVIGATION_LIMIT_INVALID', 'NAVIGATION_LOADER_INVALID', 'NAVIGATION_LOADER_LIMIT', 'NAVIGATION_MANIFEST_INVALID', 'NAVIGATION_MODULE_INVALID', 'NAVIGATION_MODULE_LOADER_REQUIRED', 'NAVIGATION_OPTIONS_INVALID', 'NAVIGATION_OVERLOAD', 'NAVIGATION_PAGE_CLOSED', 'NAVIGATION_PREFETCH_FAILED', 'NAVIGATION_RENDERER_INVALID', 'NAVIGATION_ROOT_INVALID', 'NAVIGATION_ROUTE_INVALID', 'NAVIGATION_SCOPE_INVALID', 'NAVIGATION_TIMEOUT', 'NAVIGATION_URL_DENIED', 'NAVIGATION_URL_INVALID'] as const);
export type NavigationErrorCode=typeof NAVIGATION_ERROR_CODES[number];
export class NavigationError extends Error {
  readonly code:NavigationErrorCode;
  constructor(code:string){const safe=NAVIGATION_ERROR_CODES.find(value=>value===code)??'NAVIGATION_FAILED';super(safe);this.code=safe;this.name='NavigationError';}
}
export function routeAsset(value:PublicRouteAsset):PublicRouteAsset {
  const url=value?.url,integrity=value?.integrity;
  if(typeof url!=='string'||url.length>2048||!/^\/(?!\/)[A-Za-z0-9_./-]+\.m?js$/.test(url)||url.split('/').some(part=>part==='.'||part==='..')||typeof integrity!=='string'||!/^sha256-[A-Za-z0-9+/]{43}=$/.test(integrity))throw new NavigationError('NAVIGATION_ASSET_INVALID');
  return Object.freeze({url,integrity});
}
export function withinBase(pathname:string,base:string):boolean{return base==='/'||pathname===base||pathname.startsWith(base+'/');}
/** Also used by the browser to validate an untrusted serialized manifest. */
export function readPublicRouteManifest(value:unknown):PublicRouteManifest {
  const input=value as PublicRouteManifest;
  if(!input||input.version!==1||typeof input.basePath!=='string'||!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(input.basePath)||!Array.isArray(input.routes)||input.routes.length>1024||!input.boundaries||typeof input.boundaries!=='object')throw new NavigationError('NAVIGATION_MANIFEST_INVALID');
  const ids=new Set<string>(),patterns=new Set<string>();
  const routes=input.routes.map((route:PublicNavigationRoute)=>{
    if(!route||!identifier(route.id)||ids.has(route.id)||typeof route.pattern!=='string'||route.pattern.length>2048||sanitizePathname(route.pattern)!==route.pattern||!withinBase(route.pattern,input.basePath)||(route.pattern!=='/'&&(!route.pattern.startsWith('/')||!route.pattern.slice(1).split('/').every(part=>/^[A-Za-z0-9_.{}:-]+\*?$/.test(part))))||patterns.has(route.pattern)||!Array.isArray(route.layouts)||route.layouts.length>8||!route.layouts.every(identifier)||new Set(route.layouts).size!==route.layouts.length)throw new NavigationError('NAVIGATION_ROUTE_INVALID');
    const parts=route.pattern.split('/').filter(Boolean),names=parts.filter(part=>part.startsWith(':')).map(part=>({name:part.replace(/^:|\*$/g,''),catchAll:part.endsWith('*')}));
    if(names.some(item=>!identifier(item.name))||new Set(names.map(item=>item.name)).size!==names.length||parts.some((part,index)=>part.includes('*')&&(!part.startsWith(':')||index!==parts.length-1)))throw new NavigationError('NAVIGATION_ROUTE_INVALID');
    compileRoutePattern(route.pattern);ids.add(route.id);patterns.add(route.pattern);
    return Object.freeze({id:route.id,pattern:route.pattern,parameters:Object.freeze(names.map(item=>Object.freeze(item))),layouts:Object.freeze([...route.layouts]),...(route.asset?{asset:routeAsset(route.asset)}:{})});
  });
  const boundaries:{notFound?:string;error?:string}={};
  for(const key of ['notFound','error'] as const){const id=input.boundaries[key];if(id!==undefined){if(!identifier(id)||!ids.has(id))throw new NavigationError('NAVIGATION_BOUNDARY_INVALID');boundaries[key]=id;}}
  return Object.freeze({version:1,basePath:input.basePath,routes:Object.freeze(routes),boundaries:Object.freeze(boundaries)});
}
/** Called by the real runtime after explicit route registration; never executes files. */
export function createPublicRouteManifest(options:PublicRouteManifestOptions&{routes:readonly (NavigationRouteMetadata&{pattern:string})[]}):PublicRouteManifest {
  if(!options||!Array.isArray(options.routes)||options.routes.length>1024)throw new NavigationError('NAVIGATION_MANIFEST_INVALID');
  return readPublicRouteManifest({version:1,basePath:options.basePath??'/',boundaries:options.boundaries??{},routes:[...options.routes].sort(compareRoutePatterns).map(route=>({id:route.id,pattern:route.pattern,layouts:route.layouts??[],...(route.clientEntry!==undefined?{asset:options.assets?.entry(route.clientEntry)??(()=>{throw new NavigationError('NAVIGATION_ASSET_REQUIRED');})()}:{})}))});
}
export function matchNavigationRoute(manifest:PublicRouteManifest,pathname:string):{route:PublicNavigationRoute;params:Readonly<Record<string,string>>}|null {
  if(!withinBase(pathname,manifest.basePath))return null;
  for(const route of manifest.routes){const match=compileRoutePattern(route.pattern).regex.exec(sanitizePathname(pathname));if(match)return {route,params:Object.freeze({...match.groups})};}
  return null;
}
