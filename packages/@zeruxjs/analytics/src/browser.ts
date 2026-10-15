/** Optional browser-facing event client; no cookies or automatic identifiers. */
export function createEventClient(options:{endpoint:string;fetch?:typeof fetch;timeoutMs?:number;enabled?:boolean;onWarning?:(message:string)=>void}){
  const endpoint=new URL(options.endpoint);
  if(!['https:','http:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw new TypeError('Invalid analytics endpoint');
  const fetcher=options.fetch??fetch,timeout=options.timeoutMs??5000;
  if(!Number.isSafeInteger(timeout)||timeout<100||timeout>60000)throw new RangeError('Invalid analytics timeout');
  let enabled=options.enabled!==false,warningSent=false;
  return {
    setEnabled(value:boolean){enabled=value===true;},
    async track(name:string,properties:Record<string,string|number|boolean|null>={},options2:{signal?:AbortSignal;site?:string;pathname?:string}={}):Promise<boolean>{
      if(!enabled)return false;
      try{
        const signal=AbortSignal.any([AbortSignal.timeout(timeout),...(options2.signal?[options2.signal]:[])]);
        const response=await fetcher(endpoint.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,properties,site:options2.site,pathname:options2.pathname,source:'web'}),signal,credentials:'omit',cache:'no-store'});
        if(response.ok)return true;
      }catch{/* network loss and aborts are expected for best-effort telemetry */}
      if(!warningSent){warningSent=true;try{(options.onWarning??console.warn)('[analytics] Browser event delivery unavailable; skipped');}catch{}}
      return false;
    }
  };
}
