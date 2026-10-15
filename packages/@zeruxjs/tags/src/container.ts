import type {TagContainer,TagContainerStore,Scalar,TagGovernance} from './types.js';
const ident=/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
const valid=(name:unknown)=>typeof name==='string'&&ident.test(name);
const label=(s:unknown)=>typeof s==='string'&&s.length>=1&&s.length<=128&&!/[\x00-\x1f]/.test(s);
const scalar=(v:unknown):v is Scalar=>v===null||typeof v==='boolean'||(typeof v==='string'&&v.length<=1024)||(typeof v==='number'&&Number.isFinite(v));
export function validateContainer(data:unknown):TagContainer {
  if(!data||typeof data!=='object'||Array.isArray(data))throw new TypeError('Invalid tag container');
  const c=data as TagContainer;
  if(!valid(c.id)||!Number.isSafeInteger(c.version)||c.version<1||typeof c.name!=='string'||c.name.length>128)throw new TypeError('Invalid container identity');
  if(!Array.isArray(c.triggers)||!Array.isArray(c.tags)||!Array.isArray(c.variables)||c.triggers.length>200||c.tags.length>200||c.variables.length>200)throw new TypeError('Invalid container limits');
  const ids=new Set<string>();
  const register=(id:unknown)=>{if(!valid(id)||ids.has(id as string))throw new TypeError('Invalid or duplicate tag ID');ids.add(id as string);};
  for(const t of c.triggers){register(t.id);if(!label(t.name)||!['event','all','pageview','click','form','history'].includes(t.type)||t.enabled!==undefined&&typeof t.enabled!=='boolean'||t.type==='event'&&!valid(t.event))throw new TypeError('Invalid trigger');
    if(t.conditions!==undefined){if(!Array.isArray(t.conditions)||t.conditions.length>20)throw new TypeError('Too many trigger conditions');for(const cond of t.conditions)if(!valid(cond.field)||!['eq','neq','contains','exists','gte','lte'].includes(cond.operator)||cond.value!==undefined&&!scalar(cond.value))throw new TypeError('Invalid trigger condition');}}
  for(const v of c.variables){register(v.id);if(!label(v.name)||!['constant','event','dataLayer','context'].includes(v.type)||v.key!==undefined&&!valid(v.key)||v.value!==undefined&&!scalar(v.value))throw new TypeError('Invalid variable');}
  for(const t of c.tags){register(t.id);if(!label(t.name)||!['analytics','ga4','webhook'].includes(t.type)||!Array.isArray(t.triggerIds)||!t.triggerIds.length||t.triggerIds.length>40||t.enabled!==undefined&&typeof t.enabled!=='boolean'||t.triggerIds.some(id=>!c.triggers.some(trigger=>trigger.id===id)))throw new TypeError('Invalid tag');
    if(t.eventName!==undefined&&!valid(t.eventName))throw new TypeError('Invalid destination event');
    if(t.type==='ga4'&&(!t.measurementId||!/^G-[A-Z0-9]{5,20}$/.test(t.measurementId)||!valid(t.credentialRef)))throw new TypeError('Invalid GA4 tag');
    if(t.type==='webhook'&&!valid(t.destinationRef))throw new TypeError('Invalid destination reference');
    if(t.clientIdVariable!==undefined&&!c.variables.some(v=>v.id===t.clientIdVariable))throw new TypeError('Unknown client ID variable');
    if(t.parameters!==undefined){if(!t.parameters||Array.isArray(t.parameters)||Object.keys(t.parameters).length>25)throw new TypeError('Invalid parameters');for(const [key,value] of Object.entries(t.parameters)){
      if(!valid(key)||['zRequestId','zRequestUtcDay','__proto__','constructor','prototype'].includes(key)||!scalar(value))throw new TypeError('Invalid parameter');
      if(typeof value==='string'&&(value.includes('{{')||value.includes('}}'))){
        const match=/^\{\{([A-Za-z][A-Za-z0-9_.:-]{0,95})\}\}$/.exec(value);
        if(!match||!c.variables.some(variable=>variable.id===match[1]))throw new TypeError('Unknown or malformed parameter variable');
      }
    }}
  }
  // Strip unrecognized object keys and prototypes, preventing accidental disclosure of secrets.
  const base=JSON.parse(JSON.stringify({id:c.id,version:c.version,name:c.name,triggers:c.triggers.map(({id,name,type,event,conditions,enabled})=>({id,name,type,event,conditions,enabled})),variables:c.variables.map(({id,name,type,key,value})=>({id,name,type,key,value})),tags:c.tags.map(({id,name,type,triggerIds,enabled,eventName,measurementId,credentialRef,destinationRef,clientIdVariable,parameters})=>({id,name,type,triggerIds,enabled,eventName,measurementId,credentialRef,destinationRef,clientIdVariable,parameters}))})) as TagContainer;
  if(c.governance!==undefined){
    const g=c.governance as TagGovernance;
    if(!g||typeof g!=='object'||Array.isArray(g)||!Number.isSafeInteger(g.release)||g.release<1||!Array.isArray(g.history)||g.history.length<1||g.history.length>12)throw new TypeError('Invalid release metadata');
    const snapshot=(raw:TagContainer):TagContainer=>{
      if(!raw||typeof raw!=='object'||Object.hasOwn(raw,'governance'))throw new TypeError('Nested releases are forbidden');
      const value=validateContainer(raw);
      if(value.id!==base.id)throw new TypeError('Cross-container release rejected');
      return value;
    };
    const published=snapshot(g.published),history=g.history.map(entry=>{
      if(!entry||!Number.isSafeInteger(entry.id)||entry.id<1||typeof entry.at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(entry.at)||
        !['initial','publish','rollback'].includes(entry.action))throw new TypeError('Invalid release history');
      return {id:entry.id,at:entry.at,action:entry.action,container:snapshot(entry.container)};
    });
    if(history.some((entry,i)=>i>0&&entry.id<=history[i-1].id)||history.at(-1)?.id!==g.release||
      JSON.stringify(history.at(-1)?.container)!==JSON.stringify(published))throw new TypeError('Incoherent release history');
    base.governance={release:g.release,published,history};
  }
  return base;
}
export function createMemoryTagStore(initial:TagContainer):TagContainerStore{
  let current=validateContainer(initial);
  return {async load(){return structuredClone(current);},async save(next,expected){
    if(expected!==current.version||next.version!==expected+1)return false;
    current=validateContainer(next);return true;
  }};
}
export const emptyTagContainer=(id='default'):TagContainer=>({id,name:'Default',version:1,triggers:[{id:'all_events',name:'All Events',type:'all',enabled:true}],tags:[{id:'internal_analytics',name:'Internal Analytics',type:'analytics',triggerIds:['all_events'],enabled:true}],variables:[]});
