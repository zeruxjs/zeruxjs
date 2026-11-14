import type { ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import {
  ReactAdapterError,
  checkReactAbort,
  reactPrefix,
  validateReactVersions,
  importedDefault,
} from './render-errors.js';
export { ReactAdapterError } from './render-errors.js';
export interface ReactRootOptions {
  /** Default empty or validated bounded identifier; must match native SSR prefix, not an authorization nonce. */
  identifierPrefix?: string;
  /** Borrowed optional abort signal; accepted roots unmount on abort, but peer loading/synchronous JavaScript cannot be force-cancelled. */
  signal?: AbortSignal;
  /** Receives bounded fixed-code errors. Inspect cause only in trusted host diagnostics. */
  onError?: (error: ReactAdapterError) => void;
  /** Runs once for an accepted owner after unmount, including later preparation failure/cancellation. */
  onDispose?: () => void;
}
export interface ReactMount {
  /** Native mount or hydrate mode fixed at acquisition. */
  readonly mode: 'mount' | 'hydrate';
  /** Whether this exact owner has been disposed; stale handles do not own a later root. */
  readonly closed: boolean;
  /** Immutable bounded snapshot of at most16 fixed-code errors; private native causes are host-only. */
  readonly errors: readonly ReactAdapterError[];
  /** Overflow count beyond the16 retained diagnostic records; never an unbounded error queue. */
  readonly droppedErrors: number;
  /** Update only this active native root with a real element/null; stale/closed handles cannot mutate replacement roots.
   * @param {ReactElement | null} view - Native React element or null; trusted component code is never sandboxed.
   * @returns {void} Explicit native owner/control result; host-owned stores are disposed only through explicit onDispose.
   */
  update(view: ReactElement | null): void;
  /** Idempotently unmount this accepted owner, remove its signal listener and invoke onDispose once. Release the container even if native/host cleanup throws.
   * @returns {void} Explicit native owner/control result; host-owned stores are disposed only through explicit onDispose.
   */
  unmount(): void;
}
/** Weak per-container ownership reservations; pending peer loads and active roots share the same exclusion. */
const owners = new WeakMap<object, object>();
/** Lazily load only fixed installed React/client/DOM peers and qualify versions/APIs; no caller-selected import paths.
 * @returns {Promise<object>} Explicit native owner/control result; host-owned stores are disposed only through explicit onDispose.
 */
async function peers() {
  try {
    /** Fixed lazy native peer imports; no dependency discovery or browser credentials. */
    const [reactModule, clientModule, domModule] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('react-dom'),
    ]);
    /** Borrowed installed React peer; consumers must share its module instance with native DOM. */
    const React = importedDefault(reactModule);
    /** Borrowed matching native root/hydration implementation. */
    const client = importedDefault(clientModule);
    /** Borrowed matching React DOM version metadata. */
    const dom = importedDefault(domModule);
    /** Qualified stable peer major determines which native diagnostic callbacks exist. */
    const major = validateReactVersions(React.version, dom.version);
    if (
      typeof React.isValidElement !== 'function' ||
      typeof client.createRoot !== 'function' ||
      typeof client.hydrateRoot !== 'function'
    ) {
      throw new ReactAdapterError('REACT_CAPABILITY_UNAVAILABLE');
    }
    return { React, client, major };
  } catch (cause) {
    throw cause instanceof ReactAdapterError
      ? cause
      : new ReactAdapterError('REACT_DEPENDENCY_UNAVAILABLE', cause);
  }
}
/** Reserve one element after preflight, acquire peers and create/adopt a native root. Resolve acquisition rather than commit; preparation failure/cancellation disposes only the accepted owner.
 * @param {ReactMount['mode']} mode - Explicit native mount versus hydration; hydration recovery remains installed-React behavior.
 * @param {ReactElement | null} view - Native React element or null; trusted component code is never sandboxed.
 * @param {Element} container - Host-owned real element reserved for one root, including pending peer acquisition.
 * @param {ReactRootOptions} options - Explicit prefix/cancellation/diagnostic/disposal callbacks; ownership transfers only after preflight succeeds.
 * @returns {Promise<ReactMount>} Explicit native owner/control result; host-owned stores are disposed only through explicit onDispose.
 */
async function open(
  mode: ReactMount['mode'],
  view: ReactElement | null,
  container: Element,
  options: ReactRootOptions
): Promise<ReactMount> {
  options = { ...options };
  if (!container || container.nodeType !== 1 || !container.ownerDocument) {
    throw new ReactAdapterError('INVALID_CONTAINER');
  }
  if (
    (options.onError !== undefined && typeof options.onError !== 'function') ||
    (options.onDispose !== undefined && typeof options.onDispose !== 'function')
  ) {
    throw new ReactAdapterError('INVALID_CALLBACK');
  }
  /** Validated identifier shared with native SSR, never a permission token. */
  const prefix = options.identifierPrefix ?? '';
  reactPrefix(prefix);
  checkReactAbort(options.signal);
  if (owners.has(container)) {
    throw new ReactAdapterError('ROOT_ALREADY_OWNED');
  }
  /** Unique reservation identity; stale handles cannot release replacement ownership. */
  const owner = {};
  /** Bounded fixed-code diagnostic retention; private causes never enter default telemetry. */
  const errors: ReactAdapterError[] = [];
  let dropped = 0,
    closed = false,
    root: Root | undefined;
  owners.set(container, owner);
  /** Isolate the trusted diagnostic observer and cap both native and observer failures.
   * @param {string} code - Fixed public diagnostic category; no private contents.
   * @param {unknown} cause - Private original cause for trusted host diagnostics only.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const report = (code: string, cause: unknown) => {
    if (closed) {
      return;
    }
    /** Fixed-code wrapper retaining a private native cause without logging it. */
    const error = new ReactAdapterError(code, cause);
    if (errors.length < 16) {
      errors.push(error);
    } else {
      dropped++;
    }
    try {
      options.onError?.(error);
    } catch (cause) {
      if (errors.length < 16) {
        errors.push(new ReactAdapterError('REACT_OBSERVER_FAILED', cause));
      } else {
        dropped++;
      }
    }
  };
  /** Idempotent owner cleanup; native root closes before explicit transferred host cleanup.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const unmount = () => {
    if (closed) {
      return;
    }
    closed = true;
    /** Exact native root captured before clearing ownership to prevent duplicate unmount. */
    const native = root;
    root = undefined;
    /** Finite native/disposal failure list preserved through fixed-code cleanup errors. */
    const failures: unknown[] = [];
    try {
      native?.unmount();
    } catch (error) {
      failures.push(error);
    } finally {
      if (owners.get(container) === owner) {
        owners.delete(container);
      }
      options.signal?.removeEventListener('abort', unmount);
      try {
        options.onDispose?.();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new ReactAdapterError(
        'REACT_UNMOUNT_FAILED',
        new AggregateError(failures, 'React root cleanup failed')
      );
    }
  };
  options.signal?.addEventListener('abort', unmount, { once: true });
  try {
    /** Qualified installed native peers; cancellation is checked again after loading. */
    const { React, client, major } = await peers();
    checkReactAbort(options.signal);
    if (closed) {
      throw new ReactAdapterError('ROOT_CLOSED');
    }
    if (view !== null && !React.isValidElement(view)) {
      throw new ReactAdapterError('INVALID_REACT_ELEMENT');
    }
    /** Bounded code-owned native root callbacks; React18/19 capability differences stay explicit. */
    const rootOptions = {
      identifierPrefix: prefix,
      onRecoverableError: (error: unknown) =>
        report('REACT_RECOVERABLE_ERROR', error),
      ...(major === 19
        ? {
            onCaughtError: (error: unknown) =>
              report('REACT_CAUGHT_ERROR', error),
            onUncaughtError: (error: unknown) =>
              report('REACT_UNCAUGHT_ERROR', error),
          }
        : {}),
    };
    if (mode === 'hydrate') {
      root = client.hydrateRoot(container, view, rootOptions);
    } else {
      root = client.createRoot(container, rootOptions);
      root.render(view);
    }
    return Object.freeze({
      mode,
      /** Read whether this exact accepted owner was disposed; no replacement root is affected.
       * @returns {boolean} Current bounded owner diagnostic state.
       */
      get closed() {
        return closed;
      },
      /** Snapshot retained fixed-code diagnostics without exposing private causes through enumerable records.
       * @returns {readonly ReactAdapterError[]} Current bounded owner diagnostic state.
       */
      get errors() {
        return Object.freeze([...errors]);
      },
      /** Read the fixed diagnostic overflow counter.
       * @returns {number} Current bounded owner diagnostic state.
       */
      get droppedErrors() {
        return dropped;
      },
      /** Update only this active native root with a real element/null; stale/closed handles cannot mutate replacement roots.
       * @param {ReactElement | null} next - Next native element or null; do not update a hydrating root before native commit.
       * @returns {void} Explicit native owner/control result; host-owned stores are disposed only through explicit onDispose.
       */
      update(next: ReactElement | null) {
        if (closed || !root) {
          throw new ReactAdapterError('ROOT_CLOSED');
        }
        if (next !== null && !React.isValidElement(next)) {
          throw new ReactAdapterError('INVALID_REACT_ELEMENT');
        }
        root.render(next);
      },
      unmount,
    });
  } catch (cause) {
    try {
      unmount();
    } catch (cleanup) {
      throw new ReactAdapterError(
        'REACT_PREPARATION_FAILED',
        new AggregateError([cause, cleanup], 'React root preparation failed')
      );
    }
    throw cause instanceof ReactAdapterError
      ? cause
      : new ReactAdapterError('REACT_PREPARATION_FAILED', cause);
  }
}
/** Create an explicitly owned native concurrent root. The promise resolves acquisition, not React scheduling/commit; caller owns resources rejected at preflight.
 * @param {ReactElement | null} view - Native React element or null; trusted component code is never sandboxed.
 * @param {Element} container - Host-owned real element reserved for one root, including pending peer acquisition.
 * @param {ReactRootOptions} options - Explicit prefix/cancellation/diagnostic/disposal callbacks; ownership transfers only after preflight succeeds.
 * @returns {Promise<ReactMount>} Explicit native owner/control result; host-owned stores are disposed only through explicit onDispose.
 */
export function mountReact(
  view: ReactElement | null,
  container: Element,
  options: ReactRootOptions = {}
): Promise<ReactMount> {
  return open('mount', view, container, options);
}
/** Adopt actual matching React SSR using the exact prefix/tree. Mismatches follow native recovery and retain bounded diagnostics; this is not a custom strict hydration algorithm.
 * @param {ReactElement | null} view - Native React element or null; trusted component code is never sandboxed.
 * @param {Element} container - Host-owned real element reserved for one root, including pending peer acquisition.
 * @param {ReactRootOptions} options - Explicit prefix/cancellation/diagnostic/disposal callbacks; ownership transfers only after preflight succeeds.
 * @returns {Promise<ReactMount>} Explicit native owner/control result; host-owned stores are disposed only through explicit onDispose.
 */
export function hydrateReact(
  view: ReactElement | null,
  container: Element,
  options: ReactRootOptions = {}
): Promise<ReactMount> {
  return open('hydrate', view, container, options);
}
