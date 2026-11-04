import {createHash} from 'node:crypto';
export const mediaTranscodePresets=Object.freeze({
 'mp4-h264-aac':Object.freeze({contentType:'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',extension:'mp4'}),
 'webm-vp9-opus':Object.freeze({contentType:'video/webm; codecs="vp9, opus"',extension:'webm'}),
 'webm-opus':Object.freeze({contentType:'audio/webm; codecs="opus"',extension:'webm'})
});
export type MediaTranscodePreset=keyof typeof mediaTranscodePresets;
export interface TranscodeQuotas {maxInputBytes:number;maxOutputBytes:number;maxCpuMs:number;maxWallMs:number;maxMemoryBytes:number;maxFiles:number}
export interface IsolatedMediaJob {
 /** Resolve after the encoder settles/reaps; output reads the completed staged artifact.
  * No caller-supplied filenames/URLs/codec arguments. Statistics cover the completed encoder. */
 run(bytes:Uint8Array,signal:AbortSignal):Promise<{output:AsyncIterable<Uint8Array>;cpuMs:number;peakMemoryBytes:number;filesCreated:number}>;
 /** Must terminate and reap the isolated process/container, settling run/output work. */
 terminate():Promise<void>;
 /** Must remove every temporary input/output, including failures. Called exactly once. */
 dispose():Promise<void>;
}
export interface IsolatedMediaExecutor {
 readonly isolation:'process'|'container';
 readonly network:'disabled';readonly filesystem:'job-private';readonly privilege:'unprivileged';
 readonly hardLimits:{cpu:true;memory:true;files:true};
 readonly supportedPresets:readonly MediaTranscodePreset[];
 create(input:Readonly<{preset:MediaTranscodePreset;quotas:Readonly<TranscodeQuotas>}>):Promise<IsolatedMediaJob>;
}
export interface MediaTranscoderOptions {
 executor:IsolatedMediaExecutor;presets:readonly MediaTranscodePreset[];quotas:TranscodeQuotas;maxPending?:number;
 authorize:(identity:{tenant:string;subject:string},preset:MediaTranscodePreset)=>boolean|Promise<boolean>;
 /** Fixed status/preset labels only; never input bytes, URLs, paths or codec stderr. */
 onEvent?:(event:Readonly<{preset:MediaTranscodePreset;status:'complete'|'failed'|'cancelled'}>)=>void;
}
export class MediaTranscodeError extends Error {constructor(readonly code:string,options?:ErrorOptions){super(code.toLowerCase().replaceAll('_',' '),options);this.name='MediaTranscodeError';}}
const fail=(code:string,cause?:unknown)=>new MediaTranscodeError(code,cause===undefined?undefined:{cause});
/** Explicit coordinator for a host-qualified isolated executor. No executable or codec is bundled. */
export function createMediaTranscoder(options:MediaTranscoderOptions){
 if(!options||!options.executor||!['process','container'].includes(options.executor.isolation)||options.executor.network!=='disabled'||options.executor.filesystem!=='job-private'||options.executor.privilege!=='unprivileged'||options.executor.hardLimits?.cpu!==true||options.executor.hardLimits.memory!==true||options.executor.hardLimits.files!==true||typeof options.executor.create!=='function'||!Array.isArray(options.executor.supportedPresets)||options.executor.supportedPresets.length>3||typeof options.authorize!=='function'||!Array.isArray(options.presets)||!options.presets.length||options.presets.length>3||new Set(options.presets).size!==options.presets.length||options.presets.some(p=>!Object.hasOwn(mediaTranscodePresets,p)||!options.executor.supportedPresets.includes(p)))throw new TypeError('Configured isolated executor and fixed presets required');
 const quotas={...options.quotas},presets=[...options.presets],maxPending=options.maxPending??1;
 const caps:TranscodeQuotas={maxInputBytes:64*1024*1024,maxOutputBytes:64*1024*1024,maxCpuMs:120000,maxWallMs:300000,maxMemoryBytes:2*1024*1024*1024,maxFiles:16};
 if(Object.keys(quotas).length!==6||Object.entries(caps).some(([key,max])=>{const value=quotas[key as keyof TranscodeQuotas];return !Number.isSafeInteger(value)||value<1||value>max;})||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>4)throw new TypeError('Explicit bounded transcoding quotas required');
 const pending=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();let closed=false,closing:Promise<void>|undefined;
 return {
  capabilities(){return Object.freeze({isolation:options.executor.isolation,presets:Object.freeze([...presets]),quotas:Object.freeze({...quotas})});},
  transcode(identity:{tenant:string;subject:string},input:{preset:MediaTranscodePreset;bytes:Uint8Array;sha256:string},signal?:AbortSignal){
   if(closed)return Promise.reject(fail('TRANSCODER_CLOSED'));if(pending.size>=maxPending)return Promise.reject(fail('TRANSCODER_BUSY'));
   const controller=new AbortController();controllers.add(controller);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   const work=(async()=>{
    let started=0;let job:IsolatedMediaJob|undefined,termination:Promise<void>|undefined,timedOut=false,outputComplete=false;let timer:ReturnType<typeof setTimeout>|undefined;
    const terminate=()=>{if(job&&!termination)termination=Promise.resolve().then(()=>job!.terminate());void termination?.catch(()=>{});};controller.signal.addEventListener('abort',terminate,{once:true});
    const preset=input?.preset;
    try{
     if(controller.signal.aborted)throw fail('TRANSCODE_CANCELLED');
     if(!identity||[identity.tenant,identity.subject].some(v=>typeof v!=='string'||! /^[A-Za-z0-9_.:@-]{1,128}$/.test(v)))throw fail('TRANSCODE_IDENTITY');
     if(!input||Object.keys(input).some(key=>!['preset','bytes','sha256'].includes(key))||!presets.includes(input.preset)||!(input.bytes instanceof Uint8Array)||input.bytes.byteLength>quotas.maxInputBytes||!input.bytes.byteLength||! /^[a-f0-9]{64}$/.test(input.sha256))throw fail('TRANSCODE_INPUT');
     const who={...identity},expected=input.sha256,bytes=new Uint8Array(input.bytes);
     if(await options.authorize(who,preset)!==true)throw fail('TRANSCODE_FORBIDDEN');if(controller.signal.aborted)throw fail('TRANSCODE_CANCELLED');
     if(createHash('sha256').update(bytes).digest('hex')!==expected)throw fail('TRANSCODE_INTEGRITY');
     started=performance.now();timer=setTimeout(()=>{timedOut=true;controller.abort();},quotas.maxWallMs);
     job=await options.executor.create(Object.freeze({preset,quotas:Object.freeze({...quotas})}));
     if(!job||typeof job.run!=='function'||typeof job.terminate!=='function'||typeof job.dispose!=='function')throw fail('TRANSCODE_EXECUTOR');
     if(controller.signal.aborted){terminate();throw fail(timedOut?'TRANSCODE_DEADLINE':'TRANSCODE_CANCELLED');}
     const result=await job.run(bytes,controller.signal);
     if(performance.now()-started>quotas.maxWallMs){timedOut=true;controller.abort();throw fail('TRANSCODE_DEADLINE');}
     if(!result||!Number.isFinite(result.cpuMs)||result.cpuMs<0||result.cpuMs>quotas.maxCpuMs||!Number.isSafeInteger(result.peakMemoryBytes)||result.peakMemoryBytes<0||result.peakMemoryBytes>quotas.maxMemoryBytes||!Number.isSafeInteger(result.filesCreated)||result.filesCreated<0||result.filesCreated>quotas.maxFiles)throw fail('TRANSCODE_QUOTA');
     const hash=createHash('sha256'),parts:Uint8Array[]=[];let size=0,count=0;
     for await(const chunk of result.output){if(controller.signal.aborted)throw fail(timedOut?'TRANSCODE_DEADLINE':'TRANSCODE_CANCELLED');if(!(chunk instanceof Uint8Array))throw fail('TRANSCODE_OUTPUT');size+=chunk.byteLength;if(size>quotas.maxOutputBytes||++count>65536)throw fail('TRANSCODE_QUOTA');hash.update(chunk);parts.push(new Uint8Array(chunk));}
     if(performance.now()-started>quotas.maxWallMs){timedOut=true;controller.abort();}
     if(controller.signal.aborted)throw fail(timedOut?'TRANSCODE_DEADLINE':'TRANSCODE_CANCELLED');if(!size)throw fail('TRANSCODE_OUTPUT');
     const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}outputComplete=true;
     return {preset,contentType:mediaTranscodePresets[preset].contentType,extension:mediaTranscodePresets[preset].extension,bytes:data,sha256:hash.digest('hex')};
    }catch(cause){if(controller.signal.aborted)throw fail(timedOut?'TRANSCODE_DEADLINE':'TRANSCODE_CANCELLED',cause);if(cause instanceof MediaTranscodeError)throw cause;throw fail('TRANSCODE_FAILED',cause);}
    finally{
     if(timer!==undefined)clearTimeout(timer);controller.signal.removeEventListener('abort',terminate);signal?.removeEventListener('abort',abort);
     let cleanupFailed=false;try{if(job){if(!outputComplete)terminate();try{await termination;}finally{await job.dispose();}}}
     catch(cause){cleanupFailed=true;throw fail('TRANSCODE_CLEANUP_FAILED',cause);}
     finally{controllers.delete(controller);try{if(presets.includes(preset))options.onEvent?.(Object.freeze({preset,status:outputComplete&&!cleanupFailed?'complete':controller.signal.aborted?'cancelled':'failed'}));}catch{/* Diagnostics cannot change resource ownership. */}}
    }
   })();pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
  },
  close(){closed=true;for(const controller of controllers)controller.abort();return closing??=Promise.allSettled([...pending]).then(()=>{});}
 };
}
