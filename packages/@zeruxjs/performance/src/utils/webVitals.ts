import {createPerformanceMetric} from '../timing.js';
import type {PerformanceMetric,VitalName} from '../types.js';
export interface VitalObserverOptions {
 onMetric:(metric:PerformanceMetric)=>void;
 /** Override for tests or embedded browsers; uses global PerformanceObserver otherwise. */
 createObserver?:(callback:(entries:PerformanceEntry[])=>void)=>{observe(options:PerformanceObserverInit):void;disconnect():void};
 navigation?:()=>{responseStart:number;requestStart:number}|undefined;
}
/** Native browser RUM observer. INP is deliberately not claimed: accurate INP requires interaction lifecycle tracking. */
export function observeWebVitals(options:VitalObserverOptions):()=>void {
 const Observer=typeof PerformanceObserver==='undefined'?undefined:PerformanceObserver;
 const factory=options.createObserver??(Observer?(cb:(entries:PerformanceEntry[])=>void)=>new Observer(list=>cb(list.getEntries())):undefined);
 if(!factory)return()=>{};
 const last=new Map<VitalName,number>();let cls=0,session=0,sessionStart=0,sessionLast=0;
 let active=true;
 const publish=(name:VitalName,value:number)=>{if(!active||!Number.isFinite(value)||value<0||last.get(name)===value)return;last.set(name,value);options.onMetric(createPerformanceMetric(name,value))};
 const observers:Array<{disconnect():void}>=[];
 const watch=(type:string,callback:(entry:PerformanceEntry)=>void)=>{
  const observer=factory(entries=>{for(const entry of entries)if(active)callback(entry)});
  try{observer.observe({type,buffered:true});observers.push(observer)}catch{observer.disconnect()}
 };
 watch('largest-contentful-paint',entry=>publish('LCP',entry.startTime));
 watch('paint',entry=>{if(entry.name==='first-contentful-paint')publish('FCP',entry.startTime)});
 watch('layout-shift',entry=>{const e=entry as PerformanceEntry & {value?:number;hadRecentInput?:boolean};if(e.hadRecentInput||!Number.isFinite(e.value)||!e.value||e.value<0)return;
   if(!sessionStart||entry.startTime-sessionLast>1000||entry.startTime-sessionStart>5000){session=0;sessionStart=entry.startTime}
   session+=e.value;sessionLast=entry.startTime;cls=Math.max(cls,session);publish('CLS',cls)});
 try{const nav=options.navigation?.()??(typeof performance!=='undefined'?performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined:undefined);
 if(nav)publish('TTFB',Math.max(0,nav.responseStart-nav.requestStart))}catch{/* unsupported */}
 return()=>{if(!active)return;active=false;for(const observer of observers)observer.disconnect()};
}
