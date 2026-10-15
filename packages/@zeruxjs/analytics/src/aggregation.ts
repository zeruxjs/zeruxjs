import type {AnalyticsConnection,AnalyticsSummaryQuery,AnalyticsAggregateQuery,AnalyticsAggregateResult} from './types.js';

const dimensions={event:'event_name',source:'source',site:'site',pathname:'pathname'} as const;
type Clause={field:string;operator:'eq'|'gte'|'lte';value:string|number};
const utcDate=/^\d{4}-\d\d-\d\d$/;
const readCount=(value:unknown):number=>{
  const number=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
  if(typeof number!=='number'||!Number.isSafeInteger(number)||number<0)throw new Error('Invalid analytics count returned by database');
  return number;
};
const where=(conditions:Clause[])=>conditions.length===1?conditions[0]:{and:conditions};
const countExpr={expr:{kind:'function' as const,name:'COUNT' as const,args:[{kind:'column' as const,name:'id'}]},as:'event_count'};
const getRows=async(connection:AnalyticsConnection,operation:Parameters<AnalyticsConnection['select']>[0])=>{
  const response=await connection.select(operation);
  if(!response?.ok||!Array.isArray(response.rows))throw new Error('Analytics aggregate storage unavailable');
  return response.rows as Record<string,unknown>[];
};
export function validateAggregateQuery(query:AnalyticsAggregateQuery){
  if(!['event','source','site','pathname','day'].includes(query.groupBy))throw new TypeError('Unsupported analytics aggregate dimension');
  if(query.limit!==undefined&&(!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>500))throw new RangeError('Invalid aggregate group limit');
  for(const value of [query.since,query.until])if(value!==undefined&&(!Number.isSafeInteger(value)||value<0||value>253402300799999))throw new RangeError('Invalid analytics query time');
  if(query.since!==undefined&&query.until!==undefined&&query.since>query.until)throw new RangeError('Reversed analytics time range');
  if(query.name!==undefined&&!/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(query.name))throw new TypeError('Invalid event name');
  if(query.source!==undefined&&!['web','email','server','system'].includes(query.source))throw new TypeError('Invalid event source');
  if(query.site!==undefined&&(typeof query.site!=='string'||query.site.length>200||/[\x00-\x1f]/.test(query.site)))throw new TypeError('Invalid site');
}
/** Native COUNT with DB-side filters. Throws on query errors; a failed report must never be displayed as zero.
 * Grouped dimensions use the DB's standard function/query DSL, not string-built SQL.
 * Daily buckets use exact UTC half-open intervals (portable across SQL dialects/Mongo).
 */
export async function aggregateEventCounts(connection:AnalyticsConnection,table:string,query:AnalyticsAggregateQuery):Promise<AnalyticsAggregateResult>{
  validateAggregateQuery(query);
  const conditions:Clause[]=[];
  if(query.name)conditions.push({field:'event_name',operator:'eq',value:query.name});
  if(query.source)conditions.push({field:'source',operator:'eq',value:query.source});
  if(query.site!==undefined)conditions.push({field:'site',operator:'eq',value:query.site});
  if(query.since!==undefined)conditions.push({field:'occurred_at',operator:'gte',value:query.since});
  if(query.until!==undefined)conditions.push({field:'occurred_at',operator:'lte',value:query.until});
  const totalRows=await getRows(connection,{table,columns:[countExpr],...(conditions.length?{where:where(conditions)}:{})});
  if(totalRows.length!==1)throw new Error('Invalid analytics aggregate result');
  const total=readCount(totalRows[0]!.event_count);
  const limit=query.limit??100;
  if(query.groupBy==='day'){
    // A bounded interval is compulsory; otherwise an unbounded number of DB round-trips is possible.
    if(query.since===undefined||query.until===undefined)throw new RangeError('Daily aggregations require explicit since and until timestamps');
    const start=Date.UTC(new Date(query.since).getUTCFullYear(),new Date(query.since).getUTCMonth(),new Date(query.since).getUTCDate());
    const end=Date.UTC(new Date(query.until).getUTCFullYear(),new Date(query.until).getUTCMonth(),new Date(query.until).getUTCDate());
    const days=Math.floor((end-start)/86400000)+1;
    if(days>366)throw new RangeError('Daily query range exceeds 366 UTC days');
    const groups:AnalyticsAggregateResult['groups']=[];
    // Bounded fixed concurrency for DB pools. All bounds remain inclusive at millisecond precision.
    for(let index=0;index<days;index+=6){
      const batch=Array.from({length:Math.min(6,days-index)},(_,offset)=>{
        const at=start+(index+offset)*86400000;
        const day=new Date(at).toISOString().slice(0,10);
        if(!utcDate.test(day))throw new Error('Invalid UTC day');
        const startAt=Math.max(at,query.since!);
        const endAt=Math.min(at+86400000-1,query.until!);
        return getRows(connection,{table,columns:[countExpr],where:where([
          ...conditions.filter(c=>c.field!=='occurred_at'),
          {field:'occurred_at',operator:'gte',value:startAt},
          {field:'occurred_at',operator:'lte',value:endAt}
        ])}).then(rows=>{
          if(rows.length!==1)throw new Error('Invalid daily aggregate result');
          return {category:day,value:readCount(rows[0]!.event_count)};
        });
      });
      groups.push(...await Promise.all(batch));
    }
    return {groups:groups.slice(0,limit),total,truncated:groups.length>limit,mode:'database',groupBy:'day'};
  }
  const column=dimensions[query.groupBy];
  const rows=await getRows(connection,{table,columns:[{expr:{kind:'column',name:column},as:'category'},countExpr],
    ...(conditions.length?{where:where(conditions)}:{}),groupBy:[column],orderBy:[{by:'event_count',direction:'desc'},{by:column,direction:'asc'}],limit:limit+1});
  const groups=rows.slice(0,limit).map(row=>{
    if(typeof row.category!=='string')throw new Error('Invalid analytics aggregate dimension');
    return {category:row.category.slice(0,150),value:readCount(row.event_count)};
  });
  return {groups,total,truncated:rows.length>limit,mode:'database',groupBy:query.groupBy};
}
