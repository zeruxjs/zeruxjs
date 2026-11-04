/** Fixed public diagnostics; keys, payloads and server text are never included. Causes stay internal. */
export class MemcacheError extends Error {
  readonly details:{code:string;message:string};
  constructor(readonly code:string,message:string,options?:ErrorOptions){super(message,options);this.name='MemcacheError';this.details={code,message};}
}
export const memcacheError=(code:string,cause?:unknown)=>new MemcacheError(code,code.toLowerCase().replaceAll('_',' '),cause===undefined?undefined:{cause});
