export interface MockFunction<TArgs extends unknown[] = unknown[], TResult = unknown> {
  (...args: TArgs): TResult;
  mock: { calls: TArgs[]; results: Array<{type:'return'|'throw';value:unknown}> };
  mockImplementation(fn: (...args:TArgs)=>TResult): MockFunction<TArgs,TResult>;
  mockReturnValue(value: TResult): MockFunction<TArgs,TResult>;
  mockClear(): void;
}
export function fn<TArgs extends unknown[] = unknown[], TResult = unknown>(impl?: (...args:TArgs)=>TResult): MockFunction<TArgs,TResult> {
  let current = impl ?? (() => undefined as TResult);
  const calls:TArgs[] = [], results: Array<{type:'return'|'throw';value:unknown}> = [];
  const mock = ((...args:TArgs)=>{ calls.push([...args] as TArgs); try { const value=current(...args); results.push({type:'return',value});return value; } catch(e) { results.push({type:'throw',value:e});throw e; } }) as MockFunction<TArgs,TResult>;
  mock.mock = {calls,results}; mock.mockImplementation = next => {current=next;return mock;};mock.mockReturnValue = v => mock.mockImplementation(()=>v);mock.mockClear=()=>{calls.length=0;results.length=0;};return mock;
}
const restorers = new Set<()=>void>();
export function spyOn<T extends object,K extends keyof T>(obj:T,key:K) {
  const descriptor = Object.getOwnPropertyDescriptor(obj,key);
  const original=obj[key];if(typeof original!=='function')throw new TypeError(`Not a function: ${String(key)}`);
  const spy=fn<unknown[],unknown>((...args)=>(original as (...args:unknown[])=>unknown).apply(obj,args));
  Object.defineProperty(obj,key,{configurable:true,writable:true,enumerable: descriptor?.enumerable ?? true,value:spy});
  const restore=()=>{if(descriptor)Object.defineProperty(obj,key,descriptor);else delete (obj as Record<PropertyKey,unknown>)[key as PropertyKey];restorers.delete(restore);};
  restorers.add(restore); return Object.assign(spy,{mockRestore:restore});
}
export function restoreAllMocks() { for(const restore of [...restorers])restore(); }
