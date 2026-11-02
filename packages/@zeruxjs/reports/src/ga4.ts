import {validateSourceQuery,sourceSchema,type ReportSourceAdapter,type ReportSourceSchema} from './sources.js';
import {googleReporting,providerFailure,GA4_READONLY_SCOPE,type GoogleReportOptions} from './google-reporting.js';
export {createGoogleReportCredentials,GA4_READONLY_SCOPE} from './google-reporting.js';
/** Read-only GA4 Data API v1beta. Property and supported fields are server-owned. */
export function createGa4ReportSource(options:GoogleReportOptions&{property:string;schema:ReportSourceSchema;timeZone:string}):ReportSourceAdapter{
 if(!/^\d{1,20}$/.test(options?.property))providerFailure('INVALID_QUERY');try{new Intl.DateTimeFormat('en',{timeZone:options.timeZone});}catch{providerFailure('INVALID_QUERY');}
 const property=options.property,timeZone=options.timeZone,schema=sourceSchema(options.schema);if(schema.fields.some(f=>!/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(f.name)||f.kind==='metric'&&!['count','seconds','milliseconds','ratio'].includes(f.unit!)&&!f.unit?.startsWith('currency:')))providerFailure('INVALID_QUERY');const google=googleReporting(options,GA4_READONLY_SCOPE);
 return {schema,capabilities:{readOnly:true,maxRows:1000,maxDays:366},dispose:()=>google.dispose(),async query(q,c){
  q=validateSourceQuery(q,schema,1000,366);
  const columns=[...q.dimensions,...q.metrics].map(n=>schema.fields.find(f=>f.name===n)!);if(columns.some(f=>!f))providerFailure('INVALID_QUERY');
  const value=await google.request(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dateRanges:[{startDate:q.from,endDate:q.to}],dimensions:q.dimensions.map(name=>({name})),metrics:q.metrics.map(name=>({name})),limit:String(q.limit),returnPropertyQuota:true})},c);
  if(!value||value.metadata?.timeZone!==timeZone||!Array.isArray(value.dimensionHeaders)||value.dimensionHeaders.map((h:any)=>h.name).join('|')!==q.dimensions.join('|')||!Array.isArray(value.metricHeaders)||value.metricHeaders.map((h:any)=>h.name).join('|')!==q.metrics.join('|')||!Number.isSafeInteger(value.rowCount)||value.rowCount<0||value.rows!==undefined&&!Array.isArray(value.rows))providerFailure('INVALID_RESULT');
  for(const f of columns)if(f.unit?.startsWith('currency:')&&f.unit!==`currency:${value.metadata.currencyCode}`)providerFailure('INVALID_RESULT');
  for(const [i,name] of q.metrics.entries()){const unit=schema.fields.find(f=>f.name===name)!.unit,type=value.metricHeaders[i].type;const expected=unit==='count'?['TYPE_INTEGER']:unit==='seconds'?['TYPE_SECONDS']:unit==='milliseconds'?['TYPE_MILLISECONDS']:unit?.startsWith('currency:')?['TYPE_CURRENCY']:unit==='ratio'?['TYPE_FLOAT','TYPE_STANDARD']:[];if(!expected.includes(type))providerFailure('INVALID_RESULT');}
  const rows=(value.rows??[]).map((r:any)=>{r.dimensionValues??=[];if(!Array.isArray(r.dimensionValues)||!Array.isArray(r.metricValues)||r.dimensionValues.length!==q.dimensions.length||r.metricValues.length!==q.metrics.length)providerFailure('INVALID_RESULT');return [...r.dimensionValues,...r.metricValues].map((v:any)=>v.value);});
  return {columns,rows,timeZone,coverage:{kind:'provider-reported',truncated:value.rowCount>rows.length,totalRows:value.rowCount,sampling:'unknown',restricted:value.metadata.subjectToThresholding===true||value.metadata.dataLossFromOtherRow===true||!!value.metadata.schemaRestrictionResponse}};
 }};
}

export type {GoogleReportCredentials,GoogleReportOptions} from "./google-reporting.js";
