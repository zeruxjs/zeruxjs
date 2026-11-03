import { resolveLimits } from './safety.js';
import type { ZuixLimits } from './safety.js';

/** Extract literal class attributes/directives and cn/clsx/cx/classNames strings.
 * This bounded scanner never evaluates source or resolves dynamic expressions.
 * Helpers own balanced nested calls; parentheses inside quoted CSS values remain literal.
 */
export function extractClasses(source:string,options:{limits?:ZuixLimits}={}):string[] {
 const limits=resolveLimits(options.limits);
 if(typeof source!=='string'||source.length>limits.maxFileBytes||new TextEncoder().encode(source).length>limits.maxFileBytes)
  throw new Error('zuix: scanner maxFileBytes limit exceeded');
 const result=new Set<string>();
 const add=(value:string)=>{
  for(const token of value.split(/\s+/)){
   if(!token||/[<>{}`$]/.test(token))continue;
   if(token.length>limits.maxTokenLength)throw new Error('zuix: scanner maxTokenLength limit exceeded');
   result.add(token);
   if(result.size>limits.maxClasses)throw new Error('zuix: scanner maxClasses limit exceeded');
  }
 };
 const attrs=/(?:\bclass(?:Name)?|\bclass)\s*=\s*(?:["']([^"']*)["']|\{\s*["'`]([^"'`]*?)["'`]\s*\})/g;
 for(const match of source.matchAll(attrs))add(match[1]??match[2]??'');
 for(const match of source.matchAll(/\bclass:([\w:![\]#%./-]+)/g))add(match[1]);
 const helpers=/\b(?:cn|clsx|cx|classNames)\s*\(/g;
 while(helpers.exec(source)!==null){
  const stack=['('],literals:string[]=[];
  let index=helpers.lastIndex,quote='',start=0,comment='';
  for(;index<source.length;index++){
   const ch=source[index],next=source[index+1];
   if(comment==='line'){if(ch==='\n')comment='';continue;}
   if(comment==='block'){if(ch==='*'&&next==='/'){comment='';index++;}continue;}
   if(quote){
    if(ch==='\\'){index++;continue;}
    if(ch===quote){const literal=source.slice(start,index);if(!literal.includes('${'))literals.push(literal);quote='';}
    continue;
   }
   if(ch==='/'&&(next==='/'||next==='*')){comment=next==='/'?'line':'block';index++;continue;}
   if(ch==='"'||ch==="'"||ch==='`'){quote=ch;start=index+1;continue;}
   if(ch==='('||ch==='['||ch==='{'){
    stack.push(ch);if(stack.length>32)throw new Error('zuix: scanner nesting limit exceeded');
   }else if(ch===')'||ch===']'||ch==='}'){
    const expected=ch===')'?'(':ch===']'?'[':'{';
    if(stack.pop()!==expected)break;
    if(!stack.length){for(const literal of literals)add(literal);index++;break;}
   }
  }
  // Nested helpers are scanned in the outer pass, never reparsed quadratically.
  helpers.lastIndex=Math.max(index,helpers.lastIndex);
 }
 return [...result];
}
