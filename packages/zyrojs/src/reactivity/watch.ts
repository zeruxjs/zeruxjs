import {
  createEffectScope,
  effect,
  untracked,
  ownEffectCleanup,
} from './effect.js';

/**
 * Observe synchronous source reads with Object.is equality; callbacks and cleanup run untracked.
 * @param {() => T} source - Synchronous reader whose signal dependencies are tracked.
 * @param {(value: T, previous: T | undefined) => void | (() => void)} callback - Receives current/previous values; may return synchronous cleanup for the next notification or stop.
 * @param {{ immediate?: boolean }} options - Initial-notification policy; subsequent equal values never notify.
 * @param {boolean} options.immediate - Invoke the callback for the initial value.
 * @returns {() => void} Idempotent stop callback, also owned by the ambient effect scope.
 */
export function watch<T>(
  source: () => T,
  callback: (value: T, previous: T | undefined) => void | (() => void),
  options: { immediate?: boolean } = {}
): () => void {
  if (
    typeof source !== 'function' ||
    typeof callback !== 'function' ||
    (options.immediate !== undefined && typeof options.immediate !== 'boolean')
  ) {
    throw new TypeError('ZyroJS: invalid watch');
  }
  let initialized = false;
  let previous: T;
  let cleanup: void | (() => void);
  /** Owns the tracking effect and final callback cleanup, including failed initial setup. */
  const scope = createEffectScope();
  scope.add(() => {
    untracked(() => {
      /** Detach cleanup before invoking it so reentrant disposal cannot invoke it twice. */
      const fn = cleanup;
      cleanup = undefined;
      fn?.();
    });
  });
  try {
    scope.run(() =>
      effect(() => {
        /** Current source result; only reads made by source participate in dependency tracking. */
        const value = source();
        if (!initialized || !Object.is(value, previous)) {
          /** Previous observed value, undefined for the first callback. */
          const old = previous;
          /** Initial callbacks require explicit opt-in; later changed values always notify. */
          const notify = initialized || options.immediate === true;
          previous = value;
          initialized = true;
          if (notify) {
            untracked(() => {
              /** Detach cleanup before invoking it so reentrant disposal cannot invoke it twice. */
              const fn = cleanup;
              cleanup = undefined;
              fn?.();
              /** Only a synchronous cleanup function or undefined is accepted; promises are rejected. */
              const result = callback(value, old);
              if (result !== undefined && typeof result !== 'function') {
                throw new TypeError(
                  'ZyroJS: watch callback must be synchronous and return only cleanup or undefined'
                );
              }
              cleanup = result;
            });
          }
        }
      })
    );
  } catch (error) {
    scope.dispose();
    throw error;
  }
  // Register with the ambient scope as well as supporting explicit stop.
  return ownEffectCleanup(() => scope.dispose());
}
