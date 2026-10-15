import type {AnalyticsConfig,AnalyticsConnection,AnalyticsEventInput,AnalyticsRow,AnalyticsSummaryQuery,AnalyticsAggregateQuery,AnalyticsNumericAggregateQuery,DatabaseResultLike} from './types.js';
import {validateEvent,validateTableName} from './validation.js';
import {createDatabaseRequestIdStore} from './request-id.js';
import {createDatabaseDocumentStore} from './documents.js';
import {aggregateEventCounts} from './aggregation.js';
import {aggregateNumericFacts} from './numeric.js';
import {reconcileNumericFacts,numericFactId} from './reconciliation.js';
import type {NumericReconciliationQuery} from './reconciliation.js';
import {createNumericReconciliationJob} from './jobs.js';
import type {NumericReconciliationJobOptions,NumericReconciliationJobDocument} from './jobs.js';
import type {DocumentConnection,VersionedDocument} from './documents.js';
import {createHash} from 'node:crypto';

/** Analytics is best-effort telemetry: missing storage, invalid samples and DB failures never escape. */
export function createAnalytics(config:AnalyticsConfig = {}){
  config=config??{};
  const warnings=new Set<string>();
  const warn=(code:string)=>{
    if(warnings.has(code))return;
    warnings.add(code);
    try{(config.onWarning??((message:string)=>console.warn(message)))(`[analytics] ${code}`);}catch{/* warning hooks are also best-effort */}
  };
  let table='analytics_events';let invalidTable=false;
  try{table=validateTableName(config.table??table);}catch{invalidTable=true;warn('invalid table configuration; analytics disabled');}
  let enabled=config.enabled!==false&&!invalidTable;
  // Numeric materialization is explicit. Never silently opt in every property.
  let numericFields:string[]=[];
  try{
    if(config.numericFields!==undefined){
      if(!Array.isArray(config.numericFields)||config.numericFields.length>8||new Set(config.numericFields).size!==config.numericFields.length||config.numericFields.some(field=>typeof field!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(field)||['constructor','prototype','__proto__'].includes(field)))throw new Error();
      numericFields=[...config.numericFields];
    }
  }catch{warn('invalid numericFields configuration; numeric materialization disabled');}
  const numericTable=`${table.slice(0,55)}_numeric`;
  let numericReady=false,numericIndexed=0,numericDropped=0,numericUniqueIndexReady=false;
  const databaseName=config.analytics;
  const locate=():AnalyticsConnection|undefined=>{
    if(!enabled)return undefined;
    try{
      if(!databaseName||!config.database?.connectionSlugs?.includes(databaseName)){
        warn('configured database connector unavailable; event skipped');return undefined;
      }
      return config.database.getConnectionFacade(databaseName);
    }catch{
      warn('configured database connector unavailable; event skipped');return undefined;
    }
  };
  function succeeded(response:DatabaseResultLike|undefined):boolean{return response?.ok===true;}
  let initializing:Promise<boolean>|undefined,initialized=false,indexesReady=false,recorded=0,dropped=0;
  const manager={
    databaseConnection:databaseName,
    /** Uses the named analytics DB for atomic UTC-day request ID reservations. */
    createRequestIdStore(){const connection=locate();return connection?createDatabaseRequestIdStore(connection):undefined;},
    createDocumentStore<T extends VersionedDocument>(table:string,id:string,initial:T){const connection=locate();return connection?.update?createDatabaseDocumentStore(connection as DocumentConnection,table,id,initial):undefined;},
    get enabled(){return enabled;},
    /** Reports can retain sampled compatibility when no numeric materialization is configured. */
    supportsNumericField(field:string){return numericFields.includes(field);},
    setEnabled(value:boolean){enabled=value===true;},
    status(){return {enabled,configured:!!databaseName,connected:!!locate(),initialized,indexesReady,numericReady,numericIndexed,numericDropped,numericUniqueIndexReady,recorded,dropped,warnings:[...warnings]};},
    /** Optional explicit schema migration; failure returns false, never throws. May be retried. */
    async initialize():Promise<boolean>{
      if(initializing)return initializing;
      if(initialized&&(!numericFields.length||numericReady))return true;
      if(!locate())return false;
      if(!initializing){initializing=(async()=>{
        const connection=locate();if(!connection)return false;
        try{const result=await connection.createTable({table,ifNotExists:true,columns:[
          {name:'id',type:'varchar',length:36,primary:true},{name:'event_name',type:'varchar',length:96,notNull:true},
          {name:'source',type:'varchar',length:16,notNull:true},{name:'site',type:'varchar',length:200,notNull:true},
          {name:'pathname',type:'text',notNull:true},{name:'session_id',type:'varchar',length:128,notNull:true},
          {name:'occurred_at',type:'bigint',notNull:true},{name:'properties_json',type:'text',notNull:true}
        ]});if(!succeeded(result)){warn('database schema initialization unavailable');return false;}
          initialized=true;
          if(numericFields.length){
            try{
              const schema=await connection.createTable({table:numericTable,ifNotExists:true,columns:[
                {name:'id',type:'varchar',length:140,primary:true},
                {name:'event_id',type:'varchar',length:36,notNull:true},
                {name:'property_name',type:'varchar',length:96,notNull:true},
                {name:'numeric_value',type:'float',notNull:true},
                {name:'event_name',type:'varchar',length:96,notNull:true},
                {name:'source',type:'varchar',length:16,notNull:true},
                {name:'site',type:'varchar',length:200,notNull:true},
                {name:'pathname',type:'text',notNull:true},
                {name:'occurred_at',type:'bigint',notNull:true}
              ]});
              numericReady=schema?.ok===true;
              if(numericReady&&config.indexes!==false&&connection.createIndex){
                // Required for cross-process reconciliation and legacy field-order changes.
                try{const uniq=await connection.createIndex({table:numericTable,name:`${numericTable.slice(0,43)}_event_field_uq`,columns:['event_id','property_name'],unique:true,ifNotExists:true});
                  numericUniqueIndexReady=uniq?.ok===true;
                  if(!numericUniqueIndexReady)warn('numeric event/property uniqueness index unavailable; backfill disabled');
                }catch{numericUniqueIndexReady=false;warn('numeric event/property uniqueness index unavailable; backfill disabled');}
                try{const idx=await connection.createIndex({table:numericTable,name:`${numericTable.slice(0,45)}_field_at`,columns:['property_name','occurred_at'],ifNotExists:true});
                  if(!idx?.ok&&!['1061','ER_DUP_KEYNAME'].includes(String(idx?.error?.code??'')))warn('numeric read index unavailable');
                }catch{warn('numeric read index unavailable');}
              }
              if(numericReady&&config.indexes===false&&config.numericUniqueIndexManagedExternally===true){
                // Operator assertion: the external migration owns uniqueness enforcement.
                numericUniqueIndexReady=true;
              }
              if(!numericReady)warn('numeric fact schema unavailable; core event tracking remains enabled');
            }catch{numericReady=false;warn('numeric fact schema unavailable; core event tracking remains enabled');}
          }
          if(config.indexes!==false&&connection.createIndex){
            const suffix=createHash('sha256').update(table).digest('hex').slice(0,8);
            const base=`${table.slice(0,43)}_${suffix}`;
            indexesReady=true;
            for(const [kind,columns] of [
              ['at',['occurred_at']],['event',['event_name','occurred_at']],['site',['site','occurred_at']]
            ] as const){
              try{
                const response=await connection.createIndex({table,name:`${base}_${kind}`,columns:[...columns],ifNotExists:true});
                if(!response?.ok&&!['1061','ER_DUP_KEYNAME'].includes(String(response?.error?.code??'')))indexesReady=false;
              }catch{indexesReady=false;}
            }
            if(!indexesReady)warn('some analytics read indexes could not be created; collection remains enabled');
          }
          return true;
        }catch{warn('database schema initialization unavailable');return false;}
      })().finally(()=>{initializing=undefined;});}
      return initializing;
    },
    /** Returns the persisted event ID or undefined when disabled/unavailable/invalid. */
    async track(input:AnalyticsEventInput):Promise<string|undefined>{
      if(!enabled)return undefined;
      const connection=locate();if(!connection){dropped++;return undefined;}
      try{
        const filtered=config.filter?await config.filter(input):input;
        if(filtered===null)return undefined;
        const row=validateEvent(filtered);
        const result=await connection.insert({table,values:row as unknown as Record<string,string|number>});
        if(!succeeded(result)){warn('event storage unavailable; event skipped');dropped++;return undefined;}
        recorded++;
        if(numericFields.length){
          const props=JSON.parse(row.properties_json) as Record<string,unknown>;
          const facts=numericFields.flatMap((field)=>typeof props[field]==='number'&&Number.isFinite(props[field])?[{
            id:numericFactId(row.id,field),event_id:row.id,property_name:field,numeric_value:props[field] as number,
            event_name:row.event_name,source:row.source,site:row.site,pathname:row.pathname,occurred_at:row.occurred_at
          }]:[]);
          if(facts.length){
            if(!numericReady){numericDropped+=facts.length;warn('numeric facts not initialized; numeric value skipped');}
            else try{const saved=await connection.insert({table:numericTable,values:facts});
              if(saved?.ok)numericIndexed+=facts.length;
              else{numericDropped+=facts.length;warn('numeric fact storage unavailable; numeric value skipped');}
            }catch{numericDropped+=facts.length;warn('numeric fact storage unavailable; numeric value skipped');}
          }
        }
        return row.id;
      }catch{warn('event storage unavailable or invalid event; event skipped');dropped++;return undefined;}
    },
    /** Exact database-side count aggregations; unlike optional event tracking, failed reporting rejects. */
    async aggregate(query:AnalyticsAggregateQuery){
      const connection=locate();
      if(!connection)throw new Error('Analytics aggregate connector unavailable');
      return aggregateEventCounts(connection,table,query);
    },
    /** Explicit bounded administrator-only backfill. Errors reject, unlike best-effort event collection. */
    async reconcileNumeric(query:NumericReconciliationQuery){
      if(!numericFields.length)throw new Error('Numeric materialization is not configured');
      const connection=locate();
      if(!connection||!numericReady)throw new Error('Numeric reconciliation connector unavailable');
      if(!numericUniqueIndexReady)throw new Error('Numeric reconciliation requires a verified unique event/property index');
      return reconcileNumericFacts(connection,table,numericTable,numericFields,query);
    },
    /** Durable, fenced coordinator. Job IDs identify immutable scan windows and parameters. */
    createReconciliationJob(id:string,query:NumericReconciliationQuery,options?:Pick<NumericReconciliationJobOptions,'leaseMs'|'now'>){
      if(!numericFields.length||!numericReady||!numericUniqueIndexReady)throw new Error('Reconciliation job requires initialized numeric storage with a verified unique index');
      const connection=locate();
      if(!connection?.update)throw new Error('Reconciliation job requires an atomic compare-and-swap database connector');
      const jobTable=`${table.slice(0,46)}_reconcile_jobs`;
      const projectionKey=createHash('sha256').update(JSON.stringify({table,numericTable,numericFields:[...numericFields].sort()})).digest('hex');
      const store=createDatabaseDocumentStore<NumericReconciliationJobDocument>(connection as DocumentConnection,jobTable,id,{version:1,id,projectionKey,pass:1,query:{since:query.since,until:query.until,
        ...(query.site!==undefined?{site:query.site}:{}),batchSize:query.batchSize??100},status:'pending',cursor:null,scanned:0,created:0,
        existing:0,invalidRows:0,expectedFacts:0,pages:0,epoch:0,lease:null,updatedAt:Date.now(),lastError:null});
      return createNumericReconciliationJob({id,query,store,projectionKey,reconcile:(page)=>manager.reconcileNumeric(page),...options});
    },
    /** Computes metrics on committed numeric facts only. Never confuses their coverage with all event history. */
    async aggregateNumeric(query:AnalyticsNumericAggregateQuery){
      if(!numericFields.includes(query.valueField))throw new Error('Numeric property not configured for indexing');
      const connection=locate();
      if(!connection||!numericReady)throw new Error('Numeric analytics connector unavailable');
      return aggregateNumericFacts(connection,numericTable,query);
    },
    async events(query:AnalyticsSummaryQuery={}):Promise<AnalyticsRow[]>{
      const connection=locate();if(!connection)return [];
      try{
        const limit=query.limit??100;
        if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new RangeError('Invalid limit');
        const conditions:Array<{field:string;operator:'eq'|'gte'|'lte';value:string|number}>=[];
        if(query.name)conditions.push({field:'event_name',operator:'eq',value:validateEvent({name:query.name}).event_name});
        if(query.source){if(!['web','email','server','system'].includes(query.source))throw new TypeError('Invalid source');conditions.push({field:'source',operator:'eq',value:query.source});}
        if(query.site!==undefined){if(typeof query.site!=='string'||query.site.length>200||/[\x00-\x1f]/.test(query.site))throw new TypeError('Invalid site');conditions.push({field:'site',operator:'eq',value:query.site});}
        for(const [key,op] of [['since','gte'],['until','lte']] as const){const value=query[key];if(value!==undefined){if(!Number.isSafeInteger(value)||value<0)throw new RangeError('Invalid timestamp');conditions.push({field:'occurred_at',operator:op,value});}}
        const response=await connection.select({table,columns:['id','event_name','source','site','pathname','session_id','occurred_at','properties_json'],...(conditions.length?{where:conditions.length===1?conditions[0]:{and:conditions}}:{}),orderBy:[{by:'occurred_at',direction:'desc'}],limit});
        if(!succeeded(response)){warn('analytics query unavailable');return [];}
        return Array.isArray(response.rows)?response.rows as AnalyticsRow[]:[];
      }catch{warn('analytics query unavailable or invalid');return [];}
    },
    async counts(query:AnalyticsSummaryQuery={}):Promise<Record<string,number>>{
      try{const rows=await manager.events({...query,limit:Math.min(query.limit??500,500)});const counts:Record<string,number>=Object.create(null) as Record<string,number>;
        for(const row of rows)if(typeof row.event_name==='string'&&/^[a-zA-Z][a-zA-Z0-9_.:-]{0,95}$/.test(row.event_name))counts[row.event_name]=(counts[row.event_name]??0)+1;
        return counts;
      }catch{warn('analytics aggregation unavailable');return {};}
    }
  };
  return manager;
}
export type AnalyticsManager=ReturnType<typeof createAnalytics>;
