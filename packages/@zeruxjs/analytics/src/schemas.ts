import {createHash} from 'node:crypto';
import type {AnalyticsEventInput,AnalyticsRow,EventProperties,EventValue} from './types.js';

export type AnalyticsMeasurementUnit='count'|'milliseconds'|'seconds'|'bytes'|'ratio'|'percent';
export type AnalyticsPropertyDefinition = {
  required?:boolean;
} & ({kind:'dimension';type:'string'|'number'|'boolean';values:readonly (string|number|boolean)[];maxCardinality:number}
  |{kind:'metric';unit:AnalyticsMeasurementUnit;min?:number;max?:number}
  |{kind:'parameter';type:'number'|'boolean'|'null'});
export interface AnalyticsEventSchema {
  name:string;version:number;
  properties:Readonly<Record<string,AnalyticsPropertyDefinition>>;
  userProperties?:Readonly<Record<string,AnalyticsPropertyDefinition>>;
  sessionProperties?:Readonly<Record<string,AnalyticsPropertyDefinition>>;
}
export interface AnalyticsSchemaBudgets {maxProperties?:number;maxBytes?:number}
type Value<D> = D extends {kind:'metric'}?number:D extends {kind:'dimension';values:readonly (infer V)[]}?V:D extends {type:'number'}?number:D extends {type:'boolean'}?boolean:null;
export type InferAnalyticsProperties<S extends Readonly<Record<string,AnalyticsPropertyDefinition>>> = {
  [K in keyof S as S[K] extends {required:true}?K:never]:Value<S[K]>
} & {[K in keyof S as S[K] extends {required:true}?never:K]?:Value<S[K]>};
type Properties<S,K extends 'properties'|'userProperties'|'sessionProperties'> = S extends {[P in K]:infer R extends Readonly<Record<string,AnalyticsPropertyDefinition>>}?InferAnalyticsProperties<R>:Record<string,never>;
export type AnalyticsSchemaInput<S> = Omit<AnalyticsEventInput,'name'|'properties'|'schemaVersion'|'userProperties'|'sessionProperties'> & {
  properties:Properties<S,'properties'>;userProperties?:Properties<S,'userProperties'>;sessionProperties?:Properties<S,'sessionProperties'>;
};
export class AnalyticsSchemaError extends TypeError {
  constructor(readonly code:string){super(`Analytics schema rejected (${code})`);this.name='AnalyticsSchemaError';}
}
const reject=(code:string):never=>{throw new AnalyticsSchemaError(code);};
const registries=new WeakSet<object>();
/** Accept only validated catalogs produced by this package instance. */
export const isEventSchemaRegistry=(value:unknown):value is AnalyticsEventSchemaRegistry=>typeof value==='object'&&value!==null&&registries.has(value);
const scopes=['properties','userProperties','sessionProperties'] as const;
const namePattern=/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
const reserved=new Set(['constructor','prototype','__proto__','zVisitorId','zConsent','zRequestId','zRequestUtcDay','zAnalyticsSchema']);
const sensitive=/(?:^|[_.:-])(?:email|ip|password|secret|token|cookie|address|phone|authorization)(?:$|[_.:-])/i;
function record(value:unknown):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!('value'in Object.getOwnPropertyDescriptor(value,key)!)))reject('INVALID_RECORD');
}
function keys(value:Record<string,unknown>,allowed:readonly string[]){if(Object.keys(value).some(key=>!allowed.includes(key)))reject('UNKNOWN_DEFINITION_KEY');}
function integer(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)reject('INVALID_BUDGET');return value as number;}
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(key=>(value as Record<string,unknown>)[key]!==undefined).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';return JSON.stringify(value);}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value));
function property(value:unknown):AnalyticsPropertyDefinition {
  record(value);if(value.required!==undefined&&typeof value.required!=='boolean')reject('INVALID_REQUIRED');
  if(value.kind==='dimension'){
    keys(value,['kind','type','values','maxCardinality','required']);const max=integer(value.maxCardinality,1,256);
    if(!['string','number','boolean'].includes(value.type as string)||!Array.isArray(value.values)||!value.values.length||value.values.length>max)reject('DIMENSION_CARDINALITY');
    if(Object.values(Object.getOwnPropertyDescriptors(value.values)).some(d=>!('value'in d)))reject('INVALID_DIMENSION_VALUE');
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    for(const item of value.values as unknown[]){if(typeof item!==value.type||typeof item==='number'&&!finite(item)||typeof item==='string'&&(!item.length||Buffer.byteLength(item)>128||/[\x00-\x1f\x7f@]/.test(item)))reject('INVALID_DIMENSION_VALUE');}
    if(new Set((value.values as unknown[]).map(canonical)).size!==(value.values as unknown[]).length)reject('DUPLICATE_DIMENSION_VALUE');
  }else if(value.kind==='metric'){
    keys(value,['kind','unit','min','max','required']);if(!['count','milliseconds','seconds','bytes','ratio','percent'].includes(value.unit as string))reject('INVALID_UNIT');
    for(const key of ['min','max'])if(value[key]!==undefined&&(typeof value[key]!=='number'||!Number.isFinite(value[key])))reject('INVALID_METRIC_RANGE');
    if(typeof value.min==='number'&&typeof value.max==='number'&&value.min>value.max)reject('INVALID_METRIC_RANGE');
  }else if(value.kind==='parameter'){
    keys(value,['kind','type','required']);if(!['number','boolean','null'].includes(value.type as string))reject('INVALID_PARAMETER_TYPE');
  }else reject('INVALID_PROPERTY_KIND');
  return JSON.parse(canonical(value)) as AnalyticsPropertyDefinition;
}
function group(value:unknown):Record<string,AnalyticsPropertyDefinition>{
  record(value);if(Object.keys(value).length>40)reject('PROPERTY_BUDGET');const result:Record<string,AnalyticsPropertyDefinition>=Object.create(null);
  for(const key of Object.keys(value).sort()){if(!namePattern.test(key)||reserved.has(key)||sensitive.test(key))reject('INVALID_PROPERTY_NAME');result[key]=property(value[key]);}return result;
}
function compatible(previous:AnalyticsEventSchema,next:AnalyticsEventSchema){
  for(const scope of scopes){const before=previous[scope]??{},after=next[scope]??{};
    for(const [key,spec] of Object.entries(before))if(!Object.hasOwn(after,key)||canonical(spec)!==canonical(after[key]))reject('BREAKING_SCHEMA_EVOLUTION');
    for(const [key,spec] of Object.entries(after))if(!Object.hasOwn(before,key)&&spec.required)reject('BREAKING_SCHEMA_EVOLUTION');
  }
}
/** Immutable generation-scoped catalog. String dimensions are finite; free text is deliberately unavailable. */
export function createEventSchemaRegistry<const T extends readonly AnalyticsEventSchema[]>(definitions:T,budgets:AnalyticsSchemaBudgets={}){
  record(budgets);keys(budgets,['maxProperties','maxBytes']);const maxProperties=integer(budgets.maxProperties??40,1,40),maxBytes=integer(budgets.maxBytes??6144,128,7168);
  if(!Array.isArray(definitions)||!definitions.length||definitions.length>100)reject('SCHEMA_BUDGET');
  const catalog:AnalyticsEventSchema[]=[],byName=new Map<string,AnalyticsEventSchema[]>();
  for(const raw of definitions){record(raw);keys(raw,['name','version',...scopes]);if(typeof raw.name!=='string'||!namePattern.test(raw.name)||reserved.has(raw.name))reject('INVALID_EVENT_NAME');
    const schema:AnalyticsEventSchema={name:raw.name,version:integer(raw.version,1,10000),properties:group(raw.properties),...(raw.userProperties!==undefined?{userProperties:group(raw.userProperties)}:{}),...(raw.sessionProperties!==undefined?{sessionProperties:group(raw.sessionProperties)}:{})};
    if(scopes.reduce((n,scope)=>n+Object.keys(schema[scope]??{}).length,0)>maxProperties)reject('PROPERTY_BUDGET');
    catalog.push(schema);const versions=byName.get(schema.name)??[];versions.push(schema);byName.set(schema.name,versions);
  }
  for(const versions of byName.values()){versions.sort((a,b)=>a.version-b.version);for(let i=0;i<versions.length;i++){if(versions[i]!.version!==i+1)reject('NONCONTIGUOUS_VERSION');if(i)compatible(versions[i-1]!,versions[i]!);}}
  if(catalog.reduce((count,schema)=>count+scopes.reduce((total,scope)=>total+Object.values(schema[scope]??{}).reduce((n,p)=>n+(p.kind==='dimension'?p.values.length:0),0),0),0)>4096||Buffer.byteLength(canonical(catalog))>1048576)reject('CATALOG_BUDGET');
  catalog.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:a.version-b.version);freeze(catalog);
  const catalogId=createHash('sha256').update(canonical({catalog,maxProperties,maxBytes})).digest('hex');
  const schemaIds=new Map(catalog.map(schema=>[schema,createHash('sha256').update(canonical(schema)).digest('hex')]));
  const resolve=(name:string,version?:number)=>{const versions=byName.get(name);if(!versions)reject('UNREGISTERED_EVENT');if(version!==undefined)integer(version,1,10000);const schema=version===undefined?versions![versions!.length-1]:versions!.find(s=>s.version===version);if(!schema)reject('UNKNOWN_SCHEMA_VERSION');return schema!;};
  const prepare=(input:AnalyticsEventInput)=>{
    record(input);const schema=resolve(input.name,input.schemaVersion),clean:Record<string,EventProperties>=Object.create(null);let count=0;
    for(const scope of scopes){const raw=input[scope]??{};record(raw);const spec=schema[scope]??{},output:EventProperties=Object.create(null);
      if(scope!=='properties'&&Object.keys(raw).length&&(input.consent!=='granted'||!(scope==='userProperties'?input.visitorId:input.sessionId)))reject('PROPERTY_CONSENT_REQUIRED');
      for(const [key,value] of Object.entries(raw)){
        if(++count>maxProperties)reject('PROPERTY_BUDGET');if(!Object.hasOwn(spec,key))reject('UNKNOWN_PROPERTY');const rule=spec[key]!;
        if(rule.kind==='dimension'){if(!rule.values.includes(value as never))reject('DIMENSION_CARDINALITY');}
        else if(rule.kind==='metric'){if(!finite(value)||typeof value!=='number'||(['count','bytes'].includes(rule.unit)&&(!Number.isSafeInteger(value)||value<0))||(rule.unit==='ratio'&&(value<0||value>1))||(rule.unit==='percent'&&(value<0||value>100))||rule.min!==undefined&&value<rule.min||rule.max!==undefined&&value>rule.max)reject('INVALID_METRIC');}
        else if((value===null?'null':typeof value)!==rule.type||typeof value==='number'&&!finite(value))reject('INVALID_PARAMETER');
        output[key]=value as EventValue;
      }
      for(const [key,rule] of Object.entries(spec))if(rule.required&&!Object.hasOwn(output,key))reject('MISSING_PROPERTY');clean[scope]=output;
    }
    if(Buffer.byteLength(JSON.stringify(clean))>maxBytes)reject('PROPERTY_BYTE_BUDGET');
    const schemaId=schemaIds.get(schema)!;
    return {properties:clean.properties!,metadata:{coverageVersion:1 as const,schemaVersion:schema.version,schemaId,catalogId,userProperties:clean.userProperties!,sessionProperties:clean.sessionProperties!}};
  };
  const registry=Object.freeze({
    describe:()=>Object.freeze({coverageVersion:1 as const,catalogId,maxProperties,maxBytes,schemas:catalog}),prepare,
    /** Type-check authored events; runtime validation also runs again at ingestion. */
    event<N extends T[number]['name']>(name:N,input:AnalyticsSchemaInput<Extract<T[number],{name:N}>>):AnalyticsEventInput {const result={...input,name,schemaVersion:resolve(name).version} as unknown as AnalyticsEventInput;prepare(result);return result;},
    metric(field:string,name?:string){const definitions=catalog.filter(s=>name===undefined||s.name===name).map(s=>s.properties[field]).filter(Boolean);if(!definitions.length||definitions.some(d=>d!.kind!=='metric'))reject('UNREGISTERED_METRIC');const units=new Set(definitions.map(d=>(d as {unit:AnalyticsMeasurementUnit}).unit));if(units.size!==1)reject('AMBIGUOUS_METRIC_UNIT');return {unit:[...units][0]!,coverageVersion:1 as const,coverage:'mixed-history' as const};}
  });
  registries.add(registry);return registry;
}
export type AnalyticsEventSchemaRegistry=ReturnType<typeof createEventSchemaRegistry>;
/** Metadata is provenance, never proof that historical rows contain a newly introduced property. */
export function readEventSchemaCoverage(row:Pick<AnalyticsRow,'properties_json'>){
  if(typeof row?.properties_json!=='string'||Buffer.byteLength(row.properties_json)>8192)reject('INVALID_STORED_PROPERTIES');
  let props:Record<string,unknown>;try{props=JSON.parse(row.properties_json) as Record<string,unknown>;record(props);}catch{reject('INVALID_STORED_PROPERTIES');}
  const metadata=Object.hasOwn(props!,'zAnalyticsSchema')?props!.zAnalyticsSchema:undefined;
  if(metadata===undefined)return {coverageVersion:1 as const,coverage:'legacy-unversioned' as const};record(metadata);
  if(metadata.coverageVersion!==1||typeof metadata.schemaVersion!=='number'||!Number.isSafeInteger(metadata.schemaVersion)||metadata.schemaVersion<1||metadata.schemaVersion>10000||typeof metadata.schemaId!=='string'||!/^[a-f0-9]{64}$/.test(metadata.schemaId)||typeof metadata.catalogId!=='string'||!/^[a-f0-9]{64}$/.test(metadata.catalogId))reject('INVALID_STORED_SCHEMA');
  return {coverageVersion:1 as const,coverage:'versioned' as const,schemaVersion:metadata.schemaVersion,schemaId:metadata.schemaId,catalogId:metadata.catalogId};
}
