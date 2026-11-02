/** Node-only integration policy. Hosting owns encoders and their concurrency. */
import type {IncomingMessage,ServerResponse,IncomingHttpHeaders} from 'node:http';
import type {Readable} from 'node:stream';
export interface PerformanceResponseOwner {forward(request:IncomingMessage,source:Readable&{headers:IncomingHttpHeaders;statusCode?:number},response:ServerResponse):void}
export interface PerformanceResponsePolicy {/** Required trusted server classification, never a forwarded header. */ authenticated:boolean; /** Explicitly public anonymous response only. */ public?:boolean}
/** Delegates once to a borrowed zhost compression owner; creates no codec or pool. */
export function forwardPerformanceResponse(owner:PerformanceResponseOwner,request:IncomingMessage,source:Readable&{headers:IncomingHttpHeaders;statusCode?:number},response:ServerResponse,policy:PerformanceResponsePolicy):void{
 if(!owner||typeof owner.forward!=='function'||!policy||typeof policy.authenticated!=='boolean'||policy.public!==undefined&&typeof policy.public!=='boolean')throw new TypeError('Invalid performance response policy');
 if(response.headersSent||response.writableEnded||response.destroyed)throw new Error('Response already committed');
 if(policy.authenticated&&policy.public)throw new TypeError('Authenticated responses cannot be public');
 // Cookie/auth headers conservatively override an anonymous public classification.
 const headers:IncomingHttpHeaders={};for(const [name,value]of Object.entries(source.headers)){const normalized=name.toLowerCase();if(Object.hasOwn(headers,normalized))throw new TypeError('Duplicate response header');headers[normalized]=value;}
 const sensitive=policy.authenticated||request.headers.authorization!==undefined||request.headers.cookie!==undefined||headers['set-cookie']!==undefined;
 if(sensitive||!policy.public){headers['cache-control']='private, no-store'+(/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(String(headers['cache-control']??''))?', no-transform':'');delete headers.expires;delete headers['surrogate-control'];delete headers['cdn-cache-control'];}
 source.headers=headers;
 owner.forward(request,source,response);
}
