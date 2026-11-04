import type {ReportPage} from './types.js';
export interface ReportLayoutV1 {version:1;columns:1|2|3;timeZone:string;items:{chartId:string;span:1|2|3}[]}
/** Presentation only: ordering/spans/time-zone labels never alter a query or authorization. */
export function validateReportLayout(value:ReportLayoutV1,page:Pick<ReportPage,'charts'>):ReportLayoutV1 {
 if(!page||!Array.isArray(page.charts)||page.charts.length>50)throw new TypeError('Invalid layout chart set');
 const plain=(v:object)=>v&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&'value'in Object.getOwnPropertyDescriptor(v,k)!);
 if(!value||!plain(value)||Object.keys(value).some(k=>!['version','columns','timeZone','items'].includes(k))||value.version!==1||![1,2,3].includes(value.columns)||typeof value.timeZone!=='string'||!value.timeZone||value.timeZone.length>100||!Array.isArray(value.items)||value.items.length!==page.charts.length||Object.values(Object.getOwnPropertyDescriptors(value.items)).some(d=>!('value'in d)))throw new TypeError('Invalid report layout');
 try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone});}catch{throw new TypeError('Invalid display time zone');}
 const seen=new Set<string>();for(const item of value.items){if(!item||!plain(item)||Object.keys(item).some(k=>!['chartId','span'].includes(k))||!page.charts.some(c=>c.id===item.chartId)||seen.has(item.chartId)||![1,2,3].includes(item.span)||item.span>value.columns)throw new TypeError('Invalid report layout item');seen.add(item.chartId);}
 return structuredClone(value);
}
export function resolveReportLayout(page:ReportPage):ReportLayoutV1 {return validateReportLayout(page.layout??{version:1,columns:2,timeZone:'UTC',items:page.charts.map(c=>({chartId:c.id,span:1}))},page);}
