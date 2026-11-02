import type {PerformanceMetric} from './types.js';
const coverages=['native-observation','web-vitals-5','server-request','custom'] as const;
const consents=['granted','denied','unknown','not-applicable'] as const;
/** Copy only approved scalar fields; never serialize arbitrary caller properties. */
export function validatePerformanceMetric(metric:PerformanceMetric):PerformanceMetric {
 if(!metric||typeof metric.name!=='string'||!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(metric.name)||!Number.isFinite(metric.value)||metric.value<0||!Number.isFinite(metric.timestamp)||metric.timestamp<0||metric.timestamp>Number.MAX_SAFE_INTEGER)throw new RangeError('Invalid performance metric');
 if(metric.statusClass!==undefined&&!['1xx','2xx','3xx','4xx','5xx'].includes(metric.statusClass)||metric.outcome!==undefined&&!['completed','disconnected','error'].includes(metric.outcome))throw new TypeError('Invalid operational metadata');
 if(metric.rating!==undefined&&!['good','needs-improvement','poor'].includes(metric.rating)||metric.coverage!==undefined&&!coverages.includes(metric.coverage)||metric.consent!==undefined&&!consents.includes(metric.consent))throw new TypeError('Invalid performance metadata');
 return {name:metric.name,value:metric.value,timestamp:metric.timestamp,...(metric.statusClass?{statusClass:metric.statusClass}:{}),...(metric.outcome?{outcome:metric.outcome}:{}),...(metric.rating?{rating:metric.rating}:{}),coverage:metric.coverage??'custom',consent:metric.consent??'unknown'};
}
/** Bounded observation samples, not page-level population percentiles. */
export function createVitalCollector(options:{maxPerMetric?:number;maxMetricNames?:number}={}){
 const max=options.maxPerMetric??200,names=options.maxMetricNames??32;if(!Number.isInteger(max)||max<1||max>10000||!Number.isInteger(names)||names<1||names>128)throw new RangeError('Invalid sample limit');
 const buckets=new Map<string,{items:PerformanceMetric[];observed:number}>();
 return {record(metric:PerformanceMetric){metric=validatePerformanceMetric(metric);let bucket=buckets.get(metric.name);if(!bucket){if(buckets.size>=names)throw new RangeError('Metric cardinality exceeded');bucket={items:[],observed:0};buckets.set(metric.name,bucket);}bucket.observed++;bucket.items.push(metric);if(bucket.items.length>max)bucket.items.shift();},
 snapshot(){return [...buckets].map(([name,{items,observed}])=>{const sorted=items.map(x=>x.value).sort((a,b)=>a-b);return {name,count:items.length,sampleSize:items.length,totalObserved:observed,truncated:observed>items.length,coverageVersion:1,unit:name==='CLS'?'score':['LCP','INP','FCP','TTFB'].includes(name)||name.startsWith('request.')?'milliseconds':'unspecified',coverage:[...new Set(items.map(x=>x.coverage!))],consent:[...new Set(items.map(x=>x.consent!))],p50:sorted[Math.ceil(sorted.length*.5)-1],p75:sorted[Math.ceil(sorted.length*.75)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],latest:{...items[items.length-1]!}};});},clear(){buckets.clear();}};
}
export interface VitalReporterOptions {
 url?:string;fetch?:typeof fetch;send?:(metrics:readonly PerformanceMetric[],context:{signal:AbortSignal})=>Promise<boolean>;
 maxBatch?:number;maxQueue?:number;maxBatchBytes?:number;signal?:AbortSignal;credentials?:RequestCredentials;
 maxRetries?:number;maxAgeMs?:number;retryBaseMs?:number;retryMaxMs?:number;timeoutMs?:number;now?:()=>number;
}
/** Explicit flush with bounded in-memory retries. No automatic network loop or durable-delivery claim. */
export function createVitalReporter(options:VitalReporterOptions){
 if(!options||typeof options!=='object'||options.url!==undefined&&options.send!==undefined||options.send!==undefined&&typeof options.send!=='function')throw new TypeError('Invalid RUM transport');
 let url:URL|undefined;if(options.url!==undefined){url=new URL(options.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new TypeError('Invalid RUM URL');}else if(!options.send)throw new TypeError('RUM transport required');
 const bound=(value:number,min:number,max:number)=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError('Invalid RUM bound');return value;};
 const max=bound(options.maxBatch??50,1,500),capacity=bound(options.maxQueue??max,1,2000),bytes=bound(options.maxBatchBytes??32768,256,60000),retries=bound(options.maxRetries??3,0,20),age=bound(options.maxAgeMs??60000,1,3600000),base=bound(options.retryBaseMs??0,0,60000),backoff=bound(options.retryMaxMs??60000,base,60000),timeout=bound(options.timeoutMs??3000,1,60000);
 if(options.signal!==undefined&&!(options.signal instanceof AbortSignal)||options.now!==undefined&&typeof options.now!=='function'||options.credentials!==undefined&&!['omit','same-origin','include'].includes(options.credentials))throw new TypeError('Invalid RUM options');
 const now=options.now??Date.now,send=options.send,fetcher=options.fetch??globalThis.fetch,credentials=options.credentials??'omit';if(!send&&typeof fetcher!=='function')throw new TypeError('Fetch unavailable');
 interface Item {metric:PerformanceMetric;created:number;attempts:number;next:number}
 const pending:Item[]=[];let generation=0;let native:Promise<number>|undefined,observed:Promise<number>|undefined,controller:AbortController|undefined,disposed=false,dropped=0,failures=0,delivered=0;
 const time=()=>bound(now(),0,Number.MAX_SAFE_INTEGER),abort=()=>{generation++;dropped+=pending.length;pending.length=0;controller?.abort();};options.signal?.addEventListener('abort',abort);
 const trim=()=>{const at=time();for(let i=pending.length-1;i>=0;i--)if(at-pending[i]!.created>=age){pending.splice(i,1);dropped++;}};
 const reporter={
  add(metric:PerformanceMetric){if(disposed)throw new Error('Reporter destroyed');if(options.signal?.aborted)throw new Error('Reporter cancelled');metric=validatePerformanceMetric(metric);const copy={...metric};if(new TextEncoder().encode(JSON.stringify([copy])).byteLength>bytes)throw new RangeError('Metric exceeds batch byte budget');trim();if(pending.length>=capacity){pending.shift();dropped++;}const at=time();pending.push({metric:copy,created:at,attempts:0,next:at});},
  flush():Promise<number>{if(observed)return observed;if(native)return Promise.reject(new Error('RUM transport still pending'));if(disposed)return Promise.resolve(0);if(options.signal?.aborted)return Promise.reject(new Error('Reporter cancelled'));trim();const at=time(),batch:Item[]=[];let size=2;
   for(let i=0;i<pending.length&&batch.length<max;){const item=pending[i]!;if(item.next>at){i++;continue;}const n=new TextEncoder().encode(JSON.stringify(item.metric)).byteLength+(batch.length?1:0);if(size+n>bytes)break;size+=n;batch.push(...pending.splice(i,1));}
   if(!batch.length)return Promise.resolve(0);controller=new AbortController();const active=controller,epoch=generation;if(options.signal?.aborted)active.abort();let timedOut=false,timer:ReturnType<typeof setTimeout>|undefined,stop=()=>{};
   const stopped=new Promise<never>((_,reject)=>{stop=()=>reject(new Error(timedOut?'RUM delivery deadline exceeded':'RUM delivery cancelled'));active.signal.addEventListener('abort',stop,{once:true});if(active.signal.aborted)stop();timer=setTimeout(()=>{timedOut=true;active.abort();},timeout);});
   native=Promise.resolve().then(async()=>{let retryable=true;try{active.signal.throwIfAborted();batch.forEach(item=>item.attempts++);const metrics=batch.map(x=>Object.freeze({...x.metric}));let ok:boolean;
    if(send)ok=await send(Object.freeze(metrics),{signal:active.signal});else{const result=await fetcher!(url!.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metrics),signal:active.signal,credentials,redirect:'error',cache:'no-store',keepalive:true});ok=result.ok;retryable=ok||result.status===408||result.status===429||result.status>=500;if(result.body)await result.body.cancel();if(!ok){retryable=result.status===408||result.status===429||result.status>=500;throw new Error(`RUM delivery failed (${result.status})`);}}
    if(ok!==true)throw new Error('RUM delivery unavailable');delivered+=batch.length;return batch.length;
   }catch(error){failures++;if(!disposed&&epoch===generation&&retryable){const at=time(),retry=batch.filter(item=>item.attempts<=retries&&at-item.created<age);for(const item of retry)item.next=at+Math.min(backoff,base*2**Math.min(item.attempts-1,20));const room=Math.max(0,capacity-pending.length);pending.unshift(...retry.slice(0,room));dropped+=batch.length-Math.min(retry.length,room);}else dropped+=batch.length;throw error instanceof Error&&/^RUM delivery failed \(\d{3}\)$/.test(error.message)?error:new Error('RUM delivery unavailable',{cause:error});}finally{native=undefined;controller=undefined;}});
   observed=Promise.race([native,stopped]).finally(()=>{if(timer)clearTimeout(timer);active.signal.removeEventListener('abort',stop);observed=undefined;});return observed;
  },
  clear(){generation++;dropped+=pending.length;pending.length=0;controller?.abort();},
  get pending(){trim();return pending.length;},
  diagnostics(){return {disposed,pending:pending.length,inFlight:!!native,dropped,failures,delivered};},
  destroy(settings:{unsent?:'discard'|'recover'}={}){if(settings.unsent!==undefined&&!['discard','recover'].includes(settings.unsent))throw new TypeError('Invalid unsent policy');if(disposed)return {recovered:[] as PerformanceMetric[],inFlightOutcome:'none' as 'none'|'unknown'};disposed=true;const recovered=settings.unsent==='recover'?pending.map(x=>({...x.metric})):[];dropped+=pending.length;pending.length=0;options.signal?.removeEventListener('abort',abort);const outcome=native?'unknown' as const:'none' as const;controller?.abort();return {recovered,inFlightOutcome:outcome};},
  async whenClosed(){if(!disposed)throw new Error('Reporter not destroyed');await Promise.allSettled([native]);}
 };return reporter;
}
