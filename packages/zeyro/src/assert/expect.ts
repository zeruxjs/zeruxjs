import { deepEqual } from '../utils/merge.js';
function format(x: unknown) { try { return JSON.stringify(x) ?? String(x); } catch { return String(x); } }
function assertion(ok: boolean, description: string) { if (!ok) throw new Error(description); }
type Thunk = () => unknown;
function hasProperty(value: unknown, key: string): boolean { return key.split('.').every((part, i, all) => { if (!value || (typeof value !== 'object' && typeof value !== 'function') || !(part in value)) return false; value = (value as Record<string, unknown>)[part]; return true; }); }
export function expect<T>(value: T) {
  const create = (negate: boolean) => {
    const check = (ok: boolean, label: string) => assertion(negate ? !ok : ok, `Expected ${format(value)} ${negate ? 'not ' : ''}${label}`);
    const api = {
      toBe(expected: unknown) { check(Object.is(value,expected), `to be ${format(expected)}`); },
      toEqual(expected: unknown) { check(deepEqual(value,expected), `to equal ${format(expected)}`); },
      toBeTruthy() { check(Boolean(value), 'to be truthy'); }, toBeFalsy() { check(!value,'to be falsy'); },
      toBeNull() { check(value === null,'to be null'); }, toBeUndefined() { check(value === undefined,'to be undefined'); },
      toContain(expected: unknown) { check(typeof value === 'string' ? value.includes(String(expected)) : Array.isArray(value) ? value.some(v=>deepEqual(v,expected)) : value instanceof Set ? value.has(expected) : false, `to contain ${format(expected)}`); },
      toMatch(pattern: string|RegExp) { check(typeof value === 'string' && (typeof pattern === 'string' ? value.includes(pattern) : pattern.test(value)), `to match ${String(pattern)}`); },
      toHaveLength(length: number) { check(value != null && typeof (value as {length?:number}).length === 'number' && (value as unknown as {length:number}).length === length, `to have length ${length}`); },
      toHaveProperty(key: string) { check(hasProperty(value,key),`to have property ${key}`); },
      toBeGreaterThan(expected: number) { check(typeof value === 'number' && value > expected, `to be greater than ${expected}`); },
      toBeLessThan(expected: number) { check(typeof value === 'number' && value < expected, `to be less than ${expected}`); },
      toBeInstanceOf(type: new (...args: never[]) => unknown) { check(value instanceof type,`to be instance of ${type.name}`); },
      toThrow(message?: string | RegExp) { let error: unknown; if(typeof value !== 'function') throw new TypeError('Expected function'); try { (value as Thunk)(); } catch(e) { error=e; } check(error !== undefined && (message === undefined || (typeof message === 'string' ? String(error).includes(message) : message.test(String(error)))), `to throw ${String(message??'')}`); },
      async toReject(message?:string|RegExp) { let error: unknown; try { await (typeof value === 'function' ? (value as Thunk)() : value); } catch(e) { error=e; } check(error !== undefined && (message === undefined || (typeof message === 'string' ? String(error).includes(message):message.test(String(error)))), `to reject ${String(message??'')}`); },
      async toResolve() { let ok = true; try { await (typeof value === 'function' ? (value as Thunk)() : value); } catch { ok=false; } check(ok,'to resolve'); }
    };
    return api;
  };
  return { ...create(false), not: create(true) };
}
