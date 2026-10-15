import type {AnalyticsConnection, AnalyticsRow} from './types.js';
import {createHash} from 'node:crypto';

/** Stable across numericFields ordering changes; legacy positional IDs remain readable. */
export const numericFactId=(eventId:string,field:string):string=>`${eventId}_h${createHash('sha256').update(field).digest('hex').slice(0,24)}`;

/** One bounded, resumable keyset page. Run from a trusted administrative process, never a public route. */
export interface NumericReconciliationQuery {
  /** An explicit closed historical UTC millisecond range. */
  since:number;
  until:number;
  /** Optional tenant boundary. */
  site?:string;
  /** The last scanned event's ID, returned as nextCursor by the previous page. */
  cursor?:string;
  /** Maximum scanned source events, 1..200. Defaults to 100. */
  batchSize?:number;
}
export interface NumericReconciliationResult {
  scanned:number;
  expectedFacts:number;
  created:number;
  existing:number;
  invalidRows:number;
  /** null means the bounded source window was exhausted at the time of this read. */
  nextCursor:string|null;
  hasMore:boolean;
  /** Only a source-scan completion indicator, NOT a transactional completeness guarantee. */
  windowExhausted:boolean;
}
type Predicate={field:string;operator:'eq'|'gte'|'lte'|'gt';value:string|number};
type NumericFact={id:string;event_id:string;property_name:string;numeric_value:number;event_name:string;source:string;site:string;pathname:string;occurred_at:number};
const valuesEqual=(left:unknown,right:unknown):boolean=>typeof left==='number'&&typeof right==='number'?Object.is(left,right):left===right;
const matches=(row:Record<string,unknown>,fact:NumericFact)=>
  (Object.keys(fact) as Array<keyof NumericFact>).every(key=>valuesEqual(row[key],fact[key]));
async function checkedSelect(connection:AnalyticsConnection,operation:Parameters<AnalyticsConnection['select']>[0]):Promise<Record<string,unknown>[]> {
  const response=await connection.select(operation);
  if(!response?.ok||!Array.isArray(response.rows))throw new Error('Numeric reconciliation read failed');
  return response.rows as Record<string,unknown>[];
}
/** Strictly validates a persisted row without invoking modern event-ingestion date restrictions. */
function buildFacts(row:AnalyticsRow,fields:readonly string[]):NumericFact[]|null {
  if(!row||typeof row.id!=='string'||!row.id||row.id.length>36||typeof row.properties_json!=='string'||
    typeof row.event_name!=='string'||typeof row.source!=='string'||typeof row.site!=='string'||
    typeof row.pathname!=='string'||!Number.isSafeInteger(row.occurred_at)||row.occurred_at<0)return null;
  let properties:unknown;
  try{properties=JSON.parse(row.properties_json);}catch{return null;}
  if(!properties||typeof properties!=='object'||Array.isArray(properties))return null;
  const record=properties as Record<string,unknown>;
  return fields.flatMap((field)=>typeof record[field]==='number'&&Number.isFinite(record[field])?[{
    id:numericFactId(row.id,field),event_id:row.id,property_name:field,numeric_value:record[field] as number,
    event_name:row.event_name,source:row.source,site:row.site,pathname:row.pathname,occurred_at:row.occurred_at
  }]:[]);
}
/** Prevents duplicate facts across reordered numericFields and retries. A unique DB index is mandatory for concurrent writers. */
async function ensureFact(connection:AnalyticsConnection,table:string,fact:NumericFact):Promise<'created'|'existing'> {
  const lookup=()=>checkedSelect(connection,{table,columns:Object.keys(fact),where:{and:[
    {field:'event_id',operator:'eq',value:fact.event_id},
    {field:'property_name',operator:'eq',value:fact.property_name}
  ]},limit:2});
  let rows=await lookup();
  if(rows.length>1)throw new Error('Duplicate numeric facts already exist; repair database before reconciliation');
  if(rows.length===1){
    // Legacy position-derived IDs are accepted, but values/dimensions must match.
    const {id:_ignored,...values}=fact;
    for(const [key,value] of Object.entries(values))if(!valuesEqual(rows[0]![key],value))throw new Error('Conflicting numeric fact; manual correction required');
    return 'existing';
  }
  try{
    const saved=await connection.insert({table,values:fact});
    if(saved?.ok)return 'created';
  }catch{/* Might be a concurrent, successful insert. Check before returning an error. */}
  rows=await lookup();
  if(rows.length===1){
    const {id:_ignored,...values}=fact;
    for(const [key,value] of Object.entries(values))if(!valuesEqual(rows[0]![key],value))throw new Error('Conflicting numeric fact after insert');
    return 'existing';
  }
  throw new Error('Numeric reconciliation insert failed');
}

export async function reconcileNumericFacts(
  connection:AnalyticsConnection,eventTable:string,factTable:string,fields:readonly string[],query:NumericReconciliationQuery
):Promise<NumericReconciliationResult>{
  if(!query||!Number.isSafeInteger(query.since)||!Number.isSafeInteger(query.until)||
    query.since<0||query.until<query.since)throw new RangeError('Numeric reconciliation requires a valid closed time window');
  if(query.site!==undefined&&(typeof query.site!=='string'||query.site.length>200||/[\x00-\x1f]/.test(query.site)))throw new TypeError('Invalid reconciliation site');
  if(query.cursor!==undefined&&(typeof query.cursor!=='string'||query.cursor.length>36||/[\x00-\x20\x7f]/.test(query.cursor)))throw new TypeError('Invalid reconciliation cursor');
  const batchSize=query.batchSize??100;
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>200)throw new RangeError('Invalid reconciliation batch size');
  const where:Predicate[]=[
    {field:'occurred_at',operator:'gte',value:query.since},
    {field:'occurred_at',operator:'lte',value:query.until}
  ];
  if(query.site!==undefined)where.push({field:'site',operator:'eq',value:query.site});
  if(query.cursor)where.push({field:'id',operator:'gt',value:query.cursor});
  const rows=await checkedSelect(connection,{table:eventTable,
    columns:['id','event_name','source','site','pathname','occurred_at','properties_json'],
    where:{and:where},orderBy:[{by:'id',direction:'asc'}],limit:batchSize+1});
  const hasMore=rows.length>batchSize;
  const scannedRows=rows.slice(0,batchSize) as unknown as AnalyticsRow[];
  let expectedFacts=0,created=0,existing=0,invalidRows=0;
  for(const row of scannedRows){
    const facts=buildFacts(row,fields);
    if(facts===null){invalidRows++;continue;}
    expectedFacts+=facts.length;
    for(const fact of facts){
      const status=await ensureFact(connection,factTable,fact);
      if(status==='created')created++;else existing++;
    }
  }
  const nextCursor=hasMore?scannedRows.at(-1)?.id:null;
  if(hasMore&&!nextCursor)throw new Error('Invalid persisted event ID; cannot resume reconciliation');
  return {scanned:scannedRows.length,expectedFacts,created,existing,invalidRows,
    nextCursor:nextCursor??null,hasMore,windowExhausted:!hasMore};
}
