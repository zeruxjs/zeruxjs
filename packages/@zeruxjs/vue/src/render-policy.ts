import type { Component, InjectionKey } from 'vue';
/** Fixed-code public failure; native details stay in the private Error cause. */
export class VueAdapterError extends Error {
  /** Construct a redacted failure without embedding native component or prop data.
   * @param {string} code - Fixed adapter diagnostic code.
   * @param {unknown} cause - Private underlying failure, never interpolated into the message.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`Vue adapter: ${code}`, { cause });
    this.name = 'VueAdapterError';
  }
}
/** Trusted authored component with a shallow validated prop bag; not a sandbox. */
export interface VueRenderView {
  /** Trusted native component; its setup/render code can execute. */
  readonly component: Component;
  /** Shallow own enumerable data properties; nested refs/proxies remain borrowed. */
  readonly props?: Record<string, unknown>;
}
/** Per-app/render lifecycle context supplied through native dependency injection. */
export interface VueRenderContext {
  /** Whether this lease belongs to a one-shot server render. */
  readonly ssr: boolean;
  /** Cooperative cancellation; it cannot force-stop arbitrary JavaScript. */
  readonly signal: AbortSignal;
  /** Register up to 32 cleanup callbacks before teardown; callbacks drain in reverse order. */
  onDispose(dispose: () => void | Promise<void>): void;
}
/** A key only; every app provides its own context. It is never a global request state holder. */
export const VUE_RENDER_CONTEXT: InjectionKey<VueRenderContext> = Symbol(
  'zerux.vue.render-context'
);
/** Explicit host lifecycle callbacks and deterministic native ID settings. */
export interface VueRenderOptions {
  /** Borrowed upstream cancellation signal; listener removed on teardown. */
  signal?: AbortSignal;
  /** Validated ASCII prefix; SSR and hydration must use the same value. */
  idPrefix?: string;
  /** Trusted observer receiving bounded-code failures with private causes. */
  onError?: (error: VueAdapterError) => void;
  /** Final host cleanup, awaited after component-registered callbacks. */
  onDispose?: () => void | Promise<void>;
}
/** Bound trusted component options and copy only a safe shallow prop bag.
 * @param {VueRenderView} view - Host-authored component descriptor, never untrusted executable source.
 * @returns {VueRenderView} Frozen descriptor; nested values and component code remain borrowed.
 */
export function validateVueView(view: VueRenderView): VueRenderView {
  if (!view || typeof view !== 'object') {
    throw new VueAdapterError('INVALID_VIEW');
  }
  /** Deduplicate already inspected trusted components; local component reuse is valid. */
  const seen = new Set<unknown>();
  let count = 0;
  /** Inspect inheritance and registrations without compiling templates.
   * @param {any} component - Trusted native component options or function.
   * @param {number} depth - Current bounded graph depth.
   * @param {Set<unknown>} path - Inheritance ancestors used to reject option cycles.
   * @returns {void} Returns after validation or throws a fixed-code failure.
   */
  const check = (component: any, depth: number, path = new Set<unknown>()) => {
    if (path.has(component)) {
      throw new VueAdapterError('COMPONENT_OPTIONS_CYCLE');
    }
    if (seen.has(component)) {
      return;
    }
    if (++count > 256 || depth > 32) {
      throw new VueAdapterError('COMPONENT_GRAPH_LIMIT');
    }
    if (!component || !['object', 'function'].includes(typeof component)) {
      throw new VueAdapterError('INVALID_COMPONENT');
    }
    seen.add(component);
    if ('template' in component || 'compilerOptions' in component) {
      throw new VueAdapterError('TEMPLATE_BUILD_REQUIRED');
    }
    if (
      typeof component !== 'function' &&
      !component.extends &&
      !component.mixins &&
      !['setup', 'render', 'ssrRender'].some(
        (key) => typeof component[key] === 'function'
      )
    ) {
      throw new VueAdapterError('RENDER_FUNCTION_REQUIRED');
    }
    if (component.extends) {
      check(component.extends, depth + 1, new Set([...path, component]));
    }
    if (component.mixins) {
      if (!Array.isArray(component.mixins) || component.mixins.length > 64) {
        throw new VueAdapterError('COMPONENT_GRAPH_LIMIT');
      }
      for (const mixin of component.mixins) {
        checkMixin(mixin, depth + 1, new Set([...path, component]));
      }
    }
    if (component.components) {
      /** Bound local component registration traversal before visiting children. */
      const values = Object.values(component.components);
      if (values.length > 256) {
        throw new VueAdapterError('COMPONENT_GRAPH_LIMIT');
      }
      for (const child of values) {
        check(child, depth + 1);
      }
    }
  };
  /** Validate nonrendering mixins through a bounded rendering proxy.
   * @param {any} mixin - Trusted native options object.
   * @param {number} depth - Current option graph depth.
   * @param {Set<unknown>} path - Current inheritance path.
   * @returns {void} Returns after validation; trusted getters are not sandboxed.
   */
  const checkMixin = (mixin: any, depth: number, path: Set<unknown>) => {
    if (path.has(mixin)) {
      throw new VueAdapterError('COMPONENT_OPTIONS_CYCLE');
    }
    if (!mixin || typeof mixin !== 'object' || depth > 32) {
      throw new VueAdapterError('INVALID_COMPONENT');
    }
    if ('template' in mixin || 'compilerOptions' in mixin) {
      throw new VueAdapterError('TEMPLATE_BUILD_REQUIRED');
    }
    // Mixins need not contain render/setup. A rendering proxy validates their nested options.
    check(
      { ...mixin, setup: mixin.setup ?? (() => ({})) },
      depth,
      new Set([...path, mixin])
    );
  };
  check(view.component, 0);
  let props: Record<string, unknown> | undefined;
  if (view.props !== undefined) {
    if (
      !view.props ||
      typeof view.props !== 'object' ||
      Array.isArray(view.props) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(view.props))
    ) {
      throw new VueAdapterError('INVALID_PROPS');
    }
    /** Inspect all own keys so symbols and nonenumerable accessors cannot bypass validation. */
    const keys = Reflect.ownKeys(view.props);
    if (keys.length > 256) {
      throw new VueAdapterError('PROPS_LIMIT');
    }
    props = Object.create(null);
    for (const key of keys) {
      /** The key came from ownKeys; inspect its descriptor before reading a value. */
      const descriptor = Object.getOwnPropertyDescriptor(view.props, key)!;
      if (
        typeof key !== 'string' ||
        key.length > 128 ||
        /^(?:__proto__|prototype|constructor)$/.test(key) ||
        !descriptor.enumerable ||
        !('value' in descriptor)
      ) {
        throw new VueAdapterError('INVALID_PROPS');
      }
      props![key] = Reflect.get(view.props, key);
    }
    Object.freeze(props);
  }
  return Object.freeze({ component: view.component, props });
}
/** Validate a host-authored component tree and snapshot the shallow prop bag without cloning Vue refs/proxies.
 * @param {Component} component - Trusted authored setup/render component.
 * @param {Record<string, unknown>} props - Optional shallow data properties.
 * @returns {VueRenderView} Frozen descriptor with a shallow copied prop bag.
 */
export const createVueView = (
  component: Component,
  props?: Record<string, unknown>
): VueRenderView => validateVueView({ component, props });
/** Snapshot explicit lifecycle options after validating native signals and callbacks.
 * @param {VueRenderOptions} options - Trusted host policy; callbacks are executable application code.
 * @returns {VueRenderOptions} Frozen shallow option copy.
 */
export function validateVueOptions(
  options: VueRenderOptions
): VueRenderOptions {
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    throw new VueAdapterError('INVALID_SIGNAL');
  }
  if (
    options.idPrefix !== undefined &&
    (typeof options.idPrefix !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(options.idPrefix))
  ) {
    throw new VueAdapterError('INVALID_ID_PREFIX');
  }
  if (
    (options.onError !== undefined && typeof options.onError !== 'function') ||
    (options.onDispose !== undefined && typeof options.onDispose !== 'function')
  ) {
    throw new VueAdapterError('INVALID_CALLBACK');
  }
  return Object.freeze({ ...options });
}
/** Reject already canceled cooperative work without serializing the abort reason.
 * @param {AbortSignal} signal - Optional borrowed native signal.
 * @returns {void} Returns while active or throws with a private cause.
 */
export function checkVueAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new VueAdapterError('RENDER_ABORTED', signal.reason);
  }
}
/** Enforce the qualified Vue 3.5 patch range without claiming all-version support.
 * @param {unknown} version - Installed native runtime version.
 * @returns {void} Returns for 3.5.44 or later patches within 3.5.
 */
export function vueVersion(version: unknown): void {
  if (
    typeof version !== 'string' ||
    !/^3\.5\.\d+$/.test(version) ||
    Number(version.split('.')[2]) < 44
  ) {
    throw new VueAdapterError('VUE_PEER_VERSION_MISMATCH');
  }
}
/** Normalize native dynamic-import interop without modifying the module.
 * @param {T} module - Trusted imported namespace or default-bearing module.
 * @returns {T} Default export when present, otherwise the supplied module.
 */
export function unwrapModule<T>(module: T): T {
  return ((module as any).default ?? module) as T;
}
/** Bounded host callbacks and sanitized error records, owned by one accepted app/render.
 * @param {boolean} ssr - Whether the lease belongs to a one-shot server render.
 * @param {VueRenderOptions} options - Borrowed host cancellation and lifecycle policy.
 * @returns {object} Owned context, diagnostic accessors and memoized asynchronous close.
 */
export function createVueLease(ssr: boolean, options: VueRenderOptions) {
  /** Owned cancellation and bounded cleanup/error collections for this app only. */
  const controller = new AbortController(),
    disposers: (() => void | Promise<void>)[] = [],
    errors: VueAdapterError[] = [];
  let closing = false,
    closed: Promise<void> | undefined,
    dropped = 0,
    criticalEpoch = 0,
    criticalError: VueAdapterError | undefined;
  /** Forward upstream cancellation without owning the upstream controller.
   * @returns {void} Signals only; cleanup remains explicitly awaited through close.
   */
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) {
    abort();
  }
  /** Retain up to 16 failures and count overflow without unbounded allocation.
   * @param {VueAdapterError} error - Fixed-code failure with a private cause.
   * @returns {void} Updates bounded lease diagnostics.
   */
  const record = (error: VueAdapterError) => {
    if (errors.length < 16) {
      errors.push(error);
    } else {
      dropped++;
    }
  };
  /** Record a failure and isolate exceptions from the trusted error observer.
   * @param {string} code - Fixed adapter failure category.
   * @param {unknown} cause - Private underlying component or lifecycle failure.
   * @returns {void} Updates diagnostics without propagating observer failures.
   */
  const report = (code: string, cause: unknown) => {
    /** Retain a fixed code while preserving the original cause privately. */
    const error = new VueAdapterError(code, cause);
    record(error);
    if (['VUE_RENDER_ERROR', 'TEMPLATE_BUILD_REQUIRED'].includes(code)) {
      criticalEpoch++;
      criticalError = error;
    }
    try {
      options.onError?.(error);
    } catch (cause) {
      record(new VueAdapterError('VUE_OBSERVER_FAILED', cause));
    }
  };
  /** Frozen per-app context; only the bounded registration method mutates lease state. */
  const context: VueRenderContext = Object.freeze({
    ssr,
    signal: controller.signal,
    onDispose(dispose: () => void | Promise<void>) {
      if (closing || typeof dispose !== 'function' || disposers.length >= 32) {
        throw new VueAdapterError('INVALID_DISPOSER');
      }
      disposers.push(dispose);
    },
  });
  return {
    context,
    report,
    get criticalEpoch() {
      return criticalEpoch;
    },
    get criticalError() {
      return criticalError;
    },
    get errors() {
      return Object.freeze([...errors]);
    },
    get droppedErrors() {
      return dropped;
    },
    close() {
      closing = true;
      return (closed ??= Promise.resolve().then(async () => {
        controller.abort(options.signal?.reason);
        options.signal?.removeEventListener('abort', abort);
        /** Collect every teardown failure while still attempting remaining cleanup. */
        const failures: unknown[] = [];
        for (const stop of disposers.splice(0).reverse()) {
          try {
            await stop();
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          await options.onDispose?.();
        } catch (error) {
          failures.push(error);
        }
        if (failures.length) {
          throw new VueAdapterError(
            'VUE_CLEANUP_FAILED',
            new AggregateError(failures, 'Vue render cleanup failed')
          );
        }
      }));
    },
  };
}
