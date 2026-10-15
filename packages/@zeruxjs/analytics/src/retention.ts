import type {AnalyticsConnection} from './types.js';

/** Bounded site-scoped, keyset-paged purge. Rerun from the beginning to catch late historical writes. */
export interface AnalyticsRetentionQuery {
  /** Nonempty tenant site. A global all-sites purge is deliberately unsupported. */
  site:string;
  /** Delete only events strictly before this UTC millisecond timestamp. At least one day old. */
  before:number;
  cursor?:string;
  limit?:number;
  /** Defaults to true. Explicit false and application approval required to delete. */
  dryRun?:boolean;
  /** Required for destructive purges when numericFields are no longer configured.
   * 'absent' is an explicit attestation that no prior sidecar table contains this site's facts. */
  numericSidecar?:'present'|'absent';
}
export interface AnalyticsRetentionResult {
  scanned:number;deleted:number;deletedNumericFacts:number;
  nextCursor:string|null;hasMore:boolean;dryRun:boolean;
  /** Scanned records may have concurrent inserts; never describes a point-in-time snapshot. */
  coverage:'bounded-keyset';
}
const eventId=/^[A-Za-z0-9_-]{1,64}$/;
/** Explicit site + cutoff required, avoids full-table deletion on malformed options. */
export function validateRetentionQuery(query:AnalyticsRetentionQuery):void {
  if(!query||typeof query.site!=='string'||query.site.length<1||query.site.length>200||/[\x00-\x1f]/.test(query.site))throw new TypeError('Retention requires a valid tenant site');
  if(!Number.isSafeInteger(query.before)||query.before<0||query.before>Date.now()-86400000)throw new RangeError('Retention cutoff must be at least one day old');
  if(query.cursor!==undefined&&!eventId.test(query.cursor))throw new TypeError('Invalid retention cursor');
  const limit=query.limit??100;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RangeError('Retention page size must be between 1 and 100');
  if(query.numericSidecar!==undefined&&!['present','absent'].includes(query.numericSidecar))throw new TypeError('Invalid sidecar retention policy');
}
/** Retention is an administrative operation; callers must enforce approvals and role/tenant permissions. */
export async function purgeAnalyticsEvents(connection:AnalyticsConnection,eventTable:string,numericTable:string,
  query:AnalyticsRetentionQuery,options:{numericTableReady:boolean}):Promise<AnalyticsRetentionResult>{
  validateRetentionQuery(query);
  const limit=query.limit??100;
  const where:[{field:string;operator:'eq';value:string},{field:string;operator:'lt';value:number},...Array<{field:string;operator:'gt';value:string}>]=[
    {field:'site',operator:'eq',value:query.site},
    {field:'occurred_at',operator:'lt',value:query.before}
  ];
  if(query.cursor)where.push({field:'id',operator:'gt',value:query.cursor});
  const read=await connection.select({table:eventTable,columns:['id'],where:{and:where},orderBy:[{by:'id',direction:'asc'}],limit:limit+1});
  if(!read?.ok||!Array.isArray(read.rows))throw new Error('Retention event read unavailable');
  const hasMore=read.rows.length>limit,rows=read.rows.slice(0,limit) as Array<{id:unknown}>;
  if(rows.some(row=>typeof row.id!=='string'||!eventId.test(row.id)))throw new Error('Unsafe persisted event identifier');
  const dryRun=query.dryRun!==false;
  if(!dryRun&&!connection.delete)throw new Error('Retention requires delete support');
  if(!dryRun&&!options.numericTableReady&&!['present','absent'].includes(query.numericSidecar??''))throw new Error('Retention requires explicit historical numeric sidecar policy');
  const removeFacts=options.numericTableReady||query.numericSidecar==='present';
  let deleted=0,deletedNumericFacts=0;
  for(const row of rows){
    if(dryRun)continue;
    const id=row.id as string;
    if(removeFacts){
      // Validate numeric facts before touching them. Never use an event's ID to
      // erase another tenant's facts if the database contains corrupt duplicates.
      const existing=await connection.select({table:numericTable,columns:['event_id','site','occurred_at'],
        where:{field:'event_id',operator:'eq',value:id},limit:101});
      if(!existing?.ok||!Array.isArray(existing.rows)||existing.rows.length>100||existing.rows.some(value=>{
        const fact=value as {site?:unknown;occurred_at?:unknown};
        const at=typeof fact.occurred_at==='string'&&/^\d+$/.test(fact.occurred_at)?Number(fact.occurred_at):fact.occurred_at;
        return fact.site!==query.site||!Number.isSafeInteger(at)||(at as number)>=query.before;
      }))throw new Error('Numeric retention contains conflicting tenant/date facts; source event preserved');
      // Facts first, bound by site and cutoff. A crash before source deletion
      // leaves the source event available for an idempotent page replay.
      const facts=await connection.delete!({table:numericTable,where:{and:[
        {field:'event_id',operator:'eq',value:id},
        {field:'site',operator:'eq',value:query.site},
        {field:'occurred_at',operator:'lt',value:query.before}
      ]}});
      if(!facts?.ok)throw new Error('Numeric retention delete failed; source event preserved');
      const removed=facts.affectedCount??facts.rowCount;
      if(!Number.isSafeInteger(removed)||removed!==existing.rows.length)
        throw new Error('Numeric retention result is indeterminate; source event preserved');
      deletedNumericFacts+=removed;
    }
    // Scope EACH delete by both tenant and old timestamp, not by cursor alone.
    const result=await connection.delete!({table:eventTable,where:{and:[
      {field:'id',operator:'eq',value:id},
      {field:'site',operator:'eq',value:query.site},
      {field:'occurred_at',operator:'lt',value:query.before}
    ]}});
    if(!result?.ok)throw new Error('Event retention delete failed; replay this page from its prior cursor');
    deleted+=(result.affectedCount??result.rowCount??0) as number;
  }
  return {scanned:rows.length,deleted,deletedNumericFacts,
    nextCursor:hasMore?(rows.at(-1)?.id as string):null,hasMore,dryRun,coverage:'bounded-keyset'};
}
