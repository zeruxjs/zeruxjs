/** Safe, reusable {{path}} interpolation. Registries are application-scoped; no eval or JS expressions. */
export type VariableContext=Readonly<Record<string,unknown>>;
export type VariableResolver=(context:VariableContext)=>unknown|Promise<unknown>;
export type VariableEscape='text'|'html';
export interface VariableRenderOptions {escape?:VariableEscape;missing?:'empty'|'keep'|'error';maxOutput?:number}
const namePattern=/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const forbidden=new Set(['__proto__','constructor','prototype']);
const token=/\{\{\s*([A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*)\s*\}\}/g;
const safeName=(name:string)=>namePattern.test(name)&&!name.split('.').some(part=>forbidden.has(part));
const encodeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
function property(source:unknown,path:string):unknown{
  let current=source;
  for(const segment of path.split('.')){
    if(!current||typeof current!=='object'||!Object.prototype.hasOwnProperty.call(current,segment))return undefined;
    current=(current as Record<string,unknown>)[segment];
  }
  return current;
}
export function createVariableRegistry(){
  const resolvers=new Map<string,VariableResolver>();
  function register(name:string,resolver:VariableResolver){
    if(!safeName(name)||typeof resolver!=='function')throw new TypeError('Invalid variable registration');
    if(resolvers.has(name))throw new Error(`Variable already registered: ${name}`);
    resolvers.set(name,resolver);
    return ()=>{if(resolvers.get(name)===resolver)resolvers.delete(name);};
  }
  /** Render multiple named fields using one per-recipient resolver snapshot. Registered
   * async variables are evaluated once per name even if repeated across fields. */
  async function renderFields<T extends Record<string,string>>(
    fields:T,context:VariableContext={},options:{escape?:Partial<Record<keyof T,VariableEscape>>;missing?:'empty'|'keep'|'error';maxOutput?:number}={}
  ):Promise<T>{
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).length>32)throw new TypeError('Invalid template fields');
    if(!context||typeof context!=='object'||Array.isArray(context))throw new TypeError('Invalid variable context');
    const max=options.maxOutput??2_000_000;
    if(!Number.isSafeInteger(max)||max<1||max>5_000_000)throw new RangeError('Invalid output limit');
    const cached=new Map<string,unknown>();let count=0,total=0;
    const output=Object.create(null) as T;
    for(const [key,template] of Object.entries(fields)){
      if(typeof template!=='string'||template.length>1_000_000)throw new RangeError('Invalid template length');
      let result='',at=0;
      for(const match of template.matchAll(token)){
        if(++count>10_000)throw new RangeError('Too many template variables');
        const name=match[1];if(!safeName(name))throw new TypeError('Forbidden variable name');
        result+=template.slice(at,match.index);
        let value:unknown;
        if(cached.has(name))value=cached.get(name);
        else{
          value=property(context,name);
          if(value===undefined&&resolvers.has(name))value=await resolvers.get(name)!(context);
          cached.set(name,value);
        }
        if(value===undefined){
          if(options.missing==='error')throw new Error(`Missing variable: ${name}`);
          result+=options.missing==='keep'?match[0]:'';
        }else if(value===null){/* explicit empty */}
        else if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'||typeof value==='bigint'){
          const printable=String(value);
          result+=options.escape?.[key as keyof T]==='html'?encodeHtml(printable):printable;
        }else throw new TypeError(`Non-scalar variable: ${name}`);
        if(result.length>max)throw new RangeError('Rendered content too large');
        at=match.index!+match[0].length;
      }
      result+=template.slice(at);
      total+=result.length;
      if(result.length>max||total>max)throw new RangeError('Rendered content too large');
      output[key as keyof T]=result as T[keyof T];
    }
    return output;
  }
  async function render(template:string,context:VariableContext={},options:VariableRenderOptions={}):Promise<string>{
    const result=await renderFields({value:template},context,{escape:{value:options.escape},missing:options.missing,maxOutput:options.maxOutput});
    return result.value;
  }
  /** List the placeholders in a template without running resolvers. */
  function extract(template:string):string[]{
    if(typeof template!=='string'||template.length>1_000_000)throw new RangeError('Invalid template length');
    const matches=[...template.matchAll(token)];if(matches.length>10_000)throw new RangeError('Too many template variables');
    const names=new Set<string>();
    for(const match of matches){if(!safeName(match[1]))throw new TypeError('Forbidden variable name');names.add(match[1]);}
    return [...names];
  }
  return {register,unregister:(name:string)=>resolvers.delete(name),has:(name:string)=>resolvers.has(name),clear:()=>resolvers.clear(),render,renderFields,extract};
}
export type VariableRegistry=ReturnType<typeof createVariableRegistry>;
/** Convenience singleton for code registered in the current server process. Prefer an explicit registry per app/tenant. */
export const variables=createVariableRegistry();
export const registerVariable=variables.register;
export const renderVariables=variables.render;
