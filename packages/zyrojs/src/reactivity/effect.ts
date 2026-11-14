import { assertSetupHook } from '../dom/component.js';
import type { Subscriber } from './types.js';

/** Dependency tracking is synchronous: async work must use explicit signals/cleanup. */
/** Synchronous subscriber stack; undefined masks tracking during untracked callbacks. */
const stack: (Subscriber | undefined)[] = [];
/** Dependency removers keyed weakly by effect identity, rebuilt on every successful tracking pass. */
const cleanups = new WeakMap<Subscriber, Set<() => void>>();
/** Synchronous ownership stack, restored in finally; scopes do not propagate through await. */
const scopes: EffectScope[] = [];
/** Deduplicated pending effects; nested writes are deferred until the active batch/effect exits. */
const scheduled = new Set<Subscriber>();
let batchDepth = 0;
let flushing = false;
let effectDepth = 0;

/**
 * Read the innermost synchronous tracking subscriber.
 * @returns {Subscriber | undefined} Active effect, or undefined outside tracking/untracked work.
 */
export function getCurrentSubscriber(): Subscriber | undefined {
  return stack[stack.length - 1];
}
/**
 * Associate a dependency remover with the currently tracking effect.
 * @param {() => void} unsubscribe - Removes this effect from one signal’s subscriber set.
 * @returns {void} Completes synchronously; failures propagate to the caller.
 */
export function trackDependency(unsubscribe: () => void): void {
  /** Active subscriber receiving the dependency remover. */
  const current = getCurrentSubscriber();
  if (current) {
    cleanups.get(current)?.add(unsubscribe);
  }
}

/**
 * Drain deduplicated effects after nested work settles; reject runaway update loops.
 * @returns {void} Completes synchronously; failures propagate to the caller.
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
      /** Snapshot this pass so effects scheduled during execution run in a later pass. */
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
 * Queue one effect and flush immediately when no batch or effect is executing.
 * @param {Subscriber} run - Effect identity used for both deduplication and invocation.
 * @returns {void} Completes synchronously; failures propagate to the caller.
 */
export function scheduleEffect(run: Subscriber): void {
  scheduled.add(run);
  flush();
}
/** Nested synchronous batches coalesce notifications; exceptions do not strand the queue. */
/**
 * Coalesce synchronous notifications; writes remain immediately readable and are not rolled back.
 * @param {() => T} fn - Trusted synchronous callback; ownership/tracking do not extend beyond its return.
 * @returns {T} Callback return value; thrown errors propagate after stack/queue restoration.
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
 * Create an inert owner for effects and cleanup across an explicit lifecycle boundary.
 * @returns {EffectScope} Independent scope; dispose attempts every registered cleanup once.
 */
export function createEffectScope(): EffectScope {
  let disposed = false;
  /** Idempotent cleanup handles in registration order; disposal visits a reversed snapshot. */
  const owned = new Set<() => void>();
  return {
    /**
     * Report whether disposal has started; cleanup errors do not reactivate the scope.
     * @returns {boolean} Whether this scope has been disposed.
     */
    get disposed() {
      return disposed;
    },
    /**
     * Temporarily install this scope as the synchronous resource owner.
     * @param {() => T} fn - Trusted synchronous callback; ownership/tracking do not extend beyond its return.
     * @returns {T} Callback return value; thrown errors propagate after stack/queue restoration.
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
     * Register idempotent cleanup, executing immediately if this scope is already disposed.
     * @param {() => void} cleanup - Trusted synchronous resource disposer; exceptions remain visible.
     * @returns {() => void} Idempotent cleanup handle that also unregisters itself from the owner.
     */
    add(cleanup: () => void): () => void {
      if (disposed) {
        cleanup();
        return () => {};
      }
      let active = true;
      /**
       * Release this owner’s registration once, before invoking user cleanup.
       * @returns {void} Cleanup completes or propagates its original error.
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
     * Fence new ownership and dispose registered resources in reverse order.
     * @returns {void} Completes synchronously; failures propagate to the caller.
     */
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      /** Collect every disposer failure while still attempting the remaining owned cleanups. */
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
 * Register cleanup on the active synchronous scope; reject use without an owner.
 * @param {() => void} cleanup - Trusted synchronous resource disposer; exceptions remain visible.
 * @returns {() => void} Idempotent cleanup handle that also unregisters itself from the owner.
 */
export function onScopeDispose(cleanup: () => void): () => void {
  /** Innermost active scope; calling without one is an ownership error. */
  const scope = scopes[scopes.length - 1];
  if (!scope) {
    throw new Error('ZyroJS: onScopeDispose requires an active scope');
  }
  return scope.add(cleanup);
}

/** Runs immediately, re-tracks conditional dependencies, and returns an idempotent stop. */
/**
 * Run immediately, track conditional reads afresh and stop permanently after callback failure.
 * @param {() => void | (() => void)} callback - Synchronous tracked work; optional cleanup runs before rerun and on stop.
 * @returns {() => void} Idempotent cleanup handle that also unregisters itself from the owner.
 */
export function effect(callback: () => void | (() => void)): () => void {
  assertSetupHook();
  let active = true;
  let running = false;
  let rerun = false;
  let returnedCleanup: (() => void) | undefined;
  /** Subscription removers for this effect’s most recent dependency reads. */
  const dependencies = new Set<() => void>();
  /**
   * Unsubscribe the previous pass before recording a new dependency graph.
   * @returns {void} Completes synchronously; callback or cleanup failures propagate.
   */
  const removeDependencies = () => {
    for (const remove of dependencies) {
      remove();
    }
    dependencies.clear();
  };
  /**
   * Remove queued work and dependencies before invoking final user cleanup.
   * @returns {void} Completes synchronously; callback or cleanup failures propagate.
   */
  const stop = () => {
    if (!active) {
      return;
    }
    active = false;
    scheduled.delete(run);
    removeDependencies();
    /** Detach the prior user cleanup before invocation to avoid calling it twice on reentry. */
    const cleanup = returnedCleanup;
    returnedCleanup = undefined;
    cleanup?.();
    cleanups.delete(run);
  };
  /**
   * Execute one tracking pass; reentrant notifications request a later pass.
   * @returns {void} Completes synchronously; callback or cleanup failures propagate.
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
    /** Detach the prior user cleanup before invocation to avoid calling it twice on reentry. */
    const cleanup = returnedCleanup;
    returnedCleanup = undefined;
    try {
      cleanup?.();
      stack.push(run);
      if (scope) {
        scopes.push(scope);
      }
      try {
        /** Only a returned function becomes cleanup; asynchronous callback work is not tracked. */
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
  /** Captured synchronous owner; reruns retain this owner rather than whichever scope triggered a write. */
  const scope = scopes[scopes.length - 1];
  /** Scope-owned stop handle, or explicit caller-owned stop outside a scope. */
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
 * Mask the current subscriber for synchronous work, restoring it even after failure.
 * @param {() => T} fn - Trusted synchronous callback; ownership/tracking do not extend beyond its return.
 * @returns {T} Callback return value; thrown errors propagate after stack/queue restoration.
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
 * Attach a composite resource disposer to the ambient scope when one exists.
 * @param {() => void} cleanup - Trusted synchronous resource disposer; exceptions remain visible.
 * @returns {() => void} Idempotent cleanup handle that also unregisters itself from the owner.
 */
export function ownEffectCleanup(cleanup: () => void): () => void {
  /** Optional active scope; without one, the caller retains explicit cleanup ownership. */
  const scope = scopes[scopes.length - 1];
  return scope ? scope.add(cleanup) : cleanup;
}
