/** Fixed public messages; native module/render causes remain available only to the trusted host. */
export class ReactAdapterError extends Error {
 constructor(readonly code:string,cause?:unknown){super(`React adapter: ${code}`,{cause});this.name='ReactAdapterError'}
}
export function checkReactAbort(signal?:AbortSignal):void{
 if(signal!==undefined&&!(signal instanceof AbortSignal))throw new ReactAdapterError('INVALID_SIGNAL');
 if(signal?.aborted)throw new ReactAdapterError('RENDER_ABORTED',signal.reason);
}
export function reactPrefix(value:unknown,required=false):asserts value is string{
 if(typeof value!=='string'||(!value&&required)||value!==''&&!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(value))throw new ReactAdapterError('INVALID_IDENTIFIER_PREFIX');
}
export function reactByteLimit(value:unknown,fallback=1048576):number{
 const limit=value??fallback;
 if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>16777216)throw new ReactAdapterError('INVALID_BYTE_LIMIT');return limit;
}
/** Version equality is necessary, but cannot detect every duplicate same-version React copy. */
export function validateReactVersions(reactVersion:unknown,domVersion:unknown):18|19{
 if(typeof reactVersion!=='string'||reactVersion!==domVersion||!/^(18|19)\.\d+\.\d+$/.test(reactVersion))throw new ReactAdapterError('REACT_PEER_VERSION_MISMATCH');
 const [major,minor,patch]=reactVersion.split('.').map(Number);
 if(major===18&&(minor<3||minor===3&&patch<1))throw new ReactAdapterError('REACT_PEER_VERSION_MISMATCH');
 return major as 18|19;
}
export function importedDefault<T>(module:T):T{return ((module as any).default??module) as T}
