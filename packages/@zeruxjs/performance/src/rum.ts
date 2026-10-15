import type {PerformanceMetric} from './types.js';
/** In-memory, bounded performance aggregator with percentile snapshots. No global request telemetry. */
export function createVitalCollector(options:{maxPerMetric?:number}={}){
 const max=options.maxPerMetric??200;if(!Number.isInteger(max)||max<1||max>10000)throw new RangeError('Invalid sample limit');
 const buckets=new Map<string,PerformanceMetric[]>();
 return{record(metric:PerformanceMetric){if(!Number.isFinite(metric.value)||metric.value<0||!Number.isFinite(metric.timestamp))throw new RangeError('Invalid vital sample');
   const list=buckets.get(metric.name)??[];list.push({...metric});if(list.length>max)list.splice(0,list.length-max);buckets.set(metric.name,list)},
  snapshot(){return [...buckets.entries()].map(([name,items])=>{const sorted=items.map(x=>x.value).sort((a,b)=>a-b);
   return{name,count:items.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p75:sorted[Math.ceil(sorted.length*.75)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],latest:{...items[items.length-1]}}})},
  clear(){buckets.clear()}};
}
export interface VitalReporterOptions{url:string;fetch?:typeof fetch;maxBatch?:number;signal?:AbortSignal;credentials?:RequestCredentials}
/** Queue RUM metrics and flush explicitly; reports only fields supplied by the caller. */
export function createVitalReporter(options:VitalReporterOptions){
 const url=new URL(options.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new TypeError('Invalid RUM URL');
 const max=options.maxBatch??50;if(!Number.isInteger(max)||max<1||max>500)throw new RangeError('Invalid RUM batch size');
 const pending:PerformanceMetric[]=[];let inFlight:Promise<number>|undefined,disposed=false;
 return{add(metric:PerformanceMetric){if(disposed)throw new Error('Reporter destroyed');if(!Number.isFinite(metric.value)||metric.value<0)throw new RangeError('Invalid metric');
   if(pending.length>=max)pending.shift();pending.push({...metric})},
  flush():Promise<number>{if(inFlight)return inFlight;if(disposed||!pending.length)return Promise.resolve(0);
   const batch=pending.splice(0,pending.length);const send=options.fetch??fetch;
   inFlight=(async()=>{try{const result=await send(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch),signal:options.signal,credentials:options.credentials??'omit'});
    if(!result.ok)throw new Error(`RUM delivery failed (${result.status})`);return batch.length}
    catch(error){if(!disposed)pending.unshift(...batch.slice(0,Math.max(0,max-pending.length)));throw error}
    finally{inFlight=undefined}})();return inFlight},
  get pending(){return pending.length},destroy(){disposed=true;pending.length=0}};
}
