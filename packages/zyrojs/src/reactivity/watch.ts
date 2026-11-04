import { createEffectScope, effect, untracked, ownEffectCleanup } from './effect.js';

/** Tracks only source reads. Callback/cleanup are synchronous and untracked; equality is Object.is. */
export function watch<T>(source: () => T, callback: (value: T, previous: T | undefined) => void | (() => void), options: { immediate?: boolean } = {}): () => void {
  if (typeof source !== 'function' || typeof callback !== 'function' || (options.immediate !== undefined && typeof options.immediate !== 'boolean')) throw new TypeError('ZyroJS: invalid watch');
  let initialized = false;
  let previous: T;
  let cleanup: void | (() => void);
  const scope = createEffectScope();
  scope.add(() => { untracked(() => { const fn = cleanup; cleanup = undefined; fn?.(); }); });
  try { scope.run(() => effect(() => {
    const value = source();
    if (!initialized || !Object.is(value, previous)) {
      const old = previous;
      const notify = initialized || options.immediate === true;
      previous = value;
      initialized = true;
      if (notify) untracked(() => {
        const fn = cleanup; cleanup = undefined; fn?.();
        const result = callback(value, old);
        if (result !== undefined && typeof result !== 'function') throw new TypeError('ZyroJS: watch callback must be synchronous and return only cleanup or undefined');
        cleanup = result;
      });
    }
  })); } catch (error) { scope.dispose(); throw error; }
  // Register with the ambient scope as well as supporting explicit stop.
  return ownEffectCleanup(() => scope.dispose());
}
