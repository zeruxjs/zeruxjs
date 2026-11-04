import {validateContainer} from './container.js';
import {validateTagProviders,type TagProviderRegistry,inertTagJson} from './providers.js';
import type {TagContainer} from './types.js';
/** Definition-only transfer: governance/releases remain server-owned. */
export function exportTagDefinition(container:TagContainer,registry?:TagProviderRegistry):string {
 const {governance:_private,...definition}=validateContainer(container);validateTagProviders(definition,registry);const value={format:'zerux-tags',schemaVersion:1,container:definition};inertTagJson(value,58000);return JSON.stringify(value);
}
export function importTagDefinition(text:string,registry?:TagProviderRegistry):TagContainer {
 if(typeof text!=='string'||Buffer.byteLength(text)>58000)throw new RangeError('Tag import byte limit');const input=JSON.parse(text);inertTagJson(input,58000);if(!input||Object.keys(input).some(k=>!['format','schemaVersion','container'].includes(k))||input.format!=='zerux-tags'||input.schemaVersion!==1||!input.container||Object.hasOwn(input.container,'governance'))throw new TypeError('Unsupported tag import');const keys=(value:object,allowed:string[])=>{if(!value||Object.keys(value).some(k=>!allowed.includes(k)))throw new TypeError('Unknown imported field');};keys(input.container,['id','version','name','triggers','tags','variables']);for(const t of input.container.tags??[])keys(t,['id','name','type','triggerIds','enabled','eventName','measurementId','credentialRef','destinationRef','clientIdVariable','parameters','providerRef','providerVersion','publicConfig']);for(const v of input.container.variables??[])keys(v,['id','name','type','key','value','schemaVersion']);for(const t of input.container.triggers??[])keys(t,['id','name','type','event','conditions','enabled','schemaVersion','composition']);const container=validateContainer(input.container);validateTagProviders(container,registry);return container;
}
