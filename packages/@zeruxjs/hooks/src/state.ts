import { AsyncLocalStorage } from 'node:async_hooks';

type Cleanup = () => void;
type Slot = { kind: string; value?: unknown; deps?: readonly unknown[]; cleanup?: Cleanup };
type Instance = { slots: Slot[]; mounted: boolean; expectedCount?: number; rendering?: boolean };
type Scope = { instances: Map<object, Instance> };
type Render = { instance: Instance; cursor: number; pending: Array<() => void> };

const scopes = new AsyncLocalStorage<Scope>();
const renders = new AsyncLocalStorage<Render>();

export function runWithState<T>(callback: () => T): T {
  return scopes.run({ instances: new Map() }, callback);
}

function active(): Render {
  const render = renders.getStore();
  if (!render) throw new Error('[zerux] Hooks must be called inside runHooks');
  return render;
}

function slot(kind: string, initialize: () => Slot): Slot {
  const render = active();
  const index = render.cursor++;
  const previous = render.instance.slots[index];
  if (previous) {
    if (previous.kind !== kind) throw new Error(`[zerux] Hook order changed at index ${index}`);
    return previous;
  }
  const created = initialize();
  render.instance.slots[index] = created;
  return created;
}

/** Reuse an instance by providing a stable key (a function is the default key). */
export function runHooks<T>(callback: () => T, key: object = callback): T {
  const scope = scopes.getStore();
  if (!scope) throw new Error('[zerux] runHooks must be inside runWithState');
  let instance = scope.instances.get(key);
  if (!instance) {
    instance = { slots: [], mounted: true };
    scope.instances.set(key, instance);
  }
  if (!instance.mounted) throw new Error('[zerux] Hook instance is disposed');
  if (instance.rendering) throw new Error('[zerux] Concurrent renders of the same instance are not supported');
  const render: Render = { instance, cursor: 0, pending: [] };
  instance.rendering = true;
  const oldSize = instance.slots.length;
  try {
    const result = renders.run(render, callback);
    // Rendering must remain synchronous; otherwise concurrent async renders can
    // observe and mutate the same component slots out of order.
    if (result && typeof (result as object as { then?: unknown }).then === 'function') {
      throw new Error('[zerux] runHooks does not support asynchronous renders');
    }
    if (instance.expectedCount !== undefined && render.cursor !== instance.expectedCount) {
      throw new Error('[zerux] Hook count changed between renders');
    }
    instance.expectedCount = render.cursor;
    for (const task of render.pending) task();
    return result;
  } catch (error) {
    instance.slots.length = oldSize;
    throw error;
  } finally {
    instance.rendering = false;
  }
}

export function useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
  const entry = slot('state', () => ({ kind: 'state', value: typeof initial === 'function' ? (initial as () => T)() : initial }));
  const update = (next: T | ((previous: T) => T)) => {
    const previous = entry.value as T;
    entry.value = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
  };
  return [entry.value as T, update];
}

export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void] {
  const entry = slot('reducer', () => ({ kind: 'reducer', value: initial }));
  return [entry.value as S, (action: A) => { entry.value = reducer(entry.value as S, action); }];
}

export function useRef<T>(value: T): { current: T } {
  return slot('ref', () => ({ kind: 'ref', value: { current: value } })).value as { current: T };
}

function differs(old: readonly unknown[] | undefined, next: readonly unknown[]): boolean {
  return !old || old.length !== next.length || next.some((value, index) => !Object.is(value, old[index]));
}

export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
  const entry = slot('memo', () => ({ kind: 'memo' }));
  if (differs(entry.deps, deps)) {
    entry.value = factory();
    entry.deps = [...deps];
  }
  return entry.value as T;
}

/** Effects execute after a successful synchronous render, and clean up on rerender/dispose. */
export function useEffect(effect: () => void | Cleanup, deps?: readonly unknown[]): void {
  const render = active();
  const entry = slot('effect', () => ({ kind: 'effect' }));
  if (deps && !differs(entry.deps, deps)) return;
  render.pending.push(() => {
    entry.cleanup?.();
    const result = effect();
    entry.cleanup = typeof result === 'function' ? result : undefined;
    entry.deps = deps ? [...deps] : undefined;
  });
}

export function disposeHooks(key: object): boolean {
  const instance = scopes.getStore()?.instances.get(key);
  if (!instance) return false;
  for (const entry of instance.slots) entry.cleanup?.();
  instance.mounted = false;
  scopes.getStore()!.instances.delete(key);
  return true;
}
