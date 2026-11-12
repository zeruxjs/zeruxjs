import type { Observable } from './observable.js';
/** An explicit ownership boundary for Zyro-style observable subscriptions. */
export interface ZyroSubscriptionScope {
  /** Observe a borrowed source; own its registration until manual stop or scope teardown.
   * @param {Observable<T>} source - Borrowed coherent snapshot/change source.
   * @param {(value: T) => void} onChange - Trusted synchronous observer.
   * @param {{immediate?: boolean}} options - Optional initial delivery policy.
   * @param {boolean} options.immediate - Defaults true; synchronous source emissions are not duplicated.
   * @returns {() => void} Idempotent unsubscribe function owned by this scope.
   */
  observe<T>(
    source: Observable<T>,
    onChange: (value: T) => void,
    options?: { immediate?: boolean }
  ): () => void;
  /** Register a cleanup callback; adding after destruction immediately invokes it. */
  add(dispose: () => void): () => void;
  /** Fence observers, then attempt all disposers in reverse registration order. */
  destroy(): void;
  /** Whether teardown has begun, including when a disposer subsequently throws. */
  readonly destroyed: boolean;
}
/** Suitable for mount/unmount and route teardown; does not mutate shared sources.
 * @returns {ZyroSubscriptionScope} Owned subscription group; destroy attempts every registered disposer.
 */
export function createZyroSubscriptionScope(): ZyroSubscriptionScope {
  let destroyed = false;
  /** Only registration cleanup is owned; source values and lifetimes remain borrowed. */
  const disposers = new Set<() => void>();
  /** Wrap trusted cleanup with at-most-once invocation and scope bookkeeping.
   * @param {() => void} stop - Borrowed registration disposer to transfer into this scope.
   * @returns {() => void} Idempotent manual disposer, also invoked by destroy.
   */
  const add = (stop: () => void) => {
    if (typeof stop !== 'function') {
      throw new TypeError('A subscription disposer is required');
    }
    if (destroyed) {
      stop();
      return () => {};
    }
    let active = true;
    /** Remove ownership before invoking cleanup so reentrant calls cannot repeat it.
     * @returns {void} Releases this registration at most once.
     */
    const dispose = () => {
      if (!active) {
        return;
      }
      active = false;
      disposers.delete(dispose);
      stop();
    };
    disposers.add(dispose);
    return dispose;
  };
  return {
    get destroyed() {
      return destroyed;
    },
    add,
    observe<T>(
      source: Observable<T>,
      onChange: (value: T) => void,
      options: { immediate?: boolean } = {}
    ) {
      if (destroyed) {
        throw new Error('Zyro subscription scope is destroyed');
      }
      if (
        !source ||
        typeof source.get !== 'function' ||
        typeof source.subscribe !== 'function' ||
        typeof onChange !== 'function'
      ) {
        throw new TypeError('Invalid observable subscription');
      }
      // Capture synchronous callback errors until subscribe returns its rollback handle.
      let synchronous = false,
        installing = true,
        observing = true,
        failed = false,
        failure: unknown;
      /** Keep synchronous observer failure until the source reveals its rollback handle. */
      const unsubscribe = source.subscribe((value) => {
        if (!observing || destroyed) {
          return;
        }
        if (installing) {
          synchronous = true;
          try {
            onChange(value);
          } catch (error) {
            failed = true;
            failure = error;
          }
        } else {
          onChange(value);
        }
      });
      installing = false;
      if (typeof unsubscribe !== 'function') {
        throw new TypeError('Observable subscribe must return a disposer');
      }
      /** Fence retained source callbacks before releasing their registration. */
      const stop = add(() => {
        observing = false;
        unsubscribe();
      });
      if (failed) {
        try {
          stop();
        } catch (cleanup) {
          throw new AggregateError(
            [failure, cleanup],
            'Observable subscription rollback failed'
          );
        }
        throw failure;
      }
      if (destroyed) {
        return stop;
      }
      if (options.immediate !== false && !synchronous) {
        try {
          onChange(source.get());
        } catch (error) {
          try {
            stop();
          } catch (cleanup) {
            throw new AggregateError(
              [error, cleanup],
              'Observable initial read and cleanup failed'
            );
          }
          throw error;
        }
      }
      return stop;
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      /** Continue teardown after failures, retaining private causes for one aggregate. */
      const errors: unknown[] = [];
      for (const stop of [...disposers].reverse()) {
        try {
          stop();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) {
        throw new AggregateError(
          errors,
          'Failed to dispose Zyro subscriptions'
        );
      }
    },
  };
}
