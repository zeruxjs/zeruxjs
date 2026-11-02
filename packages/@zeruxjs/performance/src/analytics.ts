import {createVitalCollector,createVitalReporter,validatePerformanceMetric,type VitalReporterOptions} from './rum.js';
import {observeWebVitals,type VitalObserverOptions} from './utils/webVitals.js';
import type {PerformanceMetric,VitalName} from './types.js';

const names:VitalName[]=['LCP','CLS','INP','FCP','TTFB'];
const opaque=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(v);
const label=(v:unknown)=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,54}$/.test(v);
const dimension=<T extends string>(values:T[])=>({kind:'dimension' as const,type:'string' as const,values,maxCardinality:values.length,required:true as const});
/** Schema data only. CLS is an unbounded score parameter, not analytics' bounded 0..1 ratio metric. */
export function performanceAnalyticsSchemas(){return [{name:'performance.vital.v1',version:1,properties:{metric:dimension(names),unit:dimension(['milliseconds','score']),coverage:dimension(['native-observation','web-vitals-5']),sample_size:{kind:'metric' as const,unit:'count' as const,min:1},duration_ms:{kind:'metric' as const,unit:'milliseconds' as const,min:0,max:3600000},layout_shift_score:{kind:'parameter' as const,type:'number' as const}}}];}
export interface PerformanceAnalyticsEvent {name:'performance.vital.v1';source:'web';site:string;consent:'granted';sessionId?:string;properties:{metric:VitalName;unit:'milliseconds'|'score';coverage:'native-observation'|'web-vitals-5';sample_size:number;duration_ms?:number;layout_shift_score?:number}}
export interface BrowserPerformanceOptions {
 site:string;consent?:'granted'|'denied'|'unknown';sessionId?:string;
 send:(events:readonly PerformanceAnalyticsEvent[],context:{signal:AbortSignal})=>Promise<boolean>;
 reporter?:Pick<VitalReporterOptions,'maxBatch'|'maxQueue'|'maxBatchBytes'|'maxRetries'|'maxAgeMs'|'retryBaseMs'|'retryMaxMs'|'timeoutMs'|'now'>;
 observer?:Omit<VitalObserverOptions,'onMetric'|'onUnsupported'>;
 /** Trusted page-owned maintained source. This bridge never starts or owns its library observers. */
 webVitals?:{version:string;inpSupported:boolean};
 document?:Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>;
 window?:Pick<Window,'addEventListener'|'removeEventListener'>;
}
/** Explicit install/start and consent; no URL, query, element attribution or identity creation. */
export function createBrowserPerformanceAnalytics(options:BrowserPerformanceOptions){
 if(!options||typeof options.send!=='function'||typeof options.site!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.site)||options.sessionId!==undefined&&!opaque(options.sessionId))throw new TypeError('Invalid browser analytics options');
 const site=options.site,send=options.send,source=options.webVitals?{...options.webVitals}:undefined;if(source&&(!/^5\.\d+\.\d+$/.test(source.version)||typeof source.inpSupported!=='boolean'))throw new TypeError('Unsupported web-vitals source');
 let consent=options.consent??'unknown',sessionId=options.sessionId;if(!['granted','denied','unknown'].includes(consent))throw new TypeError('Invalid consent');
 const observer=options.observer?{...options.observer,...(options.observer.supportedEntryTypes?{supportedEntryTypes:[...options.observer.supportedEntryTypes]}:{})}:undefined;
 const collector=createVitalCollector({maxMetricNames:5}),latest=new Map<string,{id?:string;value:number}>();let active=false,disposed=false,stop:(()=>void)|undefined,invalid=0;
 const supported=new Set(observer?.supportedEntryTypes??(typeof PerformanceObserver!=='undefined'?PerformanceObserver.supportedEntryTypes:[]));
 const coverage:Record<VitalName,string>={LCP:supported.has('largest-contentful-paint')?'not-observed':'unsupported',CLS:supported.has('layout-shift')?'not-observed':'unsupported',FCP:supported.has('paint')?'not-observed':'unsupported',TTFB:observer?.navigation||supported.has('navigation')?'not-observed':'unsupported',INP:source?.inpSupported?'external-source-not-observed':'unsupported'};
 const reporter=createVitalReporter({...options.reporter,retryBaseMs:options.reporter?.retryBaseMs??1000,send:async(metrics,context)=>{
  if(consent!=='granted'||disposed)return false;
  return send(metrics.map(metric=>({name:'performance.vital.v1' as const,source:'web' as const,site,consent:'granted' as const,...(sessionId?{sessionId}:{}),properties:{metric:metric.name as VitalName,unit:metric.name==='CLS'?'score' as const:'milliseconds' as const,coverage:metric.coverage as 'native-observation'|'web-vitals-5',sample_size:1,...(metric.name==='CLS'?{layout_shift_score:metric.value}:{duration_ms:metric.value})}})),context);
 }});
 function record(metric:PerformanceMetric,id?:string){if(!active||disposed||consent!=='granted')return false;try{metric=validatePerformanceMetric(metric);if(!names.includes(metric.name as VitalName)||metric.value>3600000||metric.name==='INP'&&metric.coverage!=='web-vitals-5')throw new TypeError();const previous=latest.get(metric.name);if(previous&&previous.id===id&&previous.value===metric.value)return false;latest.set(metric.name,{id,value:metric.value});const value={...metric,consent:'granted' as const};collector.record(value);reporter.add(value);coverage[metric.name as VitalName]=metric.coverage!;return true;}catch{invalid++;return false;}}
 const doc=options.document??(typeof document==='undefined'?undefined:document),win=options.window??(typeof window==='undefined'?undefined:window);
 const flushQuietly=()=>{void reporter.flush().catch(()=>{});};
 const hidden=()=>{if(doc?.visibilityState==='hidden')flushQuietly();};
 const pagehide=()=>flushQuietly();
 function start(){if(disposed)throw new Error('Performance analytics destroyed');if(active||consent!=='granted')return false;active=true;stop=observeWebVitals({...observer,onMetric:metric=>{record({...metric,coverage:'native-observation'});},onUnsupported:type=>{const metric=type==='paint'?'FCP':type==='layout-shift'?'CLS':type==='largest-contentful-paint'?'LCP':undefined;if(metric)coverage[metric]='unsupported';}});doc?.addEventListener('visibilitychange',hidden);win?.addEventListener('pagehide',pagehide);return true;}
 function halt(){stop?.();stop=undefined;active=false;doc?.removeEventListener('visibilitychange',hidden);win?.removeEventListener('pagehide',pagehide);}
 return {
 start,
 setConsent(value:'granted'|'denied'|'unknown',identity?:{sessionId?:string}){if(disposed)throw new Error('Performance analytics destroyed');if(!['granted','denied','unknown'].includes(value)||identity?.sessionId!==undefined&&!opaque(identity.sessionId))throw new TypeError('Invalid consent/identity');if(value!=='granted'||identity&&identity.sessionId!==sessionId){halt();reporter.clear();collector.clear();latest.clear();}consent=value;sessionId=value==='granted'?(identity?identity.sessionId:sessionId):undefined;},
 /** Pass to the maintained library's page-owned onINP, after consent. Attribution/entries are discarded. */
 receiveWebVital(metric:{name:string;value:number;id:string;rating?:PerformanceMetric['rating']}){if(!source?.inpSupported||disposed||!active||consent!=='granted')return false;if(!metric||metric.name!=='INP'||typeof metric.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(metric.id)) {invalid++;return false;}return record({name:'INP',value:metric.value,timestamp:Date.now(),rating:metric.rating,coverage:'web-vitals-5'},metric.id);},
 flush:()=>reporter.flush(),
 snapshot(){const observations=collector.snapshot();return {coverageVersion:1,consent,sampleSize:observations.reduce((n,x)=>n+x.sampleSize,0),coverage:{...coverage},observations,invalid,reporter:reporter.diagnostics()};},
 destroy(settings:{unsent?:'discard'|'recover'}={}){halt();disposed=true;collector.clear();latest.clear();return reporter.destroy(settings);},
 whenClosed:()=>reporter.whenClosed()
 };
}
/** Host may map these operational fields to a separately authorized analytics namespace. */
export function requestPerformanceAnalyticsSchema(routes:readonly string[],name='performance.request.v1'){
 if(!Array.isArray(routes)||routes.length>32||routes.some(r=>!label(r))||new Set(routes).size!==routes.length||typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(name))throw new TypeError('Invalid operational schema');
 return {name,version:1,properties:{route:dimension([...new Set([...routes,'other'])]),status_class:dimension(['1xx','2xx','3xx','4xx','5xx']),outcome:dimension(['completed','disconnected','error']),scope:dimension(['operational-only']),duration_ms:{kind:'metric' as const,unit:'milliseconds' as const,min:0,max:3600000},sample_size:{kind:'metric' as const,unit:'count' as const,min:1}}};
}
export interface RequestPerformanceSample {durationMs:number;status:number;outcome:'completed'|'disconnected'|'error'}
/** Operational-only counts. Host passes an approved label, never a request URL or correlation identity. */
export function createServerPerformanceAdapter(options:{routes:readonly string[];send:(metrics:readonly PerformanceMetric[],context:{signal:AbortSignal})=>Promise<boolean>;reporter?:BrowserPerformanceOptions['reporter']}){
 if(!options||!Array.isArray(options.routes)||options.routes.length>32||new Set(options.routes).size!==options.routes.length||options.routes.some(r=>!label(r))||typeof options.send!=='function')throw new TypeError('Invalid operational metrics options');const routes=new Set(options.routes),collector=createVitalCollector({maxMetricNames:33});const reporter=createVitalReporter({...options.reporter,retryBaseMs:options.reporter?.retryBaseMs??1000,send:options.send});let disposed=false;
 return {record(sample:Readonly<RequestPerformanceSample>,route='other'){if(disposed)throw new Error('Operational metrics destroyed');if(route!=='other'&&!routes.has(route))throw new TypeError('Unapproved route label');if(!sample||!Number.isFinite(sample.durationMs)||sample.durationMs<0||sample.durationMs>3600000||!Number.isSafeInteger(sample.status)||sample.status<100||sample.status>599||!['completed','disconnected','error'].includes(sample.outcome))throw new TypeError('Invalid operational sample');const metric:PerformanceMetric={name:'request.'+route,value:sample.durationMs,timestamp:Date.now(),coverage:'server-request',consent:'not-applicable',statusClass:(Math.floor(sample.status/100)+'xx') as PerformanceMetric['statusClass'],outcome:sample.outcome};collector.record(metric);reporter.add(metric);},flush:()=>reporter.flush(),snapshot(){const observations=collector.snapshot();return {sampleSize:observations.reduce((n,x)=>n+x.sampleSize,0),coverageVersion:1,consent:'not-applicable' as const,scope:'operational-only' as const,observations,reporter:reporter.diagnostics()};},destroy(settings:{unsent?:'discard'|'recover'}={}){disposed=true;collector.clear();return reporter.destroy(settings);},whenClosed:()=>reporter.whenClosed()};
}
