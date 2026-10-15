import type {ReportsDocument,ReportsStore,ChartDefinition,ChartData,AnalyticsReportSource,Metric} from './types.js';
const ident=/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
const forbidden=new Set(['__proto__','constructor','prototype']);
const chartTypes=['bar','horizontal-bar','line','area','pie','doughnut','scatter','stacked-bar','table','kpi'];
const metrics=['count','sum','average','min','max','distinct'];
export const isReportId=(v:unknown):v is string=>typeof v==='string'&&ident.test(v)&&!v.split(/[.:-]/).some(k=>forbidden.has(k));
export function validateReports(input:unknown):ReportsDocument{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Invalid reports document');
  const doc=input as ReportsDocument;if(!Number.isSafeInteger(doc.version)||doc.version<1||!Array.isArray(doc.reports)||doc.reports.length>100)throw new TypeError('Invalid reports version or size');
  const ids=new Set<string>();const unique=(id:string)=>{if(!isReportId(id)||ids.has(id))throw new TypeError('Invalid or repeated report ID');ids.add(id);};
  for(const report of doc.reports){unique(report.id);if(typeof report.name!=='string'||report.name.length<1||report.name.length>128||report.description!==undefined&&(typeof report.description!=='string'||report.description.length>1024)||!Array.isArray(report.pages)||report.pages.length>50)throw new TypeError('Invalid report');
    for(const page of report.pages){unique(page.id);if(typeof page.name!=='string'||page.name.length<1||page.name.length>128||!Array.isArray(page.charts)||page.charts.length>50)throw new TypeError('Invalid report page');
      for(const chart of page.charts){unique(chart.id);if(typeof chart.title!=='string'||chart.title.length<1||chart.title.length>128||!chartTypes.includes(chart.type)||!metrics.includes(chart.metric)||!['event','day','source','site','pathname'].includes(chart.groupBy)&&!/^property:[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(chart.groupBy)||chart.groupBy.startsWith('property:')&&!isReportId(chart.groupBy.slice(9)))throw new TypeError('Invalid chart');
        if(chart.valueField!==undefined&&!isReportId(chart.valueField)||chart.eventName!==undefined&&!isReportId(chart.eventName)||chart.source!==undefined&&!['web','server','email','system'].includes(chart.source)||chart.site!==undefined&&(typeof chart.site!=='string'||chart.site.length>200||/[\x00-\x1f]/.test(chart.site))||chart.limit!==undefined&&(!Number.isSafeInteger(chart.limit)||chart.limit<1||chart.limit>500)||['since','until'].some(k=>{const n=chart[k as 'since'|'until'];return n!==undefined&&(!Number.isSafeInteger(n)||n<0);})||chart.since!==undefined&&chart.until!==undefined&&chart.since>chart.until)throw new TypeError('Invalid chart query');
      }
    }
  }
  return structuredClone(doc);
}
export function createMemoryReportsStore(initial:ReportsDocument={version:1,reports:[]}):ReportsStore{
  let current=validateReports(initial);
  return {async load(){return structuredClone(current);},async save(next,expected){if(expected!==current.version||next.version!==expected+1)return false;current=validateReports(next);return true;}};
}
interface Item {category:string;value:number}
export async function queryChart(source:AnalyticsReportSource,chart:ChartDefinition,maxSourceRows=500,site?:string):Promise<ChartData>{
  if(!Number.isSafeInteger(maxSourceRows)||maxSourceRows<1||maxSourceRows>500)throw new RangeError('Invalid source row limit');
  // Direct programmatic callers receive the same chart validation as editor-saved definitions.
  const reportId=chart.id==='ReportValidation'?'ReportValidationTwo':'ReportValidation';
  const pageId=[chart.id,reportId].includes('PageValidation')?'PageValidationTwo':'PageValidation';
  validateReports({version:1,reports:[{id:reportId,name:'Validation',pages:[{id:pageId,name:'Preview',charts:[chart]}]}]});
  const take=Math.min(chart.limit??maxSourceRows,maxSourceRows);
  const scopedSite=site??chart.site;
  if(chart.metric==='count'&&typeof source.aggregate==='function'&&(
      ['event','source','site','pathname'].includes(chart.groupBy)||chart.groupBy==='day'&&chart.since!==undefined&&chart.until!==undefined)){
    const result=await source.aggregate({groupBy:chart.groupBy as 'event'|'source'|'site'|'pathname'|'day',
      name:chart.eventName,source:chart.source,site:scopedSite,since:chart.since,until:chart.until,limit:chart.limit??100});
    if(result.mode!=='database'||result.groupBy!==chart.groupBy||!Number.isSafeInteger(result.total)||result.total<0||
      typeof result.truncated!=='boolean'||!Array.isArray(result.groups)||result.groups.length>(chart.limit??100)||
      result.groups.some(g=>typeof g.category!=='string'||g.category.length>150||!Number.isSafeInteger(g.value)||g.value<0)||
      result.groups.reduce((n,g)=>n+g.value,0)>result.total)throw new Error('Invalid native report count result');
    const output=chart.groupBy==='day'?[...result.groups].sort((a,b)=>a.category.localeCompare(b.category)):result.groups;
    const visible=output.slice(0,60);
    return {id:chart.id,title:chart.title,type:chart.type,labels:visible.map(g=>g.category),values:visible.map(g=>g.value),
      total:result.total,sampledRows:0,truncated:result.truncated||output.length>60,queryMode:'database',coverage:'exact-persisted-event-count'};
  }
  if(chart.metric!=='count'&&chart.metric!=='distinct'&&chart.valueField&&typeof source.aggregateNumeric==='function'&&(typeof source.supportsNumericField!=='function'||source.supportsNumericField(chart.valueField))&&(
      ['event','source','site','pathname'].includes(chart.groupBy)||chart.groupBy==='day'&&chart.since!==undefined&&chart.until!==undefined)){
    const result=await source.aggregateNumeric({groupBy:chart.groupBy as 'event'|'source'|'site'|'pathname'|'day',
      metric:chart.metric,valueField:chart.valueField,name:chart.eventName,source:chart.source,
      site:scopedSite,since:chart.since,until:chart.until,limit:chart.limit??100});
    if(result.mode!=='materialized'||result.groupBy!==chart.groupBy||result.metric!==chart.metric||result.valueField!==chart.valueField||
      result.coverage!=='indexed-only'||typeof result.truncated!=='boolean'||!Number.isSafeInteger(result.matchedFacts)||result.matchedFacts<0||
      !Number.isFinite(result.total)||!Array.isArray(result.groups)||result.groups.length>(chart.limit??100)||
      result.groups.some(g=>typeof g.category!=='string'||g.category.length>150||!Number.isFinite(g.value)))throw new Error('Invalid indexed numeric report result');
    const output=chart.groupBy==='day'?[...result.groups].sort((a,b)=>a.category.localeCompare(b.category)):result.groups;
    const visible=output.slice(0,60);
    return {id:chart.id,title:chart.title,type:chart.type,labels:visible.map(g=>g.category),values:visible.map(g=>g.value),
      total:result.total,sampledRows:0,truncated:result.truncated||output.length>60,queryMode:'materialized',
      numericCoverage:result.coverage,matchedFacts:result.matchedFacts,coverage:'indexed-numeric-facts-only'};
  }
  const rows=await source.events({name:chart.eventName,source:chart.source,site:scopedSite,since:chart.since,until:chart.until,limit:take});
  if(!Array.isArray(rows)||rows.length>take)throw new Error('Source returned more than the bounded event page');
  const groups=new Map<string,{count:number;numericCount:number;sum:number;min:number;max:number;unique:Set<string>}>();
  const all={count:0,numericCount:0,sum:0,min:Infinity,max:-Infinity,unique:new Set<string>()};
  for(const row of rows){
    let props:Record<string,unknown>={};try{const parsed:unknown=JSON.parse(row.properties_json);
      if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))props=parsed as Record<string,unknown>;}catch{}
    if(scopedSite!==undefined&&row.site!==scopedSite)throw new Error('Analytics source violated enforced site scope');
    const raw=chart.groupBy==='event'?row.event_name:chart.groupBy==='day'?new Date(Number(row.occurred_at)).toISOString().slice(0,10):chart.groupBy==='source'?row.source:chart.groupBy==='site'?row.site:chart.groupBy==='pathname'?row.pathname:props[chart.groupBy.slice(9)];
    const category=String(raw??'(not set)').slice(0,150);
    const value=chart.valueField?props[chart.valueField]:1;
    let group=groups.get(category);if(!group){group={count:0,numericCount:0,sum:0,min:Infinity,max:-Infinity,unique:new Set()};groups.set(category,group);}
    group.count++;all.count++;
    if(typeof value==='number'&&Number.isFinite(value)){for(const item of [group,all]){item.numericCount++;item.sum+=value;item.min=Math.min(item.min,value);item.max=Math.max(item.max,value);}}
    const distinct=String(value??'');if(group.unique.size<10000)group.unique.add(distinct);if(all.unique.size<10000)all.unique.add(distinct);
  }
  const metric=(group:{count:number;numericCount:number;sum:number;min:number;max:number;unique:Set<string>},method:Metric)=>({count:group.count,sum:group.sum,average:group.numericCount?group.sum/group.numericCount:0,min:Number.isFinite(group.min)?group.min:0,max:Number.isFinite(group.max)?group.max:0,distinct:group.unique.size})[method];
  const items:Array<Item>=[...groups].map(([category,group])=>({category,value:metric(group,chart.metric)}));
  if(chart.groupBy==='day')items.sort((a,b)=>a.category.localeCompare(b.category));else items.sort((a,b)=>b.value-a.value);
  const output=items.slice(0,60);
  return {id:chart.id,title:chart.title,type:chart.type,labels:output.map(i=>i.category),values:output.map(i=>i.value),total:metric(all,chart.metric),sampledRows:rows.length,truncated:rows.length>=take,queryMode:'sampled',coverage:'bounded-source-event-page'};
}
