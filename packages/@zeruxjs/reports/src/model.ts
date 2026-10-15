import type {ReportsDocument,ReportsStore,ChartDefinition,ChartData,AnalyticsReportSource,Metric} from './types.js';
const ident=/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
const chartTypes=['bar','horizontal-bar','line','area','pie','doughnut','scatter','stacked-bar','table','kpi'];
const metrics=['count','sum','average','min','max','distinct'];
export function validateReports(input:unknown):ReportsDocument{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Invalid reports document');
  const doc=input as ReportsDocument;if(!Number.isSafeInteger(doc.version)||doc.version<1||!Array.isArray(doc.reports)||doc.reports.length>100)throw new TypeError('Invalid reports version or size');
  const ids=new Set<string>();const unique=(id:string)=>{if(!ident.test(id)||ids.has(id))throw new TypeError('Invalid or repeated report ID');ids.add(id);};
  for(const report of doc.reports){unique(report.id);if(typeof report.name!=='string'||report.name.length<1||report.name.length>128||report.description!==undefined&&(typeof report.description!=='string'||report.description.length>1024)||!Array.isArray(report.pages)||report.pages.length>50)throw new TypeError('Invalid report');
    for(const page of report.pages){unique(page.id);if(typeof page.name!=='string'||page.name.length<1||page.name.length>128||!Array.isArray(page.charts)||page.charts.length>50)throw new TypeError('Invalid report page');
      for(const chart of page.charts){unique(chart.id);if(typeof chart.title!=='string'||chart.title.length<1||chart.title.length>128||!chartTypes.includes(chart.type)||!metrics.includes(chart.metric)||!['event','day','source','site','pathname'].includes(chart.groupBy)&&!/^property:[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(chart.groupBy))throw new TypeError('Invalid chart');
        if(chart.valueField!==undefined&&!ident.test(chart.valueField)||chart.eventName!==undefined&&!ident.test(chart.eventName)||chart.source!==undefined&&!['web','server','email','system'].includes(chart.source)||chart.site!==undefined&&(typeof chart.site!=='string'||chart.site.length>200||/[\x00-\x1f]/.test(chart.site))||chart.limit!==undefined&&(!Number.isSafeInteger(chart.limit)||chart.limit<1||chart.limit>500)||['since','until'].some(k=>{const n=chart[k as 'since'|'until'];return n!==undefined&&(!Number.isSafeInteger(n)||n<0);}))throw new TypeError('Invalid chart query');
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
  const take=Math.min(chart.limit??maxSourceRows,maxSourceRows);
  const scopedSite=site??chart.site;
  if(chart.metric==='count'&&typeof source.aggregate==='function'&&(
      ['event','source','site','pathname'].includes(chart.groupBy)||chart.groupBy==='day'&&chart.since!==undefined&&chart.until!==undefined)){
    const result=await source.aggregate({groupBy:chart.groupBy as 'event'|'source'|'site'|'pathname'|'day',
      name:chart.eventName,source:chart.source,site:scopedSite,since:chart.since,until:chart.until,limit:chart.limit??100});
    const output=chart.groupBy==='day'?[...result.groups].sort((a,b)=>a.category.localeCompare(b.category)):result.groups;
    const visible=output.slice(0,60);
    return {id:chart.id,title:chart.title,type:chart.type,labels:visible.map(g=>g.category),values:visible.map(g=>g.value),
      total:result.total,sampledRows:0,truncated:result.truncated||output.length>60,queryMode:'database'};
  }
  if(chart.metric!=='count'&&chart.metric!=='distinct'&&chart.valueField&&typeof source.aggregateNumeric==='function'&&(typeof source.supportsNumericField!=='function'||source.supportsNumericField(chart.valueField))&&(
      ['event','source','site','pathname'].includes(chart.groupBy)||chart.groupBy==='day'&&chart.since!==undefined&&chart.until!==undefined)){
    const result=await source.aggregateNumeric({groupBy:chart.groupBy as 'event'|'source'|'site'|'pathname'|'day',
      metric:chart.metric,valueField:chart.valueField,name:chart.eventName,source:chart.source,
      site:scopedSite,since:chart.since,until:chart.until,limit:chart.limit??100});
    const output=chart.groupBy==='day'?[...result.groups].sort((a,b)=>a.category.localeCompare(b.category)):result.groups;
    const visible=output.slice(0,60);
    return {id:chart.id,title:chart.title,type:chart.type,labels:visible.map(g=>g.category),values:visible.map(g=>g.value),
      total:result.total,sampledRows:0,truncated:result.truncated||output.length>60,queryMode:'materialized',
      numericCoverage:result.coverage,matchedFacts:result.matchedFacts};
  }
  const rows=await source.events({name:chart.eventName,source:chart.source,site:scopedSite,since:chart.since,until:chart.until,limit:take});
  const groups=new Map<string,{count:number;sum:number;min:number;max:number;unique:Set<string>}>();
  for(const row of rows){
    let props:Record<string,unknown>={};try{props=JSON.parse(row.properties_json) as Record<string,unknown>;}catch{}
    const raw=chart.groupBy==='event'?row.event_name:chart.groupBy==='day'?new Date(Number(row.occurred_at)).toISOString().slice(0,10):chart.groupBy==='source'?row.source:chart.groupBy==='site'?row.site:chart.groupBy==='pathname'?row.pathname:props[chart.groupBy.slice(9)];
    const category=String(raw??'(not set)').slice(0,150);
    const value=chart.valueField?props[chart.valueField]:1;
    let group=groups.get(category);if(!group){group={count:0,sum:0,min:Infinity,max:-Infinity,unique:new Set()};groups.set(category,group);}
    group.count++;
    if(typeof value==='number'&&Number.isFinite(value)){group.sum+=value;group.min=Math.min(group.min,value);group.max=Math.max(group.max,value);}
    if(group.unique.size<10000)group.unique.add(String(value??''));
  }
  const metric=(group:{count:number;sum:number;min:number;max:number;unique:Set<string>},method:Metric)=>({count:group.count,sum:group.sum,average:group.count?group.sum/group.count:0,min:Number.isFinite(group.min)?group.min:0,max:Number.isFinite(group.max)?group.max:0,distinct:group.unique.size})[method];
  const items:Array<Item>=[...groups].map(([category,group])=>({category,value:metric(group,chart.metric)}));
  if(chart.groupBy==='day')items.sort((a,b)=>a.category.localeCompare(b.category));else items.sort((a,b)=>b.value-a.value);
  const output=items.slice(0,60);
  return {id:chart.id,title:chart.title,type:chart.type,labels:output.map(i=>i.category),values:output.map(i=>i.value),total:items.reduce((sum,i)=>sum+i.value,0),sampledRows:rows.length,truncated:rows.length>=take,queryMode:'sampled'};
}
