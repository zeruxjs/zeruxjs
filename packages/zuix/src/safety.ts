/** CSS from utility tokens is deliberately a restricted subset, not arbitrary authored CSS.
 * Plugins and addBase() remain trusted application code. */
export const DEFAULT_LIMITS = Object.freeze({maxFiles:20000,maxFileBytes:1024*1024,maxTotalBytes:64*1024*1024,maxClasses:50000,maxTokenLength:256});
export type ZuixLimits = Partial<typeof DEFAULT_LIMITS>;
export function resolveLimits(input:ZuixLimits={}):Record<keyof typeof DEFAULT_LIMITS,number> {
 const result:Record<keyof typeof DEFAULT_LIMITS,number>={...DEFAULT_LIMITS};
 for(const key of Object.keys(result) as (keyof typeof DEFAULT_LIMITS)[]){
  const value=input[key];
  if(value!==undefined){if(!Number.isSafeInteger(value)||value<1||value>DEFAULT_LIMITS[key]*16)throw new Error(`zuix: invalid ${key} limit`);result[key]=value;}
 }
 return result;
}
export function safeCssValue(value:string):boolean {
 if(!value||value.length>512||/[\u0000-\u001f\u007f{};<>\\"'`]/.test(value)||/\/\*|\*\/|!\s*important|@(?:import|charset)|\b(?:url|image-set|expression|behavior)\s*\(/i.test(value))return false;
 // Parentheses must balance. Disallow closing out of the active declaration.
 let depth=0;
 for(const c of value){if(c==='('){if(++depth>8)return false;}else if(c===')'&&--depth<0)return false;}
 return depth===0;
}
export function safeDeclaration(property:string,value:string):boolean {
 return /^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/i.test(property)&&property.length<=100&&safeCssValue(value);
}
export function safeCondition(value:string):boolean {
 return value.length>0&&value.length<=160&&/^[a-zA-Z0-9\s:.,#%()\[\]_<>=!+-]+$/.test(value)&&!/(?:url|expression)\s*\(/i.test(value);
}
export function cssEscapeClass(name:string):string {
 return [...name].map((c,i)=>{
  if((i===0&&/[0-9]/.test(c))||(i===1&&name[0]==='-'&&/[0-9]/.test(c)))return `\\${c.codePointAt(0)!.toString(16)} `;
  return /[a-zA-Z0-9_-]/.test(c)?c:`\\${c.codePointAt(0)!.toString(16)} `;
 }).join('');
}
