/** Extract literal utility tokens from HTML, JSX, TSX, Vue, Svelte, and Zyro template sources. */
export function extractClasses(source:string):string[] {
 const result=new Set<string>();
 const add=(value:string)=>{for(const token of value.split(/\s+/))if(token&&!/[<>{}`$]/.test(token))result.add(token);};
 // Attribute literals, including className/class and class directives.
 const attrs=/(?:\bclass(?:Name)?|\bclass)\s*=\s*(?:["']([^"']*)["']|\{\s*["'`]([^"'`]*?)["'`]\s*\})/g;
 for(const match of source.matchAll(attrs))add(match[1]??match[2]??'');
 for(const match of source.matchAll(/\bclass:([\w:!\[\]#%./-]+)/g))add(match[1]);
 // String values in class composition helpers, including cn, clsx, cx, and classNames.
 for(const match of source.matchAll(/\b(?:cn|clsx|cx|classNames)\s*\(([\s\S]*?)\)/g)){
  for(const literal of match[1].matchAll(/["'`]([^"'`]+)["'`]/g))add(literal[1]);
 }
 return [...result];
}
