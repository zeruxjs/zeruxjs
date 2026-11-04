import type { BaseIssue, Config, ParseEvent } from '../types/index.js';
import { getGlobalConfig } from '../storages/globalConfig.js';

type Runnable = { readonly async: boolean; readonly kind?: string; readonly type?: string; readonly '~run': (...args: any[]) => any };
const runtime = Symbol('validator.parse');
type RunConfig = Config<any> & { [runtime]: { state: State; depth: number } };

/** A hard execution/input budget was exceeded; never a successful partial parse. */
export class ValidationLimitError extends Error {
  constructor(readonly code: string, readonly limit: number) {
    super(`Validation limit exceeded: ${code} (${limit})`);
    this.name = 'ValidationLimitError';
  }
}
/** Sync entry points encountered an async node or callback. */
export class AsyncValidationError extends TypeError {
  constructor() { super('Async validation requires an explicitly async schema/action and parseAsync or safeParseAsync'); this.name = 'AsyncValidationError'; }
}
/** Notification failure; cause remains trusted application-side diagnostic data. */
export class ValidationHookError extends Error {
  constructor(cause: unknown) { super('Validation event hook failed', { cause }); this.name = 'ValidationHookError'; }
}

/** Reject thenables in synchronous callbacks, observing rejections to avoid leaks. */
export function syncValue<T>(value: T): T {
  if (value && typeof (value as any).then === 'function') {
    void Promise.resolve(value).catch(() => {});
    throw new AsyncValidationError();
  }
  return value;
}

/** Native async functions can be rejected before they execute in sync APIs. */
export function syncCallback<TInput, TOutput>(callback: (input: TInput) => TOutput, input: TInput): TOutput {
  if (callback.constructor.name === 'AsyncFunction') throw new AsyncValidationError();
  return syncValue(callback(input));
}

class State {
  nodes = 0;
  issues = 0;
  active = 0;
  failed = false;
  failure: unknown;
  readonly pending = new Set<Promise<unknown>>();
  readonly waiting: (() => void)[] = [];
  readonly controller = new AbortController();
  readonly limits: Record<'maxDepth' | 'maxNodes' | 'maxCollectionSize' | 'maxIssues' | 'maxConcurrency', number>;
  readonly abort = () => this.stop(this.abortError(this.external?.reason));
  constructor(readonly sync: boolean, readonly external: AbortSignal | undefined, config: Config<any>) {
    const defaults = { maxDepth: 64, maxNodes: 10000, maxCollectionSize: 1000, maxIssues: 100, maxConcurrency: 8 };
    const ceilings = { maxDepth: 128, maxNodes: 100000, maxCollectionSize: 10000, maxIssues: 1000, maxConcurrency: 32 };
    this.limits = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
      const value = config[key] === undefined ? defaults[key] : config[key];
      if (!Number.isSafeInteger(value) || value < 1 || value > ceilings[key]) throw new TypeError(`${key} must be an integer in 1..${ceilings[key]}`);
      this.limits[key] = value;
    }
    external?.addEventListener('abort', this.abort, { once: true });
    if (external?.aborted) this.abort();
  }
  abortError(cause: unknown) { const error = new Error('Validation cancelled', { cause }); error.name = 'AbortError'; return error; }
  stop(error: unknown) {
    if (!this.failed) { this.failed = true; this.failure = error; this.controller.abort(error); }
  }
  check() { if (this.failed) throw this.failure; }
  dispose() { this.external?.removeEventListener('abort', this.abort); }
  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(() => this.pending.delete(promise), error => { this.pending.delete(promise); this.stop(error); });
    return promise;
  }
  async leaf<T>(operation: () => T | Promise<T>): Promise<T> {
    while (this.active >= this.limits.maxConcurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.check();
    this.active++;
    try { return await operation(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
  async drain() {
    // Wake queued work after failure so it rejects without invoking callbacks.
    for (const wake of this.waiting.splice(0)) wake();
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}

function collectionSize(value: unknown): number {
  if (Array.isArray(value) || typeof value === 'string') return value.length;
  if (value instanceof Map || value instanceof Set) return value.size;
  return value && typeof value === 'object' ? Object.keys(value).length : 0;
}

/** Iterative input scan bounds even any()/unknown() and detects cyclic input.
 * Never evaluates enumerable accessors; schema callbacks still require trusted code.
 */
function inspectInput(input: unknown, state: State) {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value: input, depth: 0 }];
  const active = new WeakSet<object>();
  let nodes = 0;
  while (stack.length) {
    state.check();
    const { value, depth, exit } = stack.pop()!;
    if (exit) { active.delete(value as object); continue; }
    if (++nodes > state.limits.maxNodes) throw new ValidationLimitError('max_nodes', state.limits.maxNodes);
    if (depth > state.limits.maxDepth) throw new ValidationLimitError('max_depth', state.limits.maxDepth);
    // Strings are scalar values; HTTP byte limits and maxLength own their size.
    if (typeof value === 'string') continue;
    if (collectionSize(value) > state.limits.maxCollectionSize) throw new ValidationLimitError('max_collection_size', state.limits.maxCollectionSize);
    if (!value || typeof value !== 'object') continue;
    if (active.has(value)) throw new ValidationLimitError('cyclic_input', 0);
    active.add(value); stack.push({ value, depth, exit: true });
    let children: unknown[];
    if (value instanceof Map) children = [...value].flatMap(([key, item]) => [key, item]);
    else if (value instanceof Set) children = [...value];
    else children = Object.keys(value).map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) throw new ValidationLimitError('accessor_input', 0);
      return descriptor.value;
    });
    for (let index = children.length - 1; index >= 0; index--) stack.push({ value: children[index], depth: depth + 1 });
  }
}

/** Internal dispatch preserves each schema's declared input/output contract. */
export function _runSchema<T extends Runnable>(schema: T, dataset: any, config: Config<any>): ReturnType<T['~run']> {
  const context = (config as RunConfig)[runtime];
  if (!context) return schema['~run'](dataset, config);
  const { state, depth } = context;
  state.check();
  if ('entries' in schema && schema.entries && typeof schema.entries === 'object') {
    const keys = Object.keys(schema.entries);
    if (keys.length > state.limits.maxCollectionSize) throw new ValidationLimitError('max_collection_size', state.limits.maxCollectionSize);
    if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new TypeError('Unsafe object schema key');
  }
  if (state.sync && schema.async) throw new AsyncValidationError();
  if (++state.nodes > state.limits.maxNodes) throw new ValidationLimitError('max_nodes', state.limits.maxNodes);
  if (depth > state.limits.maxDepth) throw new ValidationLimitError('max_depth', state.limits.maxDepth);
  if (typeof dataset.value !== 'string' && collectionSize(dataset.value) > state.limits.maxCollectionSize) throw new ValidationLimitError('max_collection_size', state.limits.maxCollectionSize);
  const child = { ...config, [runtime]: { state, depth: depth + 1 } };
  const invoke = () => { state.check(); return schema['~run'](dataset, child); };
  if (!schema.async) { const result = syncValue(invoke()); state.check(); return result; }
  // Gate only leaf validators/transformations. Gating containers would deadlock
  // when a container held a slot while waiting for its own nested children.
  const promise = (schema.kind !== 'schema' && schema.type !== 'check_items') || schema.type === 'custom' ? state.leaf(invoke) : Promise.resolve().then(invoke);
  return state.track(promise.then(result => { state.check(); return result; })) as ReturnType<T['~run']>;
}

/** Caches remain compatible for default parses. Explicit per-parse controls must
 * not reuse work tied to another signal, budget or refinement concurrency policy.
 */
export function bypassCache(config: Config<any>): boolean {
  const state = (config as RunConfig)[runtime]?.state;
  return !!state?.external || ['maxDepth', 'maxNodes', 'maxCollectionSize', 'maxIssues', 'maxConcurrency'].some(key => (config as any)[key] !== undefined);
}

/** Schedule a built-in per-item async callback without holding a container slot. */
export function _asyncCallback<T>(config: Config<any>, operation: () => T | Promise<T>): Promise<T> {
  const state = (config as RunConfig)[runtime]?.state;
  if (!state) return Promise.resolve().then(operation);
  state.check();
  if (++state.nodes > state.limits.maxNodes) throw new ValidationLimitError('max_nodes', state.limits.maxNodes);
  return state.track(state.leaf(operation));
}

/** Cached issue trees consume the receiving parse's budget before cloning. */
export function consumeCachedIssues(config: Config<any>, issues: readonly BaseIssue<unknown>[] | undefined) {
  if (!issues) return;
  const stack = [...issues];
  while (stack.length) {
    const issue = stack.pop()!;
    countIssue(config);
    if (issue.issues) stack.push(...issue.issues);
  }
}

/** Count issues across branches/actions, before allocating another issue. */
export function countIssue(config: Config<any>) {
  const state = (config as RunConfig)[runtime]?.state;
  if (state && ++state.issues > state.limits.maxIssues) throw new ValidationLimitError('max_issues', state.limits.maxIssues);
}

function prepare(config: Config<any> | undefined, sync: boolean) {
  if (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config))) throw new TypeError('config must be an object');
  for (const key of ['onSuccess', 'onError'] as const) if (config?.[key] !== undefined && typeof config[key] !== 'function') throw new TypeError(`${key} must be a function`);
  for (const key of ['abortEarly', 'abortPipeEarly'] as const) if (config?.[key] !== undefined && typeof config[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  if (config?.signal !== undefined && !(config.signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
  if (config?.message !== undefined && !['string', 'function'].includes(typeof config.message)) throw new TypeError('message must be a string or function');
  if (config?.lang !== undefined && typeof config.lang !== 'string') throw new TypeError('lang must be a string');
  const merged = getGlobalConfig(config);
  const state = new State(sync, config?.signal, merged);
  const runConfig: RunConfig = { ...merged, signal: state.controller.signal, [runtime]: { state, depth: 0 } };
  return { state, runConfig };
}

function notify(config: Config<any> | undefined, dataset: any, error?: unknown, failed = false) {
  const success = !failed && !dataset.issues;
  const hook = success ? config?.onSuccess : config?.onError;
  if (!hook) return;
  const event: ParseEvent = {
    success,
    ...(!success ? { failure: failed ? error instanceof ValidationLimitError ? 'limit' as const : (error as Error)?.name === 'AbortError' ? 'cancelled' as const : 'exception' as const : 'validation' as const } : {}),
    issues: (dataset?.issues ?? []).map((issue: BaseIssue<unknown>) => ({
      code: issue.code ?? `${issue.kind}.${issue.type}`,
      path: (issue.path ?? []).map(item => item.type === 'array' && typeof item.key === 'number' ? item.key : '<field>')
    }))
  };
  try { syncValue(hook(event)); } catch (hookError) { throw new ValidationHookError(failed ? { error, hookError } : hookError); }
}

/** Root sync execution; nested calls share budgets but never global hooks/state. */
export function executeSchema<T extends Runnable>(schema: T, input: unknown, config?: Config<any>): ReturnType<T['~run']> {
  const { state, runConfig } = prepare(config, true);
  let dataset: any;
  let failed = false;
  let error: unknown;
  try { inspectInput(input, state); dataset = _runSchema(schema, { value: input }, runConfig); }
  catch (cause) { failed = true; error = cause; }
  finally { state.dispose(); }
  notify(config, dataset, error, failed);
  if (failed) throw error;
  return dataset;
}

/** Root async execution drains started work on errors and removes its abort listener. */
export async function executeSchemaAsync<T extends Runnable>(schema: T, input: unknown, config?: Config<any>): Promise<Awaited<ReturnType<T['~run']>>> {
  const { state, runConfig } = prepare(config, false);
  let dataset: any;
  let failed = false;
  let error: unknown;
  try { inspectInput(input, state); dataset = await _runSchema(schema, { value: input }, runConfig); state.check(); }
  catch (cause) { state.stop(cause); failed = true; error = state.failure; }
  finally { await state.drain(); state.dispose(); }
  notify(config, dataset, error, failed);
  if (failed) throw error;
  return dataset;
}
