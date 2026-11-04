/** Explicit application-scoped compression owner. Uses the proxy implementation. */
import type { IncomingMessage, ServerResponse, IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import {forwardCompressedResponse,validateCompressionOptions,appendVary,type ProxyCompressionOptions} from './portless/proxy-compression.js';
export type {ProxyCompressionOptions} from './portless/proxy-compression.js';
export interface CompressionMeasurement {encoding:'br'|'gzip'|'deflate'|'zstd';outputBytes:number;durationMs:number;outcome:'completed'|'cancelled'|'error'}
export interface CompressionOwnerOptions extends ProxyCompressionOptions {maxConcurrent?:number;onMeasure?:(measurement:Readonly<CompressionMeasurement>)=>void}
export function createCompressionOwner(options:CompressionOwnerOptions={}){
 const config=validateCompressionOptions(options);config.encodings=[...config.encodings];const max=options.maxConcurrent??8,measure=options.onMeasure;
 if(!Number.isSafeInteger(max)||max<1||max>128||measure!==undefined&&typeof measure!=='function')throw new TypeError('Invalid compression owner');
 const active=new Map<Readable,Promise<void>>(),responses=new Map<ServerResponse,{source:Readable;done:Promise<void>}>();let closed=false,overloaded=0;
 return {
  forward(request:IncomingMessage,source:Readable&{headers:IncomingHttpHeaders;statusCode?:number},response:ServerResponse):void{
   if(closed)throw new Error('Compression owner closed');
   // No queue or replay: identity at capacity, or the common owner's 406 if forbidden.
   const saturated=active.size>=max;if(saturated){overloaded++;source.headers={...source.headers,vary:appendVary(source.headers.vary,'Accept-Encoding')};}
   const doneResponse=new Promise<void>(resolve=>response.once('close',()=>{responses.delete(response);resolve();}));responses.set(response,{source,done:doneResponse});
   const started=performance.now();const encoder=forwardCompressedResponse(request,source,response,saturated?{...config,enabled:false}:config);
   if(!encoder)return;
   let bytes=0,failed=false;const encoding=response.getHeader('content-encoding') as CompressionMeasurement['encoding'];
   const data=(chunk:Buffer)=>{bytes+=chunk.length;};const error=()=>{failed=true;};
   encoder.on('data',data);encoder.on('error',error);
   const done=new Promise<void>(resolve=>encoder.once('close',()=>{active.delete(encoder);if(!response.writableFinished){source.destroy();response.destroy();}encoder.off('data',data);encoder.off('error',error);try{const observation:unknown=measure?.(Object.freeze({encoding,outputBytes:bytes,durationMs:performance.now()-started,outcome:failed?'error':response.writableFinished?'completed':'cancelled'}));if(observation&&typeof (observation as PromiseLike<unknown>).then==='function')void Promise.resolve(observation).catch(()=>{});}catch{/* Observation never changes delivery. */}resolve();}));
   active.set(encoder,done);
  },
  status(){return {active:active.size,overloaded};},
  async close(){closed=true;const pending=[...active.values(),...[...responses.values()].map(v=>v.done)];for(const {source}of responses.values())source.destroy();for(const response of responses.keys())response.destroy();for(const encoder of active.keys())encoder.destroy();await Promise.all(pending);}
 };
}
