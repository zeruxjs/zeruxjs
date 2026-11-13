import { assertSetupHook } from '../dom/component.js';
import type { Subscriber } from './types.js';

/** Dependency tracking is synchronous: async work must use explicit signals/cleanup. */
/** Stores the stack value used by this module. */
const stack: (Subscriber | undefined)[] = [];
/** Stores the cleanups value used by this module. */
const cleanups = new WeakMap<Subscriber, Set<() => void>>();
/** Stores the scopes value used by this module. */
const scopes: EffectScope[] = [];
/** Stores the scheduled value used by this module. */
const scheduled = new Set<Subscriber>();
let batchDepth = 0;
let flushing = false;
let effectDepth = 0;

/**
 * getCurrentSubscriber.
 * @returns {Subscriber | undefined} Result produced by this operation.
 */
export function getCurrentSubscriber(): Subscriber | undefined {
  return stack[stack.length - 1];
}
/**
 * trackDependency.
 * @param {() => void} unsubscribe - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function trackDependency(unsubscribe: () => void): void {
  /** Stores the current value used by this module. */
  const current = getCurrentSubscriber();
  if (current) {
    cleanups.get(current)?.add(unsubscribe);
  }
}

/**
 * flush.
 * @returns {void} Result produced by this operation.
 */
function flush(): void {
  if (flushing || batchDepth || effectDepth) {
    return;
  }
  flushing = true;
  let iterations = 0;
  try {
    while (scheduled.size) {
      if (++iterations > 1000) {
        throw new Error('ZyroJS: possible reactive update loop');
      }
      /** Stores the current value used by this module. */
      const current = [...scheduled];
      scheduled.clear();
      for (const run of current) {
        run();
      }
    }
  } catch (error) {
    scheduled.clear();
    throw error;
  } finally {
    flushing = false;
  }
}
/**
 * scheduleEffect.
 * @param {Subscriber} run - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function scheduleEffect(run: Subscriber): void {
  scheduled.add(run);
  flush();
}
/** Nested synchronous batches coalesce notifications; exceptions do not strand the queue. */
/**
 * batch.
 * @param {() => T} fn - Input value for this operation.
 * @returns {T} Result produced by this operation.
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    flush();
  }
}

export interface EffectScope {
  /** Whether this scope has released its registered cleanup callbacks. */
  readonly disposed: boolean;
  /** Execute a synchronous callback with this scope as the active owner. */
  run<T>(fn: () => T): T;
  /** Register cleanup and return its removal function. */
  add(cleanup: () => void): () => void;
  /** Run registered cleanup once and release the scope. */
  dispose(): void;
}
/** Own subscriptions, effects and DOM disposers across a mount/unmount boundary. */
/**
 * createEffectScope.
 * @returns {EffectScope} Result produced by this operation.
 */
export function createEffectScope(): EffectScope {
  let disposed = false;
  /** Stores the owned value used by this module. */
  const owned = new Set<() => void>();
  return {
    /**
     * disposed.
     * @returns {unknown} Result produced by this operation.
     */
    get disposed() {
      return disposed;
    },
    /**
     * run.
     * @param {() => T} fn - Input value for this operation.
     * @returns {T} Result produced by this operation.
     */
    run<T>(fn: () => T): T {
      if (disposed) {
        throw new Error('ZyroJS: scope already disposed');
      }
      scopes.push(this);
      try {
        return fn();
      } finally {
        scopes.pop();
      }
    },
    /**
     * add.
     * @param {() => void} cleanup - Input value for this operation.
     * @returns {() => void} Result produced by this operation.
     */
    add(cleanup: () => void): () => void {
      if (disposed) {
        cleanup();
        return () => {};
      }
      let active = true;
      /**
       * Application function stop.
       * @returns {unknown} Result produced by this operation.
       */
      const stop = () => {
        if (!active) {
          return;
        }
        active = false;
        owned.delete(stop);
        cleanup();
      };
      owned.add(stop);
      return stop;
    },
    /**
     * dispose.
     * @returns {void} Result produced by this operation.
     */
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      /** Stores the errors value used by this module. */
      const errors: unknown[] = [];
      for (const stop of [...owned].reverse()) {
        try {
          stop();
        } catch (error) {
          errors.push(error);
        }
      }
      owned.clear();
      if (errors.length) {
        throw new AggregateError(
          errors,
          'ZyroJS: effect scope disposal failed'
        );
      }
    },
  };
}
/**
 * onScopeDispose.
 * @param {() => void} cleanup - Input value for this operation.
 * @returns {() => void} Result produced by this operation.
 */
export function onScopeDispose(cleanup: () => void): () => void {
  /** Stores the scope value used by this module. */
  const scope = scopes[scopes.length - 1];
  if (!scope) {
    throw new Error('ZyroJS: onScopeDispose requires an active scope');
  }
  return scope.add(cleanup);
}

/** Runs immediately, re-tracks conditional dependencies, and returns an idempotent stop. */
/**
 * effect.
 * @param {() => void | (() => void)} callback - Input value for this operation.
 * @returns {() => void} Result produced by this operation.
 */
export function effect(callback: () => void | (() => void)): () => void {
  assertSetupHook();
  let active = true;
  let running = false;
  let rerun = false;
  let returnedCleanup: (() => void) | undefined;
  /** Stores the dependencies value used by this module. */
  const dependencies = new Set<() => void>();
  /**
   * Application function removeDependencies.
   * @returns {unknown} Result produced by this operation.
   */
  const removeDependencies = () => {
    for (const remove of dependencies) {
      remove();
    }
    dependencies.clear();
  };
  /**
   * Application function stop.
   * @returns {unknown} Result produced by this operation.
   */
  const stop = () => {
    if (!active) {
      return;
    }
    active = false;
    scheduled.delete(run);
    removeDependencies();
    /** Stores the cleanup value used by this module. */
    const cleanup = returnedCleanup;
    returnedCleanup = undefined;
    cleanup?.();
    cleanups.delete(run);
  };
  /**
   * Application function run.
   * @returns {unknown} Result produced by this operation.
   */
  const run = () => {
    if (!active) {
      return;
    }
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    effectDepth++;
    removeDependencies();
    /** Stores the cleanup value used by this module. */
    const cleanup = returnedCleanup;
    returnedCleanup = undefined;
    try {
      cleanup?.();
      stack.push(run);
      if (scope) {
        scopes.push(scope);
      }
      try {
        /** Stores the result value used by this module. */
        const result = callback();
        if (typeof result === 'function') {
          returnedCleanup = result;
        }
      } finally {
        stack.pop();
        if (scope) {
          scopes.pop();
        }
      }
    } catch (error) {
      stop();
      throw error;
    } finally {
      running = false;
      if (rerun && active) {
        rerun = false;
        scheduled.add(run);
      }
      effectDepth--;
      flush();
    }
  };
  cleanups.set(run, dependencies);
  // Scope registration precedes the first run so an initial failure cannot leak ownership.
  /** Stores the scope value used by this module. */
  const scope = scopes[scopes.length - 1];
  /** Stores the managedStop value used by this module. */
  const managedStop = scope ? scope.add(stop) : stop;
  try {
    run();
  } catch (error) {
    managedStop();
    throw error;
  }
  return managedStop;
}

/** Run synchronous work without subscribing its caller to incidental reads. */
/**
 * untracked.
 * @param {() => T} fn - Input value for this operation.
 * @returns {T} Result produced by this operation.
 */
export function untracked<T>(fn: () => T): T {
  stack.push(undefined);
  try {
    return fn();
  } finally {
    stack.pop();
  }
}

/** Internal ownership bridge for composite reactive resources. */
/**
 * ownEffectCleanup.
 * @param {() => void} cleanup - Input value for this operation.
 * @returns {() => void} Result produced by this operation.
 */
export function ownEffectCleanup(cleanup: () => void): () => void {
  /** Stores the scope value used by this module. */
  const scope = scopes[scopes.length - 1];
  return scope ? scope.add(cleanup) : cleanup;
}
