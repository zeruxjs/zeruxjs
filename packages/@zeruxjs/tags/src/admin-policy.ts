export interface TagAdminAuditEvent {version:1;operationId:string;phase:'intent'|'committed'|'conflict';action:'publish'|'rollback';tenant:string;actor:string;at:number;expectedVersion:number;releaseId?:number;revision?:number;definitionHash:string}
export interface TagAdminMount {
 /** Independent API route prefix and UI page; defaults retain /<prefix>/admin. */
 basePath?:string;uiPath?:string;serveUi?:boolean;publicOrigin?:string;
 allowedOrigins?:readonly string[];maxConcurrent?:number;
 verifyCsrf?:(request:Request)=>boolean|Promise<boolean>;
 issueCsrfToken?:(request:Request)=>string|Promise<string>;
 /** Explicit host-owned files, independent of API prefix. No assets are started/built. */
 styleHref?:string;scriptSrc?:string;
 audit?:(event:Readonly<TagAdminAuditEvent>)=>void|Promise<void>;
 auditContext?:(request:Request)=>{tenant:string;actor:string}|Promise<{tenant:string;actor:string}>;
}
export function adminPath(value:string){if(typeof value!=='string'||!/^\/[A-Za-z0-9/_-]+$/.test(value)||value.includes('//')||value.endsWith('/'))throw new TypeError('Invalid admin base path');return value;}
export function adminOrigin(value:string){const url=new URL(value);if(url.hostname.includes('*')||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new TypeError('Explicit secure admin origin required');return url.origin;}
export function adminAsset(value:string){if(typeof value!=='string'||value.length>2048||/[\s<>"'\\?#]/.test(value)||value.split('/').some(part=>part==='.'||part==='..'))throw new TypeError('Invalid admin asset URL');if(value.startsWith('/')&&!value.startsWith('//')){if(!/^\/[A-Za-z0-9_./-]+$/.test(value))throw new TypeError('Invalid admin asset path');return value;}const url=new URL(value);adminOrigin(url.origin);if(!/^\/[A-Za-z0-9_./-]+$/.test(url.pathname))throw new TypeError('Invalid admin asset path');return url.href;}
