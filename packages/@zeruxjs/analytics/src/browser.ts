/** Generates a cryptographically random, opaque token; only call after obtaining consent.
 * Never reads cookies, localStorage, IP addresses or browser fingerprints. The caller owns persistence.
 */
export function createAnonymousAnalyticsId():string{
  if(!globalThis.crypto?.getRandomValues)throw new Error('Secure random identity generator unavailable');
  const bytes=new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** Optional browser-facing event client. No cookies, fingerprinting or automatically assigned identifiers. */
export function createEventClient(options:{
  endpoint:string;fetch?:typeof fetch;timeoutMs?:number;enabled?:boolean;onWarning?:(message:string)=>void;
  /** Opt in explicitly before sending identity-bearing events. */
  consent?:'granted'|'denied'|'unknown';requireConsent?:boolean;
}){
  const endpoint=new URL(options.endpoint);
  if(!['https:','http:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw new TypeError('Invalid analytics endpoint');
  const fetcher=options.fetch??fetch,timeout=options.timeoutMs??5000;
  if(!Number.isSafeInteger(timeout)||timeout<100||timeout>60000)throw new RangeError('Invalid analytics timeout');
  let enabled=options.enabled!==false,warningSent=false,consent=options.consent??'unknown';
  if(!['granted','denied','unknown'].includes(consent))throw new TypeError('Invalid analytics consent');
  return {
    setEnabled(value:boolean){enabled=value===true;},
    setConsent(value:'granted'|'denied'|'unknown'){
      if(!['granted','denied','unknown'].includes(value))throw new TypeError('Invalid analytics consent');
      consent=value;
    },
    /** Success means the endpoint accepted the request, NOT a durable database commit. */
    async track(name:string,properties:Record<string,string|number|boolean|null>={},options2:{
      signal?:AbortSignal;site?:string;pathname?:string;sessionId?:string;visitorId?:string
    }={}):Promise<boolean>{
      if(!enabled||consent==='denied'||(options.requireConsent&&consent!=='granted'))return false;
      try{
        // No local identifiers leak before explicit opt-in; invalid events fail without a network call.
        if((options2.sessionId||options2.visitorId)&&consent!=='granted')return false;
        if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(name)||!properties||
          typeof properties!=='object'||Array.isArray(properties)||Object.keys(properties).length>40)return false;
        const body=JSON.stringify({name,properties,site:options2.site,pathname:options2.pathname,source:'web',
          consent,...(consent==='granted'?{sessionId:options2.sessionId,visitorId:options2.visitorId}:{})});
        if(new TextEncoder().encode(body).byteLength>8192)return false;
        const signal=AbortSignal.any([AbortSignal.timeout(timeout),...(options2.signal?[options2.signal]:[])]);
        const response=await fetcher(endpoint.href,{method:'POST',headers:{'content-type':'application/json'},body,signal,credentials:'omit',cache:'no-store'});
        if(response.ok)return true;
      }catch{/* Network loss and aborts are expected for best-effort telemetry. */}
      if(!warningSent){warningSent=true;try{(options.onWarning??console.warn)('[analytics] Browser event delivery unavailable; skipped');}catch{}}
      return false;
    }
  };
}
