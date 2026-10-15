import type { Subscriber } from './types.js';

/** Dependency tracking is synchronous: async work must use explicit signals/cleanup. */
const stack: Subscriber[] = [];
const cleanups = new WeakMap<Subscriber, Set<() => void>>();
const scopes: EffectScope[] = [];
const scheduled = new Set<Subscriber>();
let batchDepth = 0;
let flushing = false;
let effectDepth = 0;

export function getCurrentSubscriber(): Subscriber | undefined { return stack[stack.length - 1]; }
export function trackDependency(unsubscribe: () => void): void {
  const current = getCurrentSubscriber();
  if (current) cleanups.get(current)?.add(unsubscribe);
}

function flush(): void {
  if (flushing || batchDepth || effectDepth) return;
  flushing = true;
  let iterations = 0;
  try {
    while (scheduled.size) {
      if (++iterations > 1000) throw new Error('ZyroJS: possible reactive update loop');
      const current = [...scheduled];
      scheduled.clear();
      for (const run of current) run();
    }
  } catch (error) { scheduled.clear(); throw error; }
  finally { flushing = false; }
}
export function scheduleEffect(run: Subscriber): void {
  scheduled.add(run);
  flush();
}
/** Nested synchronous batches coalesce notifications; exceptions do not strand the queue. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try { return fn(); }
  finally { batchDepth--; flush(); }
}

export interface EffectScope {
  readonly disposed: boolean;
  run<T>(fn: () => T): T;
  add(cleanup: () => void): () => void;
  dispose(): void;
}
/** Own subscriptions, effects and DOM disposers across a mount/unmount boundary. */
export function createEffectScope(): EffectScope {
  let disposed = false;
  const owned = new Set<() => void>();
  return {
    get disposed() { return disposed; },
    run<T>(fn: () => T): T {
      if (disposed) throw new Error('ZyroJS: scope already disposed');
      scopes.push(this);
      try { return fn(); } finally { scopes.pop(); }
    },
    add(cleanup: () => void): () => void {
      if (disposed) { cleanup(); return () => {}; }
      let active = true;
      const stop = () => { if (!active) return; active = false; owned.delete(stop); cleanup(); };
      owned.add(stop);
      return stop;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (const stop of [...owned].reverse()) { try { stop(); } catch (error) { errors.push(error); } }
      owned.clear();
      if (errors.length) throw new AggregateError(errors, 'ZyroJS: effect scope disposal failed');
    }
  };
}
export function onScopeDispose(cleanup: () => void): () => void {
  const scope = scopes[scopes.length - 1];
  if (!scope) throw new Error('ZyroJS: onScopeDispose requires an active scope');
  return scope.add(cleanup);
}

/** Runs immediately, re-tracks conditional dependencies, and returns an idempotent stop. */
export function effect(callback: () => void | (() => void)): () => void {
  let active = true;
  let running = false;
  let rerun = false;
  let returnedCleanup: (() => void) | undefined;
  const dependencies = new Set<() => void>();
  const removeDependencies = () => {
    for (const remove of dependencies) remove();
    dependencies.clear();
  };
  const stop = () => {
    if (!active) return;
    active = false;
    scheduled.delete(run);
    removeDependencies();
    const cleanup = returnedCleanup;
    returnedCleanup = undefined;
    cleanup?.();
    cleanups.delete(run);
  };
  const run = () => {
    if (!active) return;
    if (running) { rerun = true; return; }
    running = true;
    effectDepth++;
    removeDependencies();
    const cleanup = returnedCleanup;
    returnedCleanup = undefined;
    try {
      cleanup?.();
      stack.push(run);
      if (scope) scopes.push(scope);
      try {
        const result = callback();
        if (typeof result === 'function') returnedCleanup = result;
      } finally { stack.pop(); if (scope) scopes.pop(); }
    } catch (error) { stop(); throw error; }
    finally {
      running = false;
      if (rerun && active) { rerun = false; scheduled.add(run); }
      effectDepth--;
      flush();
    }
  };
  cleanups.set(run, dependencies);
  // Scope registration precedes the first run so an initial failure cannot leak ownership.
  const scope = scopes[scopes.length - 1];
  const managedStop = scope ? scope.add(stop) : stop;
  try { run(); } catch (error) { managedStop(); throw error; }
  return managedStop;
}
