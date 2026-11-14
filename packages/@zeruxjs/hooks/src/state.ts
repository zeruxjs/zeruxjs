import { AsyncLocalStorage } from 'node:async_hooks';

/** Synchronous effect cleanup contract; arbitrary async work requires separate host ownership. */
type Cleanup = () => void;
/** One positional state/ref/memo/effect record for a stable render identity. */
type Slot = {
  /** Positional hook kind used to reject reinterpretation after order changes. */
  kind: string;
  /** Borrowed state/ref/memo payload; no deep cloning or authentication. */
  value?: unknown;
  /** Copied shallow dependency identities used with Object.is. */
  deps?: readonly unknown[];
  /** Owned synchronous effect disposer, cleared before invocation to avoid duplicate cleanup. */
  cleanup?: Cleanup;
};
/** Component-local ordered hook state with synchronous render/order guards. */
type Instance = {
  /** Ordered positional hook records owned by one component identity. */
  slots: Slot[];
  /** Whether managed render/hook access remains valid for this instance. */
  mounted: boolean;
  /** Hook count committed by a previous successful render validation. */
  expectedCount?: number;
  /** Same-instance synchronous reentrancy/concurrency guard. */
  rendering?: boolean;
};
/** Async-local component map; explicit owned scopes also invalidate late managed access. */
type Scope = {
  /** Component identities mapped within this async-local state scope. */
  instances: Map<object, Instance>;
  /** Explicit owner invalidation flag; not a claim that arbitrary async work stopped. */
  closed?: boolean;
};
/** One synchronous render cursor and its deferred effect queue. */
type Render = {
  /** Live component instance selected for this render. */
  instance: Instance;
  /** Next positional hook index during this synchronous render. */
  cursor: number;
  /** Synchronous effects queued until render result/order validation succeeds. */
  pending: Array<() => void>;
};

/** Module-owned AsyncLocalStorage carrier; component maps remain per entered request/owner. */
const scopes = new AsyncLocalStorage<Scope>();
/** Separate async-local synchronous-render cursor, not a process-global component. */
const renders = new AsyncLocalStorage<Render>();

/** Enter an independent async-local component-instance map; standalone callers still own effect/component disposal.
 * @param {Function} callback - Borrowed host callback whose result is returned unchanged; inner renders must stay synchronous.
 * @returns {T} Callback result, without automatically scheduling UI work or HTTP teardown.
 */
export function runWithState<T>(callback: () => T): T {
  return scopes.run({ instances: new Map() }, callback);
}

/** Create an explicit state/effect owner independent of handler-promise lifetime.
 * @returns {object} Run/dispose facade; host must dispose at its actual request/render-owner boundary.
 */
export function createServerStateScope() {
  /** Current/owned component map; explicit disposal controls validity. */
  const scope: Scope = { instances: new Map() };
  let closed = false;
  return {
    /** Enter the owned instance map while the explicit scope remains live.
     * @param {Function} callback - Borrowed callback; creating async descendants does not extend owner lifetime.
     * @returns {T} Callback result unchanged; disposed scope admission rejects.
     */
    run<T>(callback: () => T): T {
      if (closed) {
        throw new Error('[zerux] Request hooks disposed');
      }
      return scopes.run(scope, callback);
    },
    /** Idempotently invalidate instances, detach each cleanup before calling it and attempt every synchronous cleanup.
     * @returns {void} All cleanup attempts complete; failures aggregate after retained state is cleared.
     */
    dispose() {
      if (closed) {
        return;
      }
      closed = true;
      scope.closed = true;
      /** Detached cleanup failures collected while every other cleanup is still attempted. */
      const errors: unknown[] = [];
      // Invalidate every owned component even if an earlier effect cleanup fails.
      for (const instance of scope.instances.values()) {
        instance.mounted = false;
        // Detach before invoking so each effect cleanup is attempted at most once.
        for (const slot of instance.slots) {
          /** Detached synchronous cleanup, cleared from its slot before invocation. */
          const cleanup = slot.cleanup;
          slot.cleanup = undefined;
          try {
            cleanup?.();
          } catch (error) {
            errors.push(error);
          }
        }
        instance.slots.length = 0;
      }
      scope.instances.clear();
      if (errors.length) {
        throw new AggregateError(errors, '[zerux] Request hook cleanup failed');
      }
    },
  };
}

/** Require a live synchronous render before allocating/reading a hook slot.
 * @returns {Render} Active render cursor; outside/disposed access rejects.
 */
function active(): Render {
  /** Active synchronous render cursor; never a frontend runtime dispatcher. */
  const render = renders.getStore();
  if (render && !render.instance.mounted) {
    throw new Error('[zerux] Request hooks disposed');
  }
  if (!render) {
    throw new Error('[zerux] Hooks must be called inside runHooks');
  }
  return render;
}

/** Reuse a positional hook slot only when its kind matches the previous render.
 * @param {string} kind - Fixed hook discriminator.
 * @param {Function} initialize - Borrowed synchronous initializer invoked only for a new slot.
 * @returns {Slot} Existing/new slot; ordering mismatches reject before reinterpretation.
 */
function slot(kind: string, initialize: () => Slot): Slot {
  /** Active synchronous render cursor; never a frontend runtime dispatcher. */
  const render = active();
  /** Next positional slot number used to enforce stable hook ordering. */
  const index = render.cursor++;
  /** Previous slot/value at this position, checked before reuse or functional update. */
  const previous = render.instance.slots[index];
  if (previous) {
    if (previous.kind !== kind) {
      throw new Error(`[zerux] Hook order changed at index ${index}`);
    }
    return previous;
  }
  /** Fresh slot initialized only after the previous position was absent. */
  const created = initialize();
  render.instance.slots[index] = created;
  return created;
}

/** Run one stable-key synchronous render with count/order checks. Failed renders truncate newly allocated slots but do not transactionally roll back prior mutations or effects.
 * @param {Function} callback - Borrowed synchronous render callback; returned thenables reject.
 * @param {object} key - Stable component identity; defaults to callback identity.
 * @returns {T} Render result after pending synchronous effects; this function never schedules a renderer.
 */
export function runHooks<T>(callback: () => T, key: object = callback): T {
  /** Current/owned component map; explicit disposal controls validity. */
  const scope = scopes.getStore();
  if (!scope) {
    throw new Error('[zerux] runHooks must be inside runWithState');
  }
  if (scope.closed) {
    throw new Error('[zerux] Request hooks disposed');
  }
  let instance = scope.instances.get(key);
  if (!instance) {
    instance = { slots: [], mounted: true };
    scope.instances.set(key, instance);
  }
  if (!instance.mounted) {
    throw new Error('[zerux] Hook instance is disposed');
  }
  if (instance.rendering) {
    throw new Error(
      '[zerux] Concurrent renders of the same instance are not supported'
    );
  }
  /** Active synchronous render cursor; never a frontend runtime dispatcher. */
  const render: Render = { instance, cursor: 0, pending: [] };
  instance.rendering = true;
  /** Pre-render slot length restored after failure; existing mutations are not globally rolled back. */
  const oldSize = instance.slots.length;
  try {
    /** Observed synchronous render/effect result; it is not automatically awaited as async work. */
    const result = renders.run(render, callback);
    // Rendering must remain synchronous; otherwise concurrent async renders can
    // observe and mutate the same component slots out of order.
    if (
      result &&
      typeof (
        result as object as {
          /** Structural thenable probe used to reject synchronous-contract misuse, not to execute a module. */
          then?: unknown;
        }
      ).then === 'function'
    ) {
      throw new Error('[zerux] runHooks does not support asynchronous renders');
    }
    if (
      instance.expectedCount !== undefined &&
      render.cursor !== instance.expectedCount
    ) {
      throw new Error('[zerux] Hook count changed between renders');
    }
    instance.expectedCount = render.cursor;
    // Execute validated-render effects in hook order; failures do not undo earlier side effects.
    for (const task of render.pending) {
      task();
    }
    return result;
  } catch (error) {
    instance.slots.length = oldSize;
    throw error;
  } finally {
    instance.rendering = false;
  }
}

/** Reuse a positional state value and return its compatible captured update closure; the host must not retain setters past their owner lifetime.
 * @param {T | (() => T)} initial - Borrowed initial value or one-time synchronous initializer.
 * @returns {[T, Function]} Current value and updater; changes affect stored state but do not rerender automatically.
 */
export function useState<T>(
  initial: T | (() => T)
): [T, (next: T | ((previous: T) => T)) => void] {
  /** Positional hook record shared across rerenders of this component. */
  const entry = slot('state', () => ({
    kind: 'state',
    value: typeof initial === 'function' ? (initial as () => T)() : initial,
  }));
  /** Apply a direct or functional value update to the captured slot without scheduling rendering.
   * @param {T | Function} next - New value or borrowed synchronous previous-value mapper.
   * @returns {void} Stored value changed; host owns setter lifetime and rerender scheduling. */
  const update = (next: T | ((previous: T) => T)) => {
    /** Previous slot/value at this position, checked before reuse or functional update. */
    const previous = entry.value as T;
    entry.value =
      typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
  };
  return [entry.value as T, update];
}

/** Reuse positional reducer state and return a synchronous dispatch closure.
 * @param {Function} reducer - Borrowed synchronous state/action reducer; its errors propagate.
 * @param {S} initial - Initial state retained by reference on first allocation.
 * @returns {[S, Function]} Current value and dispatch, without automatic rendering or payload authorization.
 */
export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initial: S
): [S, (action: A) => void] {
  /** Positional hook record shared across rerenders of this component. */
  const entry = slot('reducer', () => ({ kind: 'reducer', value: initial }));
  return [
    entry.value as S,
    (action: A) => {
      entry.value = reducer(entry.value as S, action);
    },
  ];
}

/** Reuse one mutable ref holder at a stable hook position.
 * @param {T} value - Borrowed first-render initial value; later calls do not replace it.
 * @returns {object} Stable current holder; it is not a DOM ref ownership or disposal mechanism.
 */
export function useRef<T>(value: T): {
  /** Mutable stable ref value; holder ownership remains with the component host. */
  current: T;
} {
  return slot('ref', () => ({ kind: 'ref', value: { current: value } }))
    .value as {
    /** Mutable stable ref value; holder ownership remains with the component host. */
    current: T;
  };
}

/** Compare dependency lists by length and Object.is identity/value semantics.
 * @param {readonly unknown[] | undefined} old - Previous copied dependencies, or absent.
 * @param {readonly unknown[]} next - Current borrowed dependency list.
 * @returns {boolean} Whether recomputation/cleanup is required; no deep-object equality is attempted.
 */
function differs(
  old: readonly unknown[] | undefined,
  next: readonly unknown[]
): boolean {
  return (
    !old ||
    old.length !== next.length ||
    next.some((value, index) => !Object.is(value, old[index]))
  );
}

/** Recompute synchronously only when positional dependencies differ and retain a dependency copy.
 * @param {Function} factory - Borrowed synchronous value factory.
 * @param {readonly unknown[]} deps - Stable-order dependency list compared with Object.is.
 * @returns {T} Memoized value by reference; no resource lifetime is inferred.
 */
export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
  /** Positional hook record shared across rerenders of this component. */
  const entry = slot('memo', () => ({ kind: 'memo' }));
  if (differs(entry.deps, deps)) {
    entry.value = factory();
    entry.deps = [...deps];
  }
  return entry.value as T;
}

/** Queue a synchronous effect after render validation; clean the previous effect before replacement. Omitted deps rerun each time, while an unchanged list skips work.
 * @param {Function} effect - Borrowed synchronous callback returning void or a synchronous cleanup; async work must have explicit host ownership.
 * @param {readonly unknown[] | undefined} deps - Optional borrowed dependency list, copied after effect execution.
 * @returns {void} No cancellation/disposer is returned; dispose the owning component/scope explicitly.
 */
export function useEffect(
  effect: () => void | Cleanup,
  deps?: readonly unknown[]
): void {
  /** Active synchronous render cursor; never a frontend runtime dispatcher. */
  const render = active();
  /** Positional hook record shared across rerenders of this component. */
  const entry = slot('effect', () => ({ kind: 'effect' }));
  if (deps && !differs(entry.deps, deps)) {
    return;
  }
  render.pending.push(() => {
    /** Detached synchronous cleanup, cleared from its slot before invocation. */
    const cleanup = entry.cleanup;
    entry.cleanup = undefined;
    cleanup?.();
    /** Observed synchronous render/effect result; it is not automatically awaited as async work. */
    const result = effect();
    entry.cleanup = typeof result === 'function' ? result : undefined;
    entry.deps = deps ? [...deps] : undefined;
  });
}

/** Remove one component before running every detached synchronous cleanup, preserving cleanup failures after state removal.
 * @param {object} key - Stable component identity within the current state scope.
 * @returns {boolean} False when absent; true on clean disposal, otherwise original/aggregate cleanup failure.
 */
export function disposeHooks(key: object): boolean {
  /** Current/owned component map; explicit disposal controls validity. */
  const scope = scopes.getStore();
  /** Component selected by stable key; removal precedes effect cleanup. */
  const instance = scope?.instances.get(key);
  if (!instance) {
    return false;
  }
  instance.mounted = false;
  scope!.instances.delete(key);
  /** Detached cleanup failures collected while every other cleanup is still attempted. */
  const errors: unknown[] = [];
  // Attempt each detached cleanup before reporting the original or aggregate failures.
  for (const entry of instance.slots) {
    /** Detached synchronous cleanup, cleared from its slot before invocation. */
    const cleanup = entry.cleanup;
    entry.cleanup = undefined;
    try {
      cleanup?.();
    } catch (error) {
      errors.push(error);
    }
  }
  instance.slots.length = 0;
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length) {
    throw new AggregateError(errors, '[zerux] Hook cleanup failed');
  }
  return true;
}
