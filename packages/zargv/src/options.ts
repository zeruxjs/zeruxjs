import type {ParsedArgs} from './args.js';
export type OptionType = 'boolean'|'string'|'number';
export interface OptionDefinition { type:OptionType; required?:boolean; default?: string|number|boolean; description?:string; choices?:readonly string[]; alias?:string }
export type OptionSchema = Record<string,OptionDefinition>;
export type ValidatedOptions = Record<string,string|number|boolean|Array<string|number|boolean>>;
/** Optional strict validation layer; legacy parsedArgs stay string/boolean for compatibility. */
export function validateOptions(args:ParsedArgs,schema:OptionSchema,allowUnknown=false):ValidatedOptions {
 const result:ValidatedOptions=Object.create(null);
 const aliases=new Map<string,string>();
 for(const [name,definition] of Object.entries(schema)) {
  if(!/^[a-z][\w-]*$/i.test(name)||['constructor','__proto__','prototype'].includes(name))throw new TypeError(`Invalid schema option: ${name}`);
  if(definition.alias){if(aliases.has(definition.alias)||schema[definition.alias])throw new TypeError(`Duplicate alias ${definition.alias}`);aliases.set(definition.alias,name);}
 }
 for(const [key,raw] of Object.entries(args.namedArgs)) {
  const name=aliases.get(key)??key, definition=schema[name];
  if(!definition){if(!allowUnknown)throw new TypeError(`Unknown option: --${key}`);result[key]=raw;continue;}
  if(Object.hasOwn(result,name))throw new TypeError(`Duplicate option: --${name}`);
  const convert=(value:string|boolean):string|number|boolean=>{
   if(definition.type==='boolean') {if(value===true||value==='true')return true;if(value==='false')return false;throw new TypeError(`Invalid boolean for --${name}`);}
   if(typeof value!=='string')throw new TypeError(`Missing value for --${name}`);
   if(definition.type==='number') {const v=Number(value);if(!value.trim()||!Number.isFinite(v))throw new TypeError(`Invalid number for --${name}`);return v;}
   if(definition.choices&&!definition.choices.includes(value))throw new TypeError(`Invalid value for --${name}`);
   return value;
  };
  result[name]=Array.isArray(raw)?raw.map(item=>convert(item)):convert(raw);
 }
 for(const [key,definition] of Object.entries(schema)){
  if(!Object.hasOwn(result,key)){
   if(definition.required)throw new TypeError(`Required option: --${key}`);
   if(definition.default!==undefined)result[key]=definition.default;
  }
 }
 return result;
}
