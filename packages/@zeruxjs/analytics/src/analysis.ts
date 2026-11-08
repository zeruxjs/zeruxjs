import {createHash} from 'node:crypto';
import type {AnalyticsConnection,AnalyticsRow} from './types.js';
import {readEventSchemaCoverage} from './schemas.js';
import {validateTableName} from './validation.js';

const DAY=86400000;
export type AnalyticsAnalysisKind='sessions'|'funnel'|'cohort'|'indexes';
export interface AnalyticsAnalysisOptions {
  /** Fixed, host-verified tenant/site; query objects cannot override it. */
  site:string;
  authorize:(context:Readonly<{site:string;kind:AnalyticsAnalysisKind;signal:AbortSignal}>)=>boolean|Promise<boolean>;
  maxEvents?:number;pageSize?:number;maxBytes?:number;maxConcurrent?:number;timeoutMs?:number;
}
export interface AnalyticsAnalysisExecution {signal?:AbortSignal;deadline?:number}
export interface AnalyticsAnalysisWindow {since:number;until:number;plan?:'bounded'}
export interface AnalyticsSessionQuery extends AnalyticsAnalysisWindow {timeoutMs?:number;maxDurationMs?:number}
export interface AnalyticsFunnelQuery extends AnalyticsAnalysisWindow {steps:readonly string[];conversionWindowMs?:number;identity?:'visitor'|'session'}
export interface AnalyticsCohortQuery extends AnalyticsAnalysisWindow {entryEvent:string;returnEvent:string;retentionDays:number}
export interface AnalyticsAnalysisCoverage {
  version:1;mode:'bounded-persisted-window'|'sampled-page';persistedCount:number;scanned:number;identified:number;
  missingIdentity:number;unconsented:number;invalid:number;legacyUnversioned:number;versioned:number;
  truncated:boolean;windowExhausted:boolean;countMatchesScan:boolean;snapshot:false;ingestion:'best-effort';historicalIdentity:'unknown';
  ordering:'occurred_at,id';boundary:'window-clipped';
}
export class AnalyticsAnalysisError extends Error {
  constructor(readonly code:string,cause?:unknown){super(`Analytics analysis failed (${code})`);this.name='AnalyticsAnalysisError';if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}
}
const failure=(code:string,cause?:unknown)=>new AnalyticsAnalysisError(code,cause);
function record(value:unknown,allowed:readonly string[]):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(k=>typeof k!=='string'||!allowed.includes(k)||!('value'in Object.getOwnPropertyDescriptor(value,k)!)))throw failure('INVALID_OPTIONS');
}
function integer(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw failure('INVALID_LIMIT');return value;}
const event=(value:unknown)=>{if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(value))throw failure('INVALID_EVENT');return value;};
const opaque=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(value);
const idPattern=/^[A-Za-z0-9_-]{1,36}$/;
const windowKeys=['since','until','plan'];
function window(query:AnalyticsAnalysisWindow,extra:readonly string[]=[]){
  record(query,[...windowKeys,...extra]);if(query.plan!==undefined&&query.plan!=='bounded')throw failure('UNSUPPORTED_PLAN');
  integer(query.since,0,253402300799999);integer(query.until,0,Date.now());if(query.until<=query.since||query.until-query.since>31*DAY)throw failure('INVALID_WINDOW');
  return {since:query.since,until:query.until};
}
interface Observed {id:string;name:string;at:number;identity:string}
interface Scope {signal:AbortSignal;deadline:number;check:()=>void}
/** Explicit tenant-bound, cooperative read scope. Borrows its connection and never closes it. */
export function createAnalyticsAnalysis(options:AnalyticsAnalysisOptions&{connection:()=>AnalyticsConnection|undefined;table?:string}){
  record(options,['site','authorize','connection','table','maxEvents','pageSize','maxBytes','maxConcurrent','timeoutMs']);
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  if(typeof options.site!=='string'||!options.site.length||options.site.length>200||/[\x00-\x1f\x7f]/.test(options.site)||typeof options.authorize!=='function'||typeof options.connection!=='function')throw failure('INVALID_OPTIONS');
  const site=options.site,authorize=options.authorize,connection=options.connection,table=validateTableName(options.table??'analytics_events');
  const maxEvents=integer(options.maxEvents??5000,1,10000),pageSize=integer(options.pageSize??200,1,200),maxBytes=integer(options.maxBytes??8*1024*1024,1024,32*1024*1024),maxConcurrent=integer(options.maxConcurrent??2,1,16),timeoutMs=integer(options.timeoutMs??10000,1,60000);
  const pending=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();let closed=false;
  async function run<T>(kind:AnalyticsAnalysisKind,execution:AnalyticsAnalysisExecution,fn:(db:AnalyticsConnection,scope:Scope)=>Promise<T>):Promise<T>{
    record(execution,['signal','deadline']);if(execution.signal!==undefined&&!(execution.signal instanceof AbortSignal))throw failure('INVALID_OPTIONS');
    const requestedDeadline=execution.deadline===undefined?Infinity:integer(execution.deadline,0,Date.now()+60000);
    if(closed)throw failure('CLOSED');if(pending.size>=maxConcurrent)throw failure('OVERLOAD');
    const controller=new AbortController(),deadline=Math.min(Date.now()+timeoutMs,requestedDeadline);let timedOut=false;
    const abort=()=>controller.abort();const check=()=>{if(controller.signal.aborted||Date.now()>=deadline)throw failure(timedOut||Date.now()>=deadline?'DEADLINE':'CANCELLED');};
    execution.signal?.addEventListener('abort',abort,{once:true});if(execution.signal?.aborted)abort();controllers.add(controller);
    let timer:ReturnType<typeof setTimeout>|undefined,stop=()=>{};
    const stopped=new Promise<never>((_,reject)=>{stop=()=>reject(failure(timedOut?'DEADLINE':'CANCELLED'));controller.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(1,deadline-Date.now()));if(controller.signal.aborted)stop();});
    const work=Promise.resolve().then(async()=>{check();if(await authorize(Object.freeze({site,kind,signal:controller.signal}))!==true)throw failure('DENIED');check();const db=connection();if(!db)throw failure('UNAVAILABLE');return fn(db,{signal:controller.signal,deadline,check});});
    pending.add(work);void work.finally(()=>{pending.delete(work);controllers.delete(controller);}).catch(()=>{});
    try{return await Promise.race([work,stopped]);}catch(cause){throw cause instanceof AnalyticsAnalysisError?cause:failure('UNAVAILABLE',cause);}
    finally{if(timer)clearTimeout(timer);execution.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stop);}
  }
  async function scan(db:AnalyticsConnection,scope:Scope,range:{since:number;until:number},identity:'visitor'|'session'){
    const clauses=[{field:'site',operator:'eq' as const,value:site},{field:'occurred_at',operator:'gte' as const,value:range.since},{field:'occurred_at',operator:'lt' as const,value:range.until}];
    const select=async(operation:Parameters<AnalyticsConnection['select']>[0])=>{scope.check();const result=await db.select(operation,{signal:scope.signal,deadline:scope.deadline});scope.check();if(!result?.ok||!Array.isArray(result.rows))throw failure('UNSUPPORTED_OR_FAILED_PLAN');return result.rows as Record<string,unknown>[];};
    // COUNT/filter are executed by the connector. No raw SQL or unbounded select fallback.
    const totals=await select({table,columns:[{expr:{kind:'function',name:'COUNT',args:[{kind:'column',name:'id'}]},as:'analysis_count'}],where:{and:clauses}});
    const raw=totals[0]?.analysis_count,count=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw;
    if(totals.length!==1||typeof count!=='number'||!Number.isSafeInteger(count)||count<0)throw failure('INVALID_RESULT');
    const coverage:AnalyticsAnalysisCoverage={version:1,mode:'bounded-persisted-window',persistedCount:count,scanned:0,identified:0,missingIdentity:0,unconsented:0,invalid:0,legacyUnversioned:0,versioned:0,truncated:false,windowExhausted:false,countMatchesScan:false,snapshot:false,ingestion:'best-effort',historicalIdentity:'unknown',ordering:'occurred_at,id',boundary:'window-clipped'};
    const events:Observed[]=[];let cursor:string|undefined,bytes=0;
    while(true){
      const limit=Math.min(pageSize,maxEvents-coverage.scanned)+1;
      const rows=await select({table,columns:['id','event_name','site','session_id','occurred_at','properties_json'],where:{and:[...clauses,...(cursor?[{field:'id',operator:'gt' as const,value:cursor}]:[])]},orderBy:[{by:'id',direction:'asc'}],limit});
      if(rows.length>limit)throw failure('INVALID_RESULT');const take=Math.min(rows.length,limit-1);
      for(const row of rows.slice(0,take)){
        scope.check();if(typeof row.id!=='string'||!idPattern.test(row.id)||cursor!==undefined&&row.id<=cursor||row.site!==site)throw failure('SCOPE_OR_ORDER_VIOLATION');cursor=row.id;coverage.scanned++;
        if(typeof row.properties_json!=='string') {coverage.invalid++;continue;}
        if(Buffer.byteLength(row.properties_json)>8192)throw failure('BYTE_LIMIT');
        bytes+=Buffer.byteLength(row.properties_json)+256;if(bytes>maxBytes)throw failure('BYTE_LIMIT');
        const occurredAt=typeof row.occurred_at==='string'&&/^\d{1,15}$/.test(row.occurred_at)?Number(row.occurred_at):row.occurred_at;
        if(typeof row.event_name!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(row.event_name)||typeof occurredAt!=='number'||!Number.isSafeInteger(occurredAt)||occurredAt<range.since||occurredAt>=range.until){coverage.invalid++;continue;}
        let props:Record<string,unknown>;
        try{props=JSON.parse(row.properties_json);if(!props||typeof props!=='object'||Array.isArray(props))throw 0;const schema=readEventSchemaCoverage({properties_json:row.properties_json});if(schema.coverage==='versioned')coverage.versioned++;else coverage.legacyUnversioned++;}catch{coverage.invalid++;continue;}
        if(props.zConsent!=='granted'){coverage.unconsented++;continue;}
        const who=identity==='visitor'?props.zVisitorId:row.session_id;if(!opaque(who)){coverage.missingIdentity++;continue;}
        coverage.identified++;events.push({id:row.id,name:row.event_name,at:occurredAt,identity:who});
      }
      if(rows.length<limit){coverage.windowExhausted=true;break;}
      if(coverage.scanned===maxEvents){coverage.truncated=true;coverage.mode='sampled-page';break;}
    }
    coverage.countMatchesScan=coverage.windowExhausted&&coverage.scanned===coverage.persistedCount;
    events.sort((a,b)=>a.at-b.at||(a.id<b.id?-1:a.id>b.id?1:0));scope.check();return {events,coverage};
  }
  const known=(coverage:AnalyticsAnalysisCoverage)=>!coverage.truncated&&coverage.countMatchesScan&&!coverage.missingIdentity&&!coverage.unconsented&&!coverage.invalid;
  return Object.freeze({
    /** Optional explicit migration. External migrations may provision these same shapes. */
    initializeIndexes(execution:AnalyticsAnalysisExecution={}){return run('indexes',execution,async(db,scope)=>{
      if(!db.createIndex)throw failure('UNSUPPORTED_INDEX_PLAN');const hash=createHash('sha256').update(table).digest('hex').slice(0,8);
      for(const [suffix,columns] of [['site_id',['site','id']],['site_at_id',['site','occurred_at','id']]] as const){scope.check();const result=await db.createIndex({table,name:`${table.slice(0,39)}_${hash}_${suffix}`,columns:[...columns],ifNotExists:true},{signal:scope.signal,deadline:scope.deadline});scope.check();if(!result?.ok&&!['1061','ER_DUP_KEYNAME'].includes(String(result?.error?.code??'')))throw failure('UNSUPPORTED_INDEX_PLAN');}
      return {indexes:2};
    });},
    sessions(query:AnalyticsSessionQuery,execution:AnalyticsAnalysisExecution={}){
      const range=window(query,['timeoutMs','maxDurationMs']),idle=integer(query.timeoutMs??30*60000,60000,24*60*60000),duration=integer(query.maxDurationMs??24*60*60000,idle,24*60*60000);
      return run('sessions',execution,async(db,scope)=>{const {events,coverage}=await scan(db,scope,range,'session');const states=new Map<string,{first:number;last:number;count:number}>();let sessions=0,totalDurationMs=0;
        for(const item of events){scope.check();const previous=states.get(item.identity);if(!previous||item.at-previous.last>=idle||item.at-previous.first>=duration){sessions++;states.set(item.identity,{first:item.at,last:item.at,count:1});}else{totalDurationMs+=item.at-previous.last;previous.last=item.at;previous.count++;}}
        return {sessions,events:events.length,totalDurationMs,timeoutMs:idle,maxDurationMs:duration,semantics:'observed-window-sessions' as const,coverage};
      });
    },
    funnel(query:AnalyticsFunnelQuery,execution:AnalyticsAnalysisExecution={}){
      const range=window(query,['steps','conversionWindowMs','identity']);if(!Array.isArray(query.steps)||query.steps.length<2||query.steps.length>10)throw failure('INVALID_STEPS');const steps=Array.from(query.steps,event),conversionWindowMs=integer(query.conversionWindowMs??Math.min(DAY,range.until-range.since),1,Math.min(7*DAY,range.until-range.since)),identity=query.identity??'visitor';if(!['visitor','session'].includes(identity))throw failure('INVALID_IDENTITY');
      return run('funnel',execution,async(db,scope)=>{const {events,coverage}=await scan(db,scope,range,identity);const states=new Map<string,{stage:number;start:number;last:number;max:number}>();
        for(const item of events){scope.check();let state=states.get(item.identity);if(!state){state={stage:0,start:0,last:0,max:0};states.set(item.identity,state);}if(state.max===steps.length)continue;if(state.stage&&item.at-state.start>conversionWindowMs)state.stage=0;
          if(item.name===steps[state.stage]&&(!state.stage||item.at>state.last)){if(!state.stage)state.start=item.at;state.stage++;state.last=item.at;state.max=Math.max(state.max,state.stage);}}
        const reached=steps.map((name,index)=>({name,principals:[...states.values()].filter(s=>s.max>index).length})),entered=reached[0]!.principals,converted=reached.at(-1)!.principals;
        return {steps:reached,entered,converted:known(coverage)?converted:null,observedConverted:converted,conversionRate:known(coverage)&&entered?converted/entered:null,deduplication:'once-per-identity-window' as const,conversionWindowMs,coverage};
      });
    },
    cohort(query:AnalyticsCohortQuery,execution:AnalyticsAnalysisExecution={}){
      const range=window(query,['entryEvent','returnEvent','retentionDays']);if(range.since%DAY||range.until%DAY)throw failure('UTC_DAY_REQUIRED');const entryEvent=event(query.entryEvent),returnEvent=event(query.returnEvent),retentionDays=integer(query.retentionDays,0,30),observedUntil=Math.min(Date.now(),range.until+retentionDays*DAY);
      return run('cohort',execution,async(db,scope)=>{const {events,coverage}=await scan(db,scope,{since:range.since,until:observedUntil},'visitor');const members=new Map<string,{day:number;at:number}>();
        for(const item of events)if(item.name===entryEvent&&item.at<range.until&&!members.has(item.identity))members.set(item.identity,{day:Math.floor(item.at/DAY)*DAY,at:item.at});
        const retained=new Map<number,Set<string>[]>();for(let day=range.since;day<range.until;day+=DAY)retained.set(day,Array.from({length:retentionDays+1},()=>new Set<string>()));
        for(const item of events){scope.check();const joined=members.get(item.identity);if(joined===undefined||item.name!==returnEvent||item.at<joined.at)continue;const offset=Math.floor(item.at/DAY)-joined.day/DAY;if(offset>=0&&offset<=retentionDays)retained.get(joined.day)![offset]!.add(item.identity);}
        const cohorts=[...retained].map(([day,buckets])=>{const size=[...members.values()].filter(member=>member.day===day).length;return {day:new Date(day).toISOString().slice(0,10),principals:size,retention:buckets.map((set,offset)=>{const mature=day+(offset+1)*DAY<=observedUntil;return {day:offset,observed:mature?set.size:null,rate:mature&&known(coverage)&&size?set.size/size:null,complete:mature};})};});
        return {cohorts,membership:'first-entry-observed-in-window' as const,observedUntil,coverage};
      });
    },
    diagnostics(){return {closed,pending:pending.size};},
    async close(){closed=true;for(const controller of controllers)controller.abort();await Promise.allSettled([...pending]);}
  });
}
export type AnalyticsAnalysis=ReturnType<typeof createAnalyticsAnalysis>;
