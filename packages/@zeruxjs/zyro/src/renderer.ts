import type { Signal, ReadonlySignal } from 'zyrojs/component';
import {
  mapObservable,
  type Observable,
  type MutableObservable,
} from './observable.js';
import { createZyroSubscriptionScope } from './scope.js';
import {
  createAsyncObservable,
  type AsyncObservable,
  type AsyncObservableOptions,
} from './async.js';
/** The host explicitly injects public standalone primitives; importing core starts no renderer. */
export type ZyroRendererRuntime = Pick<
  typeof import('zyrojs/component'),
  'signal' | 'batch' | 'untracked' | 'onScopeDispose' | 'useRef'
>;
/** Explicit per-owner cancellation and independently bounded conversion/resource capacity. */
/** Owned conversion scope; sources stay borrowed and resources created here are owned. */
export interface ZyroRendererBridgeOptions {
  /** Borrowed parent lifetime; destroy removes its listener. */
  signal?: AbortSignal;
  /** Integer 1–4096, default 128; separately caps conversions and owned resources. */
  maxConnections?: number;
}
/** Readonly native signal conversion with independently disposable source registration. */
export type RendererReadable<T> = ReadonlySignal<T> & { dispose(): void };
/** Native signal conversion with explicitly authorized application write-through. */
export type RendererWritable<T> = Signal<T> & { dispose(): void };
export interface ZyroRendererBridge {
  /** Convert a borrowed observable into a readonly native signal. */
  read<T>(source: Observable<T>): RendererReadable<T>;
  /** Project a borrowed observable with trusted untracked selector/equality callbacks. */
  select<A, B>(
    source: Observable<A>,
    selector: (value: A) => B,
    equal?: (a: B, b: B) => boolean
  ): RendererReadable<B>;
  /** Explicitly enable write-through to a borrowed mutable source. */
  write<T>(source: MutableObservable<T>): RendererWritable<T>;
  /** Create an owned async resource under the bridge lifetime signal. */
  resource<T>(
    load: (signal: AbortSignal) => Promise<T>,
    options?: Omit<AsyncObservableOptions<T>, 'signal'>
  ): AsyncObservable<T>;
  /** Coalesce synchronous native notifications; does not roll back writes or span await. */
  batch<T>(fn: () => T): T;
  /** Attempt all owned cleanup and abort resource work cooperatively. */
  destroy(): void;
  /** Whether scope teardown began; work may still be settling. */
  readonly destroyed: boolean;
  /** Number of active conversions without source labels; resources have a separate budget. */
  readonly activeConnections: number;
}
/** Require explicit structural observable operations without assuming tenant authorization.
 * @param {unknown} source - Trusted host-selected source, inspected without subscribing.
 * @returns {void} Narrows the structural contract or throws.
 */
function validateSource(
  source: unknown
): asserts source is Observable<unknown> {
  if (
    !source ||
    typeof (source as Observable<unknown>).get !== 'function' ||
    typeof (source as Observable<unknown>).subscribe !== 'function'
  ) {
    throw new TypeError('An explicit get/subscribe observable is required');
  }
}
/** Mount/request-owned conversion scope. Sources are borrowed; only resources created here are destroyed.
 * @param {ZyroRendererRuntime} runtime - Public primitives from the same native runtime owning the render.
 * @param {ZyroRendererBridgeOptions} options - Explicit parent lifetime and resource/conversion limits.
 * @returns {ZyroRendererBridge} Manual lifecycle owner; caller must destroy it or transfer ownership.
 */
export function createZyroRendererBridge(
  runtime: ZyroRendererRuntime,
  options: ZyroRendererBridgeOptions = {}
): ZyroRendererBridge {
  if (
    !runtime ||
    ['signal', 'batch', 'untracked', 'onScopeDispose', 'useRef'].some(
      (name) => typeof runtime[name as keyof ZyroRendererRuntime] !== 'function'
    )
  ) {
    throw new TypeError('ZyroJS runtime primitives are required');
  }
  /** Validate capacity before creating the subscription scope or parent listener. */
  const max = options.maxConnections ?? 128,
    parent = options.signal;
  if (!Number.isSafeInteger(max) || max < 1 || max > 4096) {
    throw new RangeError('Invalid bridge connection limit');
  }
  if (parent !== undefined && !(parent instanceof AbortSignal)) {
    throw new TypeError('Invalid bridge abort signal');
  }
  /** Use one injected native runtime; own only the subscription scope and lifetime controller. */
  const { signal, batch, untracked } = runtime,
    scope = createZyroSubscriptionScope(),
    lifetime = new AbortController();
  let connections = 0,
    resources = 0;
  /** Reject operations after ownership teardown has begun.
   * @returns {void} Returns while open or throws a fixed lifecycle error.
   */
  const assertOpen = () => {
    if (scope.destroyed) {
      throw new Error('Zyro renderer bridge is destroyed');
    }
  };
  /** Drain registration cleanup and always detach parent cancellation.
   * @returns {void} Destroys scope ownership; arbitrary loader promises remain cooperative.
   */
  const destroy = () => {
    try {
      scope.destroy();
    } finally {
      lifetime.abort(parent?.reason);
      parent?.removeEventListener('abort', destroy);
    }
  };
  /** Construct one bounded conversion with explicit optional write-through.
   * @param {Observable<A>} source - Borrowed coherent snapshot source.
   * @param {(value: A) => B} selector - Trusted untracked projection.
   * @param {(a: B, b: B) => boolean} equal - Trusted boolean equality policy.
   * @param {MutableObservable<B>} write - Optional explicit write destination; never inferred from source input.
   * @returns {RendererReadable<B>} Frozen signal-shaped view with a source registration disposer.
   */
  const select = <A, B>(
    source: Observable<A>,
    selector: (value: A) => B,
    equal: (a: B, b: B) => boolean = Object.is,
    write?: MutableObservable<B>
  ): RendererReadable<B> => {
    assertOpen();
    validateSource(source);
    if (typeof selector !== 'function' || typeof equal !== 'function') {
      throw new TypeError('Invalid bridge selector/equality');
    }
    if (connections >= max) {
      throw new Error('Zyro renderer bridge connection limit exceeded');
    }
    /** Enforce boolean equality while keeping trusted reads outside native tracking.
     * @param {B} a - Previously selected snapshot.
     * @param {B} b - Newly projected snapshot.
     * @returns {boolean} Whether to retain the previous selected value.
     */
    const compare = (a: B, b: B) => {
      /** Evaluate trusted equality untracked and require an actual boolean. */
      const result = untracked(() => equal(a, b));
      if (typeof result !== 'boolean') {
        throw new TypeError('Bridge equality must return a boolean');
      }
      return result;
    };
    /** Borrowed source adapter whose reads never allocate native effect dependencies. */
    const input: Observable<A> = {
      get: () => untracked(() => source.get()),
      subscribe: (listener) => source.subscribe(listener),
    };
    /** Memoized projection evaluated untracked so source reads do not leak into rendering effects. */
    const selected = untracked(() =>
      mapObservable(input, (value) => untracked(() => selector(value)), compare)
    );
    /** Owned native signal caching the latest selected borrowed snapshot. */
    const target = signal(untracked(() => selected.get()));
    if (!target || typeof target.peek !== 'function' || !('value' in target)) {
      throw new TypeError('Runtime signal must implement ZyroJS value/peek');
    }
    let active = true,
      stop: (() => void) | undefined;
    connections++;
    /** Release registration bookkeeping before invoking potentially throwing source cleanup. */
    const release = scope.add(() => {
      if (!active) {
        return;
      }
      active = false;
      connections--;
      stop?.();
    });
    try {
      stop = scope.observe(selected, (value) => {
        if (active && !scope.destroyed) {
          batch(() => {
            target.value = value;
          });
        }
      });
      if (typeof stop !== 'function') {
        throw new TypeError('Observable subscribe must return a disposer');
      }
      if (!active) {
        stop();
      }
    } catch (error) {
      try {
        release();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          'Bridge registration cleanup failed'
        );
      }
      throw error;
    }
    /** Validate both bridge lifetime and this conversion's individual registration.
     * @returns {void} Returns only for an active conversion.
     */
    const check = () => {
      assertOpen();
      if (!active) {
        throw new Error('Zyro renderer conversion is disposed');
      }
    };
    return Object.freeze({
      get value() {
        check();
        return target.value;
      },
      set value(value: B) {
        check();
        if (!write) {
          throw new TypeError('Read-only observable conversion');
        }
        batch(() => {
          write.set(() => value);
          target.value = untracked(() => selected.get());
        });
      },
      peek() {
        check();
        return target.peek();
      },
      dispose: release,
    });
  };
  /** One app/request owner; no global default renderer or source is created. */
  const bridge: ZyroRendererBridge = {
    read<T>(source: Observable<T>) {
      return select(source, (value) => value);
    },
    select<A, B>(
      source: Observable<A>,
      selector: (value: A) => B,
      equal?: (a: B, b: B) => boolean
    ) {
      return select(source, selector, equal);
    },
    write<T>(source: MutableObservable<T>) {
      if (!source || typeof source.set !== 'function') {
        throw new TypeError(
          'Write-through requires an explicit mutable observable'
        );
      }
      return select(
        source,
        (value) => value,
        Object.is,
        source
      ) as RendererWritable<T>;
    },
    resource<T>(
      load: (signal: AbortSignal) => Promise<T>,
      resourceOptions: Omit<AsyncObservableOptions<T>, 'signal'> = {}
    ) {
      assertOpen();
      if (resources >= max) {
        throw new Error('Zyro renderer bridge resource limit exceeded');
      }
      if (Object.hasOwn(resourceOptions, 'signal')) {
        throw new TypeError('Bridge owns resource cancellation');
      }
      /** Owned async resource inherits the bridge lifetime and does not start a loader yet. */
      const resource = createAsyncObservable(load, {
        ...resourceOptions,
        signal: lifetime.signal,
      });
      resources++;
      /** Transfer resource destruction into this scope and decrement its independent budget. */
      const release = scope.add(() => {
        resources--;
        resource.destroy();
      });
      return { ...resource, destroy: release };
    },
    batch<T>(fn: () => T) {
      assertOpen();
      if (typeof fn !== 'function') {
        throw new TypeError('Bridge batch requires a function');
      }
      return batch(fn);
    },
    destroy,
    get destroyed() {
      return scope.destroyed;
    },
    get activeConnections() {
      return connections;
    },
  };
  if (parent?.aborted) {
    destroy();
  } else {
    parent?.addEventListener('abort', destroy, { once: true });
  }
  return bridge;
}
/** Call once from defineComponent setup (or an explicit ZyroJS effect scope), never a repeated render.
 * @param {ZyroRendererRuntime} runtime - Native runtime with an active setup/effect scope.
 * @param {ZyroRendererBridgeOptions} options - Explicit bridge limits and parent signal.
 * @returns {ZyroRendererBridge} Bridge whose destroy is registered with the native scope.
 */
export function useZyroRendererBridge(
  runtime: ZyroRendererRuntime,
  options: ZyroRendererBridgeOptions = {}
): ZyroRendererBridge {
  if (!runtime || typeof runtime.useRef !== 'function') {
    throw new TypeError('ZyroJS scoped runtime primitives are required');
  }
  /** Native scope-owned holder allocated once during setup, never during repeated render. */
  const holder = runtime.useRef<ZyroRendererBridge | undefined>(undefined);
  if (!holder || typeof holder !== 'object' || !('current' in holder)) {
    throw new TypeError('Runtime useRef must return a current holder');
  }
  /** Manual bridge is rolled back unless native scope registration succeeds. */
  const bridge = createZyroRendererBridge(runtime, options);
  try {
    holder.current = bridge;
    runtime.onScopeDispose(() => {
      /** Clear the scope holder before destroying to prevent repeated ownership transfer. */
      const owned = holder.current;
      holder.current = undefined;
      owned?.destroy();
    });
  } catch (error) {
    try {
      bridge.destroy();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Bridge scope registration failed'
      );
    }
    throw error;
  }
  return bridge;
}
