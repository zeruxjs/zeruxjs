import type { App } from 'vue';
import {
  VueAdapterError,
  validateVueView,
  validateVueOptions,
  checkVueAbort,
  vueVersion,
  unwrapModule,
  createVueLease,
  VUE_RENDER_CONTEXT,
  type VueRenderView,
  type VueRenderOptions,
} from './render-policy.js';
export { VueAdapterError } from './render-policy.js';
/** One native root owner; await unmount to observe actual cleanup settlement. */
export interface VueMount {
  /** Native initialization path selected at construction. */
  readonly mode: 'mount' | 'hydrate';
  /** Whether teardown has started; cleanup may still be settling. */
  readonly closed: boolean;
  /** Bounded fixed-code diagnostics with private native causes. */
  readonly errors: readonly VueAdapterError[];
  /** Number of diagnostics omitted after the retained error budget. */
  readonly droppedErrors: number;
  /** Replace the authored view and await native scheduling; failure does not roll back DOM changes. */
  update(view: VueRenderView): Promise<void>;
  /** Stop the native app, drain lease cleanup and release container ownership. */
  unmount(): Promise<void>;
}
/** Weak container reservations prevent two adapter roots from owning the same DOM node. */
const owners = new WeakMap<object, object>();
/** Lazily verify the runtime-only peer without loading Vue from the package root.
 * @returns {Promise<any>} Verified native runtime; dependency causes remain private.
 */
async function peers() {
  try {
    /** Compiler-free native runtime loaded only when an explicit DOM operation begins. */
    const runtime = unwrapModule(await import('@vue/runtime-dom'));
    vueVersion(runtime.version);
    if (
      typeof runtime.createApp !== 'function' ||
      typeof runtime.createSSRApp !== 'function' ||
      !runtime.isRuntimeOnly()
    ) {
      throw new VueAdapterError('RUNTIME_ONLY_BUILD_REQUIRED');
    }
    return runtime;
  } catch (cause) {
    throw cause instanceof VueAdapterError
      ? cause
      : new VueAdapterError('VUE_DEPENDENCY_UNAVAILABLE', cause);
  }
}
/** Reserve one container and roll back native preparation failures.
 * @param {VueMount['mode']} mode - Explicit native mount or hydration path.
 * @param {VueRenderView} input - Trusted authored component descriptor.
 * @param {Element} container - Host-owned root element.
 * @param {VueRenderOptions} options - Explicit lifecycle policy.
 * @returns {Promise<VueMount>} Owned native root handle after preparation settles.
 */
async function open(
  mode: VueMount['mode'],
  input: VueRenderView,
  container: Element,
  options: VueRenderOptions
): Promise<VueMount> {
  /** Validate before reserving the container or loading optional peers. */
  const view = validateVueView(input),
    settings = validateVueOptions(options);
  checkVueAbort(settings.signal);
  if (!container || container.nodeType !== 1 || !container.ownerDocument) {
    throw new VueAdapterError('INVALID_CONTAINER');
  }
  if (owners.has(container)) {
    throw new VueAdapterError('ROOT_ALREADY_OWNED');
  }
  /** Unique reservation token prevents stale teardown from releasing a newer root. */
  const owner = {},
    lease = createVueLease(false, settings);
  owners.set(container, owner);
  let closed = false,
    app: App | undefined,
    closing: Promise<void> | undefined;
  /** Memoize actual teardown so abort and manual disposal share one outcome.
   * @returns {Promise<void>} Shared cleanup settlement; all owned cleanup paths are attempted.
   */
  const unmount = () => {
    closed = true;
    return (closing ??= Promise.resolve().then(async () => {
      /** Attempt lease cleanup even when native unmount throws. */
      const failures: unknown[] = [];
      try {
        app?.unmount();
      } catch (error) {
        failures.push(error);
      } finally {
        settings.signal?.removeEventListener('abort', abort);
      }
      try {
        await lease.close();
      } catch (error) {
        failures.push(error);
      }
      if (owners.get(container) === owner) {
        owners.delete(container);
      }
      if (failures.length) {
        throw new VueAdapterError(
          'VUE_UNMOUNT_FAILED',
          new AggregateError(failures, 'Vue app cleanup failed')
        );
      }
    }));
  };
  /** Abort initiates cleanup; hosts can await unmount to observe its settlement.
   * @returns {void} Starts teardown and records any failure without throwing from the event listener.
   */
  const abort = () => {
    void unmount().catch((error) => lease.report('VUE_UNMOUNT_FAILED', error));
  };
  settings.signal?.addEventListener('abort', abort, { once: true });
  try {
    /** The lease remains owned while asynchronous peer loading settles. */
    const runtime = await peers();
    checkVueAbort(lease.context.signal);
    if (closed) {
      throw new VueAdapterError('ROOT_CLOSED');
    }
    /** Shallow state preserves trusted component and prop identities between updates. */
    const current = runtime.shallowRef(view);
    /** Authored render-only wrapper prevents container HTML from becoming a template. */
    const root = {
      name: 'ZeruxVueRoot',
      setup: () => () =>
        runtime.h(
          current.value.component,
          current.value.props ? { ...current.value.props } : undefined
        ),
    };
    app =
      mode === 'hydrate' ? runtime.createSSRApp(root) : runtime.createApp(root);
    app.config.idPrefix = settings.idPrefix ?? '';
    app.provide(VUE_RENDER_CONTEXT, lease.context);
    app.config.errorHandler = (error) =>
      lease.report('VUE_RENDER_ERROR', error);
    app.config.warnHandler = (message) =>
      lease.report(
        /runtime compilation|on-the-fly template/i.test(message)
          ? 'TEMPLATE_BUILD_REQUIRED'
          : 'VUE_RENDER_WARNING',
        new Error(message)
      );
    app.mount(container);
    await runtime.nextTick();
    checkVueAbort(lease.context.signal);
    if (lease.criticalError?.code === 'TEMPLATE_BUILD_REQUIRED') {
      throw lease.criticalError;
    }
    if (lease.criticalError) {
      throw new VueAdapterError('VUE_MOUNT_FAILED', lease.criticalError);
    }
    return Object.freeze({
      mode,
      get closed() {
        return closed;
      },
      get errors() {
        return lease.errors;
      },
      get droppedErrors() {
        return lease.droppedErrors;
      },
      async update(next: VueRenderView) {
        if (closed) {
          throw new VueAdapterError('ROOT_CLOSED');
        }
        if (!runtime.isRuntimeOnly()) {
          throw new VueAdapterError('RUNTIME_ONLY_BUILD_REQUIRED');
        }
        /** Compare epochs to distinguish this update's native failures from older records. */
        const before = lease.criticalEpoch;
        current.value = validateVueView(next);
        await runtime.nextTick();
        if (lease.criticalEpoch !== before) {
          throw new VueAdapterError('VUE_UPDATE_FAILED', lease.criticalError);
        }
      },
      unmount,
    });
  } catch (cause) {
    try {
      await unmount();
    } catch (cleanup) {
      throw new VueAdapterError(
        'VUE_PREPARATION_FAILED',
        new AggregateError([cause, cleanup], 'Vue preparation cleanup failed')
      );
    }
    throw cause instanceof VueAdapterError
      ? cause
      : new VueAdapterError('VUE_PREPARATION_FAILED', cause);
  }
}
/** Runtime-only authored render functions; never compile a container's HTML or an option template.
 * @param {VueRenderView} view - Trusted authored component and validated shallow props.
 * @param {Element} container - Host-owned DOM element reserved until teardown settles.
 * @param {VueRenderOptions} options - Explicit cancellation, ID prefix and cleanup callbacks.
 * @returns {Promise<VueMount>} Owned native root handle; caller must await unmount.
 */
export function mountVue(
  view: VueRenderView,
  container: Element,
  options: VueRenderOptions = {}
): Promise<VueMount> {
  return open('mount', view, container, options);
}
/** Native Vue SSR hydration. Host must provide matching tree/state/idPrefix; native mismatch warnings are recorded.
 * @param {VueRenderView} view - Trusted authored component matching server markup.
 * @param {Element} container - Host-owned element containing the server-rendered root.
 * @param {VueRenderOptions} options - Matching ID prefix and explicit lifecycle callbacks.
 * @returns {Promise<VueMount>} Owned hydration handle; caller must await unmount.
 */
export function hydrateVue(
  view: VueRenderView,
  container: Element,
  options: VueRenderOptions = {}
): Promise<VueMount> {
  return open('hydrate', view, container, options);
}
