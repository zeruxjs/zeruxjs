import type {Asset} from './types.js';
export type PublicationState='draft'|'review'|'published'|'archived';
export interface BrandRules {
 colorTokens?:Record<string,string>;
 logoVariants?:Record<string,string>;
 safeArea?:{unit:'px'|'ratio';top:number;right:number;bottom:number;left:number};
 minimumSize?:{unit:'px';width:number;height:number};
 localeVariants?:Record<string,string>;
 themeVariants?:{light?:string;dark?:string;highContrast?:string};
 developerNotes?:string;
 publication?:PublicationState;
}
function object(value:unknown,keys?:readonly string[],max=64):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new TypeError('Invalid brand object');
 const entries=Reflect.ownKeys(value);if(entries.length>max||entries.some(key=>typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)||(keys&&!keys.includes(key))||!('value' in Object.getOwnPropertyDescriptor(value,key)!)))throw new TypeError('Invalid brand fields');
 return value as Record<string,unknown>;
}
function number(value:unknown,max:number,positive=false):number{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max||positive&&value===0)throw new TypeError('Invalid brand dimension');return value;}
export function validateBrandRules(value:BrandRules,variants:Asset['variants']):BrandRules {
 const input=object(value,['colorTokens','logoVariants','safeArea','minimumSize','localeVariants','themeVariants','developerNotes','publication']);const result:BrandRules={};
 function reference(value:unknown){if(typeof value!=='string'||!variants||!Object.hasOwn(variants,value))throw new TypeError('Unknown brand variant reference');return value;}
 if(input.colorTokens!==undefined){const colors=object(input.colorTokens);result.colorTokens=Object.create(null);for(const [key,color] of Object.entries(colors)){if(!/^[a-z][a-z0-9_-]{0,63}$/.test(key)||typeof color!=='string'||!/^#(?:[a-f0-9]{6}|[a-f0-9]{8})$/i.test(color))throw new TypeError('Brand colors require #RRGGBB or #RRGGBBAA');result.colorTokens![key]=color.toLowerCase();}}
 if(input.logoVariants!==undefined){result.logoVariants=Object.create(null);for(const [name,value] of Object.entries(object(input.logoVariants))){if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name))throw new TypeError('Invalid logo usage');result.logoVariants![name]=reference(value);}}
 if(input.safeArea!==undefined){const area=object(input.safeArea,['unit','top','right','bottom','left']);if(area.unit!=='px'&&area.unit!=='ratio')throw new TypeError('Invalid safe area unit');const max=area.unit==='px'?100000:10;result.safeArea={unit:area.unit,top:number(area.top,max),right:number(area.right,max),bottom:number(area.bottom,max),left:number(area.left,max)};}
 if(input.minimumSize!==undefined){const minimum=object(input.minimumSize,['unit','width','height']);if(minimum.unit!=='px')throw new TypeError('Minimum size requires px');result.minimumSize={unit:'px',width:number(minimum.width,100000,true),height:number(minimum.height,100000,true)};}
 if(input.localeVariants!==undefined){result.localeVariants=Object.create(null);for(const [locale,value] of Object.entries(object(input.localeVariants))){if(locale.length>64)throw new TypeError('Invalid brand locale');let normalized:string;try{normalized=Intl.getCanonicalLocales(locale)[0];}catch{throw new TypeError('Invalid brand locale');}if(Object.hasOwn(result.localeVariants!,normalized))throw new TypeError('Duplicate canonical brand locale');result.localeVariants![normalized]=reference(value);}}
 if(input.themeVariants!==undefined){const themes=object(input.themeVariants,['light','dark','highContrast']);result.themeVariants={};for(const [key,value] of Object.entries(themes))result.themeVariants[key as keyof NonNullable<BrandRules['themeVariants']>]=reference(value);}
 if(input.developerNotes!==undefined){if(typeof input.developerNotes!=='string'||input.developerNotes.length>8192||input.developerNotes.includes('\0'))throw new TypeError('Invalid developer notes');result.developerNotes=input.developerNotes;}
 if(input.publication!==undefined){if(!['draft','review','published','archived'].includes(input.publication as string))throw new TypeError('Invalid publication state');result.publication=input.publication as PublicationState;}
 return result;
}
/** Optional explicit enforcement; dimensions are host measurements, not inferred from binary data. */
export function validateBrandUsage(asset:Asset,usage:{width:number;height:number;clearance?:{top:number;right:number;bottom:number;left:number}}):{code:'MINIMUM_SIZE'|'SAFE_AREA';path:string}[]{
 const rules=asset.brand?validateBrandRules(asset.brand,asset.variants):{};const width=number(usage.width,100000,true),height=number(usage.height,100000,true);const issues:{code:'MINIMUM_SIZE'|'SAFE_AREA';path:string}[]=[];
 if(rules.minimumSize&&(width<rules.minimumSize.width||height<rules.minimumSize.height))issues.push({code:'MINIMUM_SIZE',path:'minimumSize'});
 if(rules.safeArea){const clearance=object(usage.clearance,['top','right','bottom','left']);for(const side of ['top','right','bottom','left'] as const){const actual=number(clearance[side],100000);const required=rules.safeArea[side]*(rules.safeArea.unit==='ratio'?Math.min(width,height):1);if(actual<required)issues.push({code:'SAFE_AREA',path:'safeArea.'+side});}}
 return issues;
}
