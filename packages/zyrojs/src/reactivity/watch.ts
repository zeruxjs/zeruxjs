import {
  createEffectScope,
  effect,
  untracked,
  ownEffectCleanup,
} from './effect.js';

/** Tracks only source reads. Callback/cleanup are synchronous and untracked; equality is Object.is. */
/**
 * watch.
 * @param {() => T} source - Input value for this operation.
 * @param {(value: T, previous: T | undefined) => void | (() => void)} callback - Input value for this operation.
 * @param {{ immediate?: boolean }} options - Input value for this operation.
 * @param {boolean} options.immediate - Invoke the callback for the initial value.
 * @returns {() => void} Result produced by this operation.
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
  /** Stores the scope value used by this module. */
  const scope = createEffectScope();
  scope.add(() => {
    untracked(() => {
      /** Stores the fn value used by this module. */
      const fn = cleanup;
      cleanup = undefined;
      fn?.();
    });
  });
  try {
    scope.run(() =>
      effect(() => {
        /** Stores the value value used by this module. */
        const value = source();
        if (!initialized || !Object.is(value, previous)) {
          /** Stores the old value used by this module. */
          const old = previous;
          /** Stores the notify value used by this module. */
          const notify = initialized || options.immediate === true;
          previous = value;
          initialized = true;
          if (notify) {
            untracked(() => {
              /** Stores the fn value used by this module. */
              const fn = cleanup;
              cleanup = undefined;
              fn?.();
              /** Stores the result value used by this module. */
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
