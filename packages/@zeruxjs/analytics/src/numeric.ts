import type {AnalyticsConnection,AnalyticsNumericAggregateQuery,AnalyticsNumericAggregateResult} from './types.js';
import {validateAggregateQuery} from './aggregation.js';

const dimensions={event:'event_name',source:'source',site:'site',pathname:'pathname'} as const;
const fields=/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
type Clause={field:string;operator:'eq'|'gte'|'lte';value:string|number};
const where=(items:Clause[])=>items.length===1?items[0]:{and:items};
const col=(name:string)=>({kind:'column' as const,name});
const func=(name:'COUNT'|'SUM'|'AVG'|'MIN'|'MAX',field:string,as:string)=>({expr:{kind:'function' as const,name,args:[col(field)]},as});
const metricName={sum:'SUM',average:'AVG',min:'MIN',max:'MAX'} as const;
const countColumn=func('COUNT','event_id','numeric_count');
const readCount=(n:unknown):number=>{
  const value=typeof n==='string'&&/^\d+$/.test(n)?Number(n):n;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Invalid numeric fact count');
  return value;
};
const readMetric=(n:unknown,count:number):number=>{
  if(count===0&&(n===null||n===undefined))return 0;
  const value=typeof n==='string'&&n.trim()!==''?Number(n):n;
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Invalid numeric aggregate returned by database');
  return value;
};
async function select(connection:AnalyticsConnection,operation:Parameters<AnalyticsConnection['select']>[0]){
  const response=await connection.select(operation);
  if(!response?.ok||!Array.isArray(response.rows))throw new Error('Numeric analytics storage unavailable');
  return response.rows as Record<string,unknown>[];
}
/** Database-native metrics on opt-in, committed numeric facts. Does not claim historical event coverage. */
export async function aggregateNumericFacts(connection:AnalyticsConnection,table:string,query:AnalyticsNumericAggregateQuery):Promise<AnalyticsNumericAggregateResult>{
  validateAggregateQuery(query);
  if(!Object.hasOwn(metricName,query.metric)||!fields.test(query.valueField)||['constructor','prototype','__proto__'].includes(query.valueField))throw new TypeError('Invalid numeric metric or property');
  const filters:Clause[]=[{field:'property_name',operator:'eq',value:query.valueField}];
  if(query.name)filters.push({field:'event_name',operator:'eq',value:query.name});
  if(query.source)filters.push({field:'source',operator:'eq',value:query.source});
  if(query.site!==undefined)filters.push({field:'site',operator:'eq',value:query.site});
  if(query.since!==undefined)filters.push({field:'occurred_at',operator:'gte',value:query.since});
  if(query.until!==undefined)filters.push({field:'occurred_at',operator:'lte',value:query.until});
  const valueColumn=func(metricName[query.metric],'numeric_value','metric_value');
  const columns=[valueColumn,countColumn];
  const totalRows=await select(connection,{table,columns,where:where(filters)});
  if(totalRows.length!==1)throw new Error('Invalid numeric aggregate result');
  const matchedFacts=readCount(totalRows[0]!.numeric_count);
  const total=readMetric(totalRows[0]!.metric_value,matchedFacts);
  const limit=query.limit??100;
  let groups:AnalyticsNumericAggregateResult['groups']=[],truncated=false;
  if(query.groupBy==='day'){
    if(query.since===undefined||query.until===undefined)throw new RangeError('Daily numeric aggregation requires explicit range');
    const start=new Date(query.since);const end=new Date(query.until);
    const first=Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),start.getUTCDate());
    const last=Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),end.getUTCDate());
    const days=Math.floor((last-first)/86400000)+1;
    if(days>366)throw new RangeError('Daily numeric range exceeds 366 UTC days');
    for(let index=0;index<days;index+=6){
      const batch=Array.from({length:Math.min(6,days-index)},async(_,offset)=>{
        const at=first+(index+offset)*86400000;
        const ranges:Clause[]=[...filters.filter(f=>f.field!=='occurred_at'),
          {field:'occurred_at',operator:'gte',value:Math.max(at,query.since!)},
          {field:'occurred_at',operator:'lte',value:Math.min(at+86400000-1,query.until!)}];
        const rows=await select(connection,{table,columns,where:where(ranges)});
        if(rows.length!==1)throw new Error('Invalid daily numeric aggregate result');
        return {category:new Date(at).toISOString().slice(0,10),value:readMetric(rows[0]!.metric_value,readCount(rows[0]!.numeric_count))};
      });
      groups.push(...await Promise.all(batch));
    }
    truncated=groups.length>limit;
    groups=groups.slice(0,limit);
  }else{
    const column=dimensions[query.groupBy];
    const rows=await select(connection,{table,columns:[{expr:col(column),as:'category'},...columns],where:where(filters),groupBy:[column],orderBy:[{by:'metric_value',direction:'desc'},{by:column,direction:'asc'}],limit:limit+1});
    truncated=rows.length>limit;
    groups=rows.slice(0,limit).map(row=>{
      if(typeof row.category!=='string')throw new Error('Invalid numeric group label');
      return {category:row.category.slice(0,150),value:readMetric(row.metric_value,readCount(row.numeric_count))};
    });
  }
  return {groups,total,matchedFacts,truncated,mode:'materialized',coverage:'indexed-only',groupBy:query.groupBy,metric:query.metric,valueField:query.valueField};
}
