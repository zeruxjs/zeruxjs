import { TestContext } from './context.js';
import type { TestFunction } from '../types/test.js';
export function createTestApi(context: TestContext) {
  const test = Object.assign((name: string, fn: TestFunction) => context.test(name, fn), {
    skip: (name: string, fn: TestFunction) => context.test(name, fn, true),
    only: (name: string, fn: TestFunction) => context.test(name, fn, false, true),
    each: <T>(values: readonly T[]) => (name: string, fn: (value:T) => unknown) => { values.forEach((value,i)=>context.test(name.replace(/%#/g,String(i)), ()=>fn(value))); },
    withOptions: (name: string, options: {timeoutMs?:number; retries?:number}, fn: TestFunction) => context.test(name, fn, false, false, options)
  });
  return { test, it: test };
}
