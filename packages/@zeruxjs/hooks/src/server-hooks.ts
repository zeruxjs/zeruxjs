import { AsyncLocalStorage } from 'node:async_hooks';

export interface ServerHookContext { readonly signal: AbortSignal }
export interface ServerHookRegistration { priority?: number; once?: boolean; signal?: AbortSignal }
export interface ServerHookDispatch { signal?: AbortSignal }
export interface ServerHookLimits { maxHandlers?: number; maxDepth?: number; maxPending?: number }
/** Removes this registration only, even when the same callback was registered multiple times. */
export interface ServerHookToken { readonly id: symbol; readonly active: boolean; remove(): boolean }
export class ServerHookError extends Error {
  constructor(readonly code: 'HOOK_INVALID' | 'HOOK_CLOSED' | 'HOOK_ABORTED' | 'HOOK_DEPTH' | 'HOOK_CAPACITY' | 'HOOK_ASYNC_IN_SYNC') {
    super(code); this.name = 'ServerHookError';
  }
}
type Handler = (context: ServerHookContext, ...args: any[]) => unknown;
type Entry = { id: symbol; name: string; callback: Handler; priority: number; once: boolean; active: boolean; detach(): void };
type Frame = { depth: number; active: boolean };
const failure = (code: ServerHookError['code']) => new ServerHookError(code);
const bounded = (value: number, max: number) => Number.isSafeInteger(value) && value >= 1 && value <= max;
function dispatchOptions(value: ServerHookDispatch): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'signal') || value.signal !== undefined && !(value.signal instanceof AbortSignal)) throw failure('HOOK_INVALID');
}
function hookName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9:._/-]{0,127}$/.test(value)) throw failure('HOOK_INVALID');
}
function copyArguments(args: readonly unknown[], max: number): unknown[] {
  if (!Array.isArray(args) || args.length > max) throw failure('HOOK_INVALID');
  const length = args.length, copy: unknown[] = [];
  // Bound indexed reads; never execute a caller-supplied iterator or acquire handles before copying.
  for (let index = 0; index < length; index++) copy.push(args[index]);
  return copy;
}
/** Each engine owns its storage/handlers/controllers. No process-global registry or implicit tenant inheritance. */
function engine(async: boolean, filter: boolean, options: ServerHookLimits = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['maxHandlers', 'maxDepth', 'maxPending'].includes(key))) throw failure('HOOK_INVALID');
  const maxHandlers = options.maxHandlers === undefined ? 1024 : options.maxHandlers;
  const maxDepth = options.maxDepth === undefined ? 32 : options.maxDepth;
  const maxPending = options.maxPending === undefined ? 32 : options.maxPending;
  if (!bounded(maxHandlers, 10000) || !bounded(maxDepth, 128) || !bounded(maxPending, 256)) throw failure('HOOK_INVALID');
  const entries = new Map<symbol, Entry>(), scopes = new AsyncLocalStorage<Frame>();
  const controllers = new Set<AbortController>(), pending = new Set<Promise<unknown>>();
  let disposed = false;
  function remove(entry: Entry) {
    if (!entry.active) return false;
    entry.active = false; entries.delete(entry.id); entry.detach(); return true;
  }
  function register(name: string, callback: Handler, settings: ServerHookRegistration = {}): ServerHookToken {
    if (disposed) throw failure('HOOK_CLOSED'); hookName(name); dispatchOptions({ signal: settings?.signal });
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(key => !['priority', 'once', 'signal'].includes(key)) || typeof callback !== 'function' || !Number.isSafeInteger((settings.priority === undefined ? 10 : settings.priority)) || Math.abs((settings.priority === undefined ? 10 : settings.priority)) > 1000000 || settings.once !== undefined && typeof settings.once !== 'boolean') throw failure('HOOK_INVALID');
    if (!async && callback.constructor?.name === 'AsyncFunction') throw failure('HOOK_ASYNC_IN_SYNC');
    if (!settings.signal?.aborted && entries.size >= maxHandlers) throw failure('HOOK_CAPACITY');
    const entry: Entry = { id: Symbol(name), name, callback, priority: (settings.priority === undefined ? 10 : settings.priority), once: settings.once ?? false, active: !settings.signal?.aborted, detach() {} };
    const token: ServerHookToken = Object.freeze({ id: entry.id, get active() { return entry.active; }, remove: () => remove(entry) });
    if (entry.active) {
      const abort = () => { remove(entry); };
      const signal = settings.signal;
      entry.detach = () => { signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true }); entries.set(entry.id, entry);
    }
    return token;
  }
  function start(name: string, args: readonly unknown[], settings: ServerHookDispatch) {
    if (disposed) throw failure('HOOK_CLOSED'); hookName(name); dispatchOptions(settings);
    const input = copyArguments(args, 32);
    if (settings.signal?.aborted) throw failure('HOOK_ABORTED');
    const parent = scopes.getStore(), depth = parent?.active ? parent.depth + 1 : 1;
    if (depth > maxDepth) throw failure('HOOK_DEPTH');
    if (controllers.size >= maxPending) throw failure('HOOK_CAPACITY');
    const controller = new AbortController(), signal = settings.signal;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    controllers.add(controller);
    // Map iteration preserves insertion order; stable sort preserves ties without an overflowing sequence counter.
    const snapshot = [...entries.values()].filter(entry => entry.name === name).sort((a, b) => a.priority - b.priority);
    const frame: Frame = { depth, active: true }, context = Object.freeze({ signal: controller.signal });
    return { snapshot, frame, context, input,
      check() { if (controller.signal.aborted) throw failure('HOOK_ABORTED'); },
      finish() { frame.active = false; controllers.delete(controller); signal?.removeEventListener('abort', abort); }
    };
  }
  function syncDispatch(name: string, args: readonly unknown[], settings: ServerHookDispatch = {}): unknown {
    const scope = start(name, args, settings), input = scope.input; let value = input[0];
    try {
      return scopes.run(scope.frame, () => {
        for (const entry of scope.snapshot) {
          scope.check(); if (!entry.active) continue; if (entry.once) remove(entry);
          const result = entry.callback(scope.context, ...(filter ? [value, ...input.slice(1)] : input));
          if (result && typeof (result as { then?: unknown }).then === 'function') {
            // Observe a rejected promise, but never pretend its already-started work was cancelled.
            void Promise.resolve(result).catch(() => {}); throw failure('HOOK_ASYNC_IN_SYNC');
          }
          if (filter) value = result;
        }
        scope.check(); return filter ? value : undefined;
      });
    } finally { scope.finish(); }
  }
  async function asyncDispatch(name: string, args: readonly unknown[], settings: ServerHookDispatch = {}): Promise<unknown> {
    const scope = start(name, args, settings), input = scope.input; let value = input[0];
    const work = Promise.resolve().then(() => scopes.run(scope.frame, async () => {
      for (const entry of scope.snapshot) {
        scope.check(); if (!entry.active) continue; if (entry.once) remove(entry);
        const result = await entry.callback(scope.context, ...(filter ? [value, ...input.slice(1)] : input));
        scope.check(); if (filter) value = result;
      }
      scope.check(); return filter ? value : undefined;
    }));
    pending.add(work);
    try { return await work; } finally { pending.delete(work); scope.finish(); }
  }
  return {
    register,
    dispatch: async ? asyncDispatch : syncDispatch,
    /** Detach listeners and stop admission. In-progress handlers receive an aborted signal. */
    dispose() { if (disposed) return; disposed = true; for (const entry of entries.values()) remove(entry); for (const controller of controllers) controller.abort(); },
    /** Await actual async settlement after disposal; no timeout claims to kill arbitrary handler work. */
    async whenIdle() { await Promise.allSettled([...pending]); },
    getDiagnostics() { return Object.freeze({ disposed, handlers: entries.size, pending: controllers.size }); }
  };
}
type EventMap<M> = { [K in keyof M]: readonly unknown[] };
type FilterMap<M> = { [K in keyof M]: readonly [unknown, ...unknown[]] };
type Name<M> = Extract<keyof M, string>;
type Rest<T extends readonly unknown[]> = T extends readonly [unknown, ...infer R] ? R : never;
interface Lifetime {
  dispose(): void;
  whenIdle(): Promise<void>;
  getDiagnostics(): Readonly<{ disposed: boolean; handlers: number; pending: number }>;
}
export interface ServerActions<M extends EventMap<M>> extends Lifetime {
  register<K extends Name<M>>(name: K, callback: (context: ServerHookContext, ...args: M[K]) => void, options?: ServerHookRegistration): ServerHookToken;
  dispatch<K extends Name<M>>(name: K, args: M[K], options?: ServerHookDispatch): void;
}
export interface AsyncServerActions<M extends EventMap<M>> extends Lifetime {
  register<K extends Name<M>>(name: K, callback: (context: ServerHookContext, ...args: M[K]) => void | Promise<void>, options?: ServerHookRegistration): ServerHookToken;
  dispatch<K extends Name<M>>(name: K, args: M[K], options?: ServerHookDispatch): Promise<void>;
}
export interface ServerFilters<M extends FilterMap<M>> extends Lifetime {
  register<K extends Name<M>>(name: K, callback: (context: ServerHookContext, ...args: M[K]) => M[K][0], options?: ServerHookRegistration): ServerHookToken;
  apply<K extends Name<M>>(name: K, value: M[K][0], args: Rest<M[K]>, options?: ServerHookDispatch): M[K][0];
}
export interface AsyncServerFilters<M extends FilterMap<M>> extends Lifetime {
  register<K extends Name<M>>(name: K, callback: (context: ServerHookContext, ...args: M[K]) => M[K][0] | Promise<M[K][0]>, options?: ServerHookRegistration): ServerHookToken;
  apply<K extends Name<M>>(name: K, value: M[K][0], args: Rest<M[K]>, options?: ServerHookDispatch): Promise<M[K][0]>;
}
/** Synchronous application/request lifecycle notifications; callback return values are ignored. */
export function createServerActions<M extends EventMap<M>>(options?: ServerHookLimits): ServerActions<M> {
  return engine(false, false, options) as ServerActions<M>;
}
/** Serial, awaited lifecycle notifications, with cooperative per-dispatch cancellation. */
export function createAsyncServerActions<M extends EventMap<M>>(options?: ServerHookLimits): AsyncServerActions<M> {
  return engine(true, false, options) as AsyncServerActions<M>;
}
/** Ordered, same-value-type transformations; additional tuple members are unchanged arguments. */
export function createServerFilters<M extends FilterMap<M>>(options?: ServerHookLimits): ServerFilters<M> {
  const { dispatch, ...registry } = engine(false, true, options);
  return { ...registry, apply: (name, value, args, settings) => {
    return dispatch(name, [value, ...copyArguments(args, 31)], settings);
  } } as ServerFilters<M>;
}
/** Serial asynchronous filters preserve the same declared value type, including unions. */
export function createAsyncServerFilters<M extends FilterMap<M>>(options?: ServerHookLimits): AsyncServerFilters<M> {
  const { dispatch, ...registry } = engine(true, true, options);
  return { ...registry, apply: async (name, value, args, settings) => {
    return dispatch(name, [value, ...copyArguments(args, 31)], settings);
  } } as AsyncServerFilters<M>;
}
