export interface PreferenceValues {readonly textScale:1|1.25|1.5|2;readonly contrast:'system'|'light'|'dark'|'high';readonly motion:'system'|'reduce'}
export interface PreferenceSystem {readonly reducedMotion:boolean;readonly forcedColors:boolean}
export interface PreferenceSnapshot {readonly version:2;readonly values:PreferenceValues;readonly system:PreferenceSystem;readonly effective:{readonly reducedMotion:boolean;readonly contrast:PreferenceValues['contrast']|'forced'}}
export interface PreferenceStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export type PreferenceErrorCode='STORAGE_READ'|'STORAGE_WRITE'|'STORAGE_RESET'|'INVALID_SNAPSHOT'|'SUBSCRIBER_FAILED';
export interface PreferenceState {
 getSnapshot():PreferenceSnapshot;
 getStatus():Readonly<{persistence:'disabled'|'ready'|'failed';lastError?:PreferenceErrorCode}>;
 set(values:Partial<PreferenceValues>):void;setSystem(values:Partial<PreferenceSystem>):void;
 reset():void;subscribe(listener:()=>void):()=>void;destroy():void;
}
export const defaultPreferences:PreferenceValues=Object.freeze({textScale:1,contrast:'system',motion:'system'});
function record(value:unknown):Record<string,unknown> {
 if(!value||typeof value!=='object'||![null,Object.prototype].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)throw new TypeError('Invalid preference data');
 const descriptors=Object.getOwnPropertyDescriptors(value);if(Object.keys(descriptors).length>8||Object.values(descriptors).some(item=>!Object.hasOwn(item,'value')))throw new TypeError('Invalid preference properties');
 return Object.fromEntries(Object.entries(descriptors).map(([key,descriptor])=>[key,descriptor.value]));
}
function values(input:unknown,partial=false):PreferenceValues|Partial<PreferenceValues> {
 const data=record(input);if(Object.keys(data).some(key=>!['textScale','contrast','motion'].includes(key))||!partial&&Object.keys(data).length!==3)throw new TypeError('Invalid preference fields');
 if(Object.hasOwn(data,'textScale')&&![1,1.25,1.5,2].includes(data.textScale as number)||Object.hasOwn(data,'contrast')&&!['system','light','dark','high'].includes(data.contrast as string)||Object.hasOwn(data,'motion')&&!['system','reduce'].includes(data.motion as string))throw new TypeError('Invalid preference value');
 return Object.freeze(data) as unknown as PreferenceValues;
}
/** Bounded version migration. V1 is an explicit import schema, not a guess at arbitrary legacy fields. */
export function parsePreferenceSnapshot(text:string):Readonly<{version:2;values:PreferenceValues}> {
 if(typeof text!=='string'||text.length>4096||new TextEncoder().encode(text).length>4096)throw new RangeError('Preference snapshot byte limit exceeded');
 const data=record(JSON.parse(text));let parsed:PreferenceValues;
 if(data.version===2&&Object.keys(data).length===2&&Object.hasOwn(data,'values'))parsed=values(data.values) as PreferenceValues;
 else if(data.version===1&&Object.keys(data).length===2&&Object.hasOwn(data,'preferences')){
  const old=record(data.preferences);
  if(Object.keys(old).length!==3||![100,125,150,200].includes(old.textSize as number)||!['default','high'].includes(old.contrast as string)||typeof old.reducedMotion!=='boolean')throw new TypeError('Invalid V1 preference snapshot');
  if(Object.keys(old).some(key=>!['textSize','contrast','reducedMotion'].includes(key)))throw new TypeError('Invalid V1 preference fields');
  parsed=Object.freeze({textScale:Number(old.textSize)/100,contrast:old.contrast==='high'?'high':'system',motion:old.reducedMotion?'reduce':'system'}) as PreferenceValues;
 }else throw new TypeError('Unsupported preference snapshot');
 return Object.freeze({version:2,values:parsed});
}
export function serializePreferenceSnapshot(input:PreferenceValues):string {const checked=values(input) as PreferenceValues;return JSON.stringify({version:2,values:{textScale:checked.textScale,contrast:checked.contrast,motion:checked.motion}});}
/** Headless per-owner state. No DOM, storage, network or media access unless explicitly injected. */
export function createPreferenceState(options:{initial?:Partial<PreferenceValues>;persistence?:{key:string;storage:PreferenceStorage|(()=>PreferenceStorage)};onError?:(code:PreferenceErrorCode)=>void}={}):PreferenceState {
 const initial=values(options.initial??{},true);let current:PreferenceValues=defaultPreferences,system:PreferenceSystem=Object.freeze({reducedMotion:false,forcedColors:false});
 let storage:PreferenceStorage|undefined,key='',persistence:'disabled'|'ready'|'failed'='disabled',lastError:PreferenceErrorCode|undefined,disposed=false;
 const listeners=new Set<()=>void>();let notifying=false,pending=false;
 let reporting=false;
 const error=(code:PreferenceErrorCode)=>{lastError=code;if(reporting)return;reporting=true;try{options.onError?.(code);}catch{/* Diagnostic callbacks never disable the preference UI. */}finally{reporting=false;}};
 if(options.persistence){
  key=options.persistence.key;if(typeof key!=='string'||!key||key.length>128||/[\u0000-\u001f\u007f]/.test(key))throw new TypeError('Invalid preference storage key');
  try{
   storage=typeof options.persistence.storage==='function'?options.persistence.storage():options.persistence.storage;
   if(!storage||['getItem','setItem','removeItem'].some(name=>typeof (storage as unknown as Record<string,unknown>)[name]!=='function'))throw new TypeError();
   persistence='ready';const stored=storage.getItem(key);
   if(stored!==null){try{current=parsePreferenceSnapshot(stored).values;}catch{persistence='failed';error('INVALID_SNAPSHOT');}}
  }catch{persistence='failed';error('STORAGE_READ');}
 }
 current=Object.freeze({...current,...initial});
 const snapshot=():PreferenceSnapshot=>Object.freeze({version:2,values:current,system,effective:Object.freeze({reducedMotion:system.reducedMotion||current.motion==='reduce',contrast:system.forcedColors?'forced':current.contrast})});
 let view=snapshot();
 const assertLive=()=>{if(disposed)throw new Error('Preference state destroyed');};
 const emit=()=>{
  if(current.textScale!==view.values.textScale||current.contrast!==view.values.contrast||current.motion!==view.values.motion||system.reducedMotion!==view.system.reducedMotion||system.forcedColors!==view.system.forcedColors)view=snapshot();pending=true;if(notifying)return;notifying=true;
  try{let cycles=0;while(pending){if(++cycles>32){pending=false;error('SUBSCRIBER_FAILED');break;}pending=false;for(const listener of [...listeners])if(listeners.has(listener))try{listener();}catch{error('SUBSCRIBER_FAILED');}}}finally{notifying=false;}
 };
 return {
  getSnapshot(){assertLive();return view;},getStatus(){assertLive();return Object.freeze({persistence,...(lastError?{lastError}:{})});},
  set(input){assertLive();const checked=values(input,true),next=Object.freeze({...current,...checked});if(JSON.stringify(next)===JSON.stringify(current))return;current=next;
   if(storage)try{storage.setItem(key,serializePreferenceSnapshot(current));persistence='ready';}catch{persistence='failed';error('STORAGE_WRITE');}emit();
  },
  setSystem(input){assertLive();const data=record(input);if(Object.keys(data).some(key=>!['reducedMotion','forcedColors'].includes(key))||Object.values(data).some(value=>typeof value!=='boolean'))throw new TypeError('Invalid system preference');
   const next=Object.freeze({...system,...data}) as PreferenceSystem;if(next.reducedMotion===system.reducedMotion&&next.forcedColors===system.forcedColors)return;system=next;emit();
  },
  reset(){assertLive();current=defaultPreferences;if(storage)try{storage.removeItem(key);persistence='ready';}catch{persistence='failed';error('STORAGE_RESET');}emit();},
  subscribe(listener){assertLive();if(typeof listener!=='function'||listeners.size>=128)throw new TypeError('Invalid or excessive preference subscribers');listeners.add(listener);return()=>{listeners.delete(listener);};},
  destroy(){if(disposed)return;disposed=true;listeners.clear();pending=false;storage=undefined;},
 };
}
