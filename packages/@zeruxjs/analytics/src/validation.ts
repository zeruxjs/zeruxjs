import type {AnalyticsEventInput,AnalyticsRow,EventProperties} from './types.js';
import {randomUUID} from 'node:crypto';
import {validRequestId} from './request-id.js';
const ident=/^[a-z][a-z0-9_]{0,62}$/;
const eventName=/^[a-zA-Z][a-zA-Z0-9_.:-]{0,95}$/;
export function validateTableName(name:string):string {if(!ident.test(name))throw new TypeError('Invalid analytics table');return name;}
export function validateEvent(input:AnalyticsEventInput):AnalyticsRow {
  if(!input||typeof input!=='object'||!eventName.test(input.name))throw new TypeError('Invalid event name');
  const allowed=['web','server','email','system'];
  if(input.source!==undefined&&!allowed.includes(input.source))throw new TypeError('Invalid event source');
  const props=input.properties??{};
  if(!props||typeof props!=='object'||Array.isArray(props)||Object.keys(props).length>40)throw new TypeError('Invalid event properties');
  const clean:EventProperties=Object.create(null) as EventProperties;
  for(const [key,value] of Object.entries(props)){
    if(!eventName.test(key)||key==='__proto__'||key==='constructor'||key==='prototype')throw new TypeError('Invalid property key');
    if(value!==null&&typeof value!=='string'&&typeof value!=='boolean'&&typeof value!=='number')throw new TypeError('Event values must be scalar');
    if(typeof value==='number'&&!Number.isFinite(value))throw new TypeError('Invalid numeric event value');
    if(typeof value==='string'&&value.length>1024)throw new RangeError('Event property too long');
    clean[key]=value;
  }
  if(input.requestId!==undefined){
    if(!validRequestId(input.requestId)||!/^\d{4}-\d{2}-\d{2}$/.test(input.requestUtcDay??''))throw new TypeError('Invalid request correlation');
    if(Object.hasOwn(clean,'zRequestId')||Object.hasOwn(clean,'zRequestUtcDay'))throw new TypeError('Reserved request property');
    clean.zRequestId=input.requestId;clean.zRequestUtcDay=input.requestUtcDay!;
  }
  const properties_json=JSON.stringify(clean);
  if(Buffer.byteLength(properties_json)>8192)throw new RangeError('Event properties exceed limit');
  const string=(v:unknown,max:number)=>{if(v===undefined)return '';if(typeof v!=='string'||v.length>max||/[\x00-\x1f]/.test(v))throw new TypeError('Invalid analytics field');return v;};
  const at=input.occurredAt??Date.now();
  if(!Number.isSafeInteger(at)||at<Date.now()-30*86_400_000||at>Date.now()+5*60_000)throw new RangeError('Event timestamp outside accepted window');
  return {id:randomUUID(),event_name:input.name,source:input.source??'server',site:string(input.site,200),pathname:string(input.pathname,2048),session_id:string(input.sessionId,128),occurred_at:at,properties_json};
}
