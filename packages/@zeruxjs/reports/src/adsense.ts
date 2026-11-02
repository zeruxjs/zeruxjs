import {sourceSchema,validateSourceQuery,type ReportSourceAdapter,type ReportSourceSchema} from './sources.js';
import {googleReporting,providerFailure,ADSENSE_READONLY_SCOPE,type GoogleReportOptions} from './google-reporting.js';
export {createGoogleReportCredentials,ADSENSE_READONLY_SCOPE} from './google-reporting.js';
/** AdSense Management v2, fixed account/domain, Google billing timezone only. */
export function createAdSenseReportSource(options:GoogleReportOptions&{account:string;domain:string;schema:ReportSourceSchema}):ReportSourceAdapter {
 if(!/^pub-\d{1,30}$/.test(options?.account)||typeof options.domain!=='string'||options.domain.length>253||! /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(options.domain))providerFailure('INVALID_QUERY');
 const account=options.account,domain=options.domain,schema=sourceSchema(options.schema);if(schema.fields.some(f=>!/^[A-Z][A-Z0-9_]{0,95}$/.test(f.name)||f.kind==='metric'&&f.unit!=='count'&&f.unit!=='ratio'&&!f.unit?.startsWith('currency:')))providerFailure('INVALID_QUERY');
 const currencies=new Set(schema.fields.filter(f=>f.unit?.startsWith('currency:')).map(f=>f.unit!.slice(9)));if(currencies.size>1)providerFailure('INVALID_QUERY');const currency=[...currencies][0];
 const google=googleReporting(options,ADSENSE_READONLY_SCOPE);
 return {schema,capabilities:{readOnly:true,maxRows:1000,maxDays:366},dispose:()=>google.dispose(),async query(q,c){
  q=validateSourceQuery(q,schema,1000,366);const columns=[...q.dimensions,...q.metrics].map(n=>schema.fields.find(f=>f.name===n)!);
  const url=new URL(`https://adsense.googleapis.com/v2/accounts/${account}/reports:generate`);
  url.searchParams.set('dateRange','CUSTOM');for(const [prefix,value] of [['startDate',q.from],['endDate',q.to]])for(const [i,part] of ['year','month','day'].entries())url.searchParams.set(`${prefix}.${part}`,String(Number(value.split('-')[i])));
  url.searchParams.set('limit',String(q.limit));url.searchParams.set('reportingTimeZone','GOOGLE_TIME_ZONE');url.searchParams.set('languageCode','en');url.searchParams.append('filters',`DOMAIN_CODE==${domain}`);if(currency)url.searchParams.set('currencyCode',currency);
  for(const d of q.dimensions)url.searchParams.append('dimensions',d);for(const m of q.metrics)url.searchParams.append('metrics',m);
  const value=await google.request(url.href,{method:'GET'},c);
  if(!value||!Array.isArray(value.headers)||value.headers.length!==columns.length||value.headers.some((h:any,i:number)=>h.name!==columns[i].name||h.type!==(columns[i].kind==='dimension'?'DIMENSION':columns[i].unit==='count'?'METRIC_TALLY':columns[i].unit==='ratio'?'METRIC_RATIO':'METRIC_CURRENCY')||columns[i].unit?.startsWith('currency:')&&columns[i].unit!==`currency:${h.currencyCode}`)||!/^\d{1,16}$/.test(value.totalMatchedRows)||!Number.isSafeInteger(Number(value.totalMatchedRows))||value.rows!==undefined&&!Array.isArray(value.rows)||value.warnings!==undefined&&!Array.isArray(value.warnings))providerFailure('INVALID_RESULT');
  const matchesDate=(v:any,date:string)=>v&&[v.year,v.month,v.day].join('-')===date.split('-').map(Number).join('-');if(!matchesDate(value.startDate,q.from)||!matchesDate(value.endDate,q.to))providerFailure('INVALID_RESULT');
  const rows=(value.rows??[]).map((r:any)=>{if(!Array.isArray(r.cells)||r.cells.length!==columns.length)providerFailure('INVALID_RESULT');return r.cells.map((cell:any)=>cell.value);}),totalRows=Number(value.totalMatchedRows);
  return {columns,rows,timeZone:'America/Los_Angeles',coverage:{kind:'provider-reported',totalRows,truncated:totalRows>rows.length,sampling:'unknown',restricted:!!value.warnings?.length}};
 }};
}

export type {GoogleReportCredentials,GoogleReportOptions} from "./google-reporting.js";
