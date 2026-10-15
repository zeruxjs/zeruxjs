export interface LighthouseSummary {
 url:string;
 categories:Record<string,{score:number|null;title:string}>;
 metrics:Record<string,{value:number|null;displayValue?:string}>;
}
export interface LighthouseOptions { port?:number; runner?:(url:string,options:Record<string,unknown>)=>Promise<unknown> }
/** Audits against an already-running Chrome remote-debugging port. Never spawns a browser or shell. */
export async function auditLighthouse(input:string,options:LighthouseOptions={}):Promise<LighthouseSummary>{
 const url=new URL(input);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new TypeError('Lighthouse URL must be HTTP(S) without credentials');
 if(options.port!==undefined&&(!Number.isInteger(options.port)||options.port<1||options.port>65535))throw new RangeError('Invalid Chrome debugging port');
 const runner=options.runner??(async(url:string,opts:Record<string,unknown>)=>{
  const specifier='lighthouse';const imported=await import(specifier);return (imported.default as (url:string,options:Record<string,unknown>)=>Promise<unknown>)(url,opts);
 });
 const result=await runner(url.href,{port:options.port??9222,output:'json'});
 const lhr=(result as {lhr?:unknown}|null)?.lhr as {categories?:Record<string,{score?:number|null;title?:string}>;audits?:Record<string,{numericValue?:number;displayValue?:string}>}|undefined;
 if(!lhr)throw new Error('Lighthouse returned no audit report');
 const categories: LighthouseSummary['categories']=Object.create(null);
 for(const [name,item] of Object.entries(lhr.categories??{}))categories[name]={score:typeof item.score==='number'&&Number.isFinite(item.score)?item.score:null,title:item.title??name};
 const metrics:LighthouseSummary['metrics']=Object.create(null);
 for(const name of ['first-contentful-paint','largest-contentful-paint','speed-index','total-blocking-time','cumulative-layout-shift','interactive']){
  const value=lhr.audits?.[name];if(value)metrics[name]={value:typeof value.numericValue==='number'&&Number.isFinite(value.numericValue)?value.numericValue:null,displayValue:value.displayValue};
 }
 return{url:url.href,categories,metrics};
}
