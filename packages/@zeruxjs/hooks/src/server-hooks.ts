import { AsyncLocalStorage } from 'node:async_hooks';

/** Frozen dispatch signal view without tenant identity or private request values. */
export interface ServerHookContext {
  /** Borrowed registration/dispatch or derived handler cancellation, never a principal identity. */
  readonly signal: AbortSignal;
}
/** Explicit exact-registration priority/once/cancellation policy. */
export interface ServerHookRegistration {
  /** Integer execution order, default 10; range -1000000–1000000, lower first. */
  priority?: number;
  /** Remove this exact registration before invocation, including recursive/failure cases. */
  once?: boolean;
  /** Borrowed registration/dispatch or derived handler cancellation, never a principal identity. */
  signal?: AbortSignal;
}
/** Per-call cooperative cancellation option, separate from authorization. */
export interface ServerHookDispatch {
  /** Borrowed registration/dispatch or derived handler cancellation, never a principal identity. */
  signal?: AbortSignal;
}
/** Validated per-registry finite resource limits, not global application quotas. */
export interface ServerHookLimits {
  /** Positive handler cap, default 1024 and ceiling 10000. */
  maxHandlers?: number;
  /** Logical nested dispatch cap, default 32 and ceiling 128. */
  maxDepth?: number;
  /** Actual concurrent/nested dispatch cap, default 32 and ceiling 256. */
  maxPending?: number;
}
/** Removes this registration only, even when the same callback was registered multiple times. */
export interface ServerHookToken {
  /** Unique exact-registration symbol; not an authorization credential. */
  readonly id: symbol;
  /** Live registration/frame state, checked before reuse or invocation. */
  readonly active: boolean;
  /** Idempotently detach one exact registration before any subsequent invocation.
   * @returns {boolean} Whether removal changed active state; token removal affects no duplicate registration.
   */
  remove(): boolean;
}
/** Fixed server-registry validation/lifetime error without private dispatch arguments. */
export class ServerHookError extends Error {
  /** Create a fixed typed registry/resource error without copying caller abort reasons or payloads.
   * @param {ServerHookError['code']} code - Explicit fixed validation/lifetime/capacity/sync-misuse code.
   */
  constructor(
    readonly code:
      | 'HOOK_INVALID'
      | 'HOOK_CLOSED'
      | 'HOOK_ABORTED'
      | 'HOOK_DEPTH'
      | 'HOOK_CAPACITY'
      | 'HOOK_ASYNC_IN_SYNC'
  ) {
    super(code);
    this.name = 'ServerHookError';
  }
}
/** Internal trusted callback shape beneath typed public event/filter maps. */
type Handler = (context: ServerHookContext, ...args: any[]) => unknown;
/** One exact callback registration and its owned abort-listener lifetime. */
type Entry = {
  /** Unique exact-registration symbol; not an authorization credential. */
  id: symbol;
  /** Validated internal event name; diagnostics never expose it. */
  name: string;
  /** Borrowed trusted registered handler; payload schemas are not authorization. */
  callback: Handler;
  /** Integer execution order, default 10; range -1000000–1000000, lower first. */
  priority: number;
  /** Remove this exact registration before invocation, including recursive/failure cases. */
  once: boolean;
  /** Live registration/frame state, checked before reuse or invocation. */
  active: boolean;
  /** Remove only this registration-owned abort listener; initial inactive/no-signal entries use a harmless no-op.
   * @returns {void} No other registration or caller signal is disposed.
   */
  detach(): void;
};
/** Logical per-registry nested dispatch lifetime, distinct from concurrent calls. */
type Frame = {
  /** Logical nested level tracked independently from concurrent top-level calls. */
  depth: number;
  /** Live registration/frame state, checked before reuse or invocation. */
  active: boolean;
};
/** Construct a fixed registry error without private payloads.
 * @param {ServerHookError["code"]} code - Fixed named status code.
 * @returns {ServerHookError} Typed error with fixed text/code. */
const failure = (code: ServerHookError['code']) => new ServerHookError(code);
/** Check a positive safe-integer resource cap.
 * @param {number} value - Configured count.
 * @param {number} max - Inclusive hard ceiling.
 * @returns {boolean} Whether the count is within bounds. */
const bounded = (value: number, max: number) =>
  Number.isSafeInteger(value) && value >= 1 && value <= max;
/** Validate only the explicit signal option before acquiring dispatch resources.
 * @param {ServerHookDispatch} value - Borrowed plain option record; not a payload schema or authorization proof.
 * @returns {void} Unknown fields/invalid signal shape reject HOOK_INVALID.
 */
function dispatchOptions(value: ServerHookDispatch): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'signal') ||
    (value.signal !== undefined && !(value.signal instanceof AbortSignal))
  ) {
    throw failure('HOOK_INVALID');
  }
}
/** Validate a bounded literal registry name without evaluating source or arbitrary expressions.
 * @param {unknown} value - Expected ASCII name of 1–128 characters under the documented grammar.
 * @returns {void} Asserts string on success; invalid values reject with fixed HOOK_INVALID.
 */
function hookName(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9:._/-]{0,127}$/.test(value)
  ) {
    throw failure('HOOK_INVALID');
  }
}
/** Copy a bounded array by indexed reads without invoking its caller-supplied iterator. Getters can still execute/throw; this is not a sandbox.
 * @param {readonly unknown[]} args - Borrowed bounded positional values; objects are not cloned/frozen.
 * @param {number} max - Maximum total arguments, 32 for dispatch or 31 filter extras.
 * @returns {unknown[]} New positional outer array retaining borrowed element references.
 */
function copyArguments(args: readonly unknown[], max: number): unknown[] {
  if (!Array.isArray(args) || args.length > max) {
    throw failure('HOOK_INVALID');
  }
  /** Captured outer argument count checked before bounded indexed copying. */
  const length = args.length;
  /** Fresh bounded positional array retaining borrowed element references. */
  const copy: unknown[] = [];
  // Bound indexed reads; never execute a caller-supplied iterator or acquire handles before copying.
  for (let index = 0; index < length; index++) {
    copy.push(args[index]);
  }
  return copy;
}
/** Own one explicit sync/async action/filter registry with isolated depth tracking, registrations, cancellation controllers and actual pending work.
 * @param {boolean} async - Whether handlers are serially awaited; sync mode rejects declared async/thenable misuse.
 * @param {boolean} filter - Whether the first argument is transformed through same-type stages.
 * @param {ServerHookLimits} options - Validated resource caps; default handler/depth/pending counts are 1024/32/32.
 * @returns {object} Explicit disposal/drain owner; no global subscriptions, tenant inference, timers or sockets.
 */
function engine(
  async: boolean,
  filter: boolean,
  options: ServerHookLimits = {}
) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !['maxHandlers', 'maxDepth', 'maxPending'].includes(key)
    )
  ) {
    throw failure('HOOK_INVALID');
  }
  /** Validated per-engine handler ceiling, independent of event-name cardinality. */
  const maxHandlers =
    options.maxHandlers === undefined ? 1024 : options.maxHandlers;
  /** Validated per-engine logical nesting ceiling, not concurrent-request counting. */
  const maxDepth = options.maxDepth === undefined ? 32 : options.maxDepth;
  /** Validated actual dispatch-controller ceiling. */
  const maxPending = options.maxPending === undefined ? 32 : options.maxPending;
  if (
    !bounded(maxHandlers, 10000) ||
    !bounded(maxDepth, 128) ||
    !bounded(maxPending, 256)
  ) {
    throw failure('HOOK_INVALID');
  }
  /** Exact registrations retained by symbol, preserving insertion order for priority ties. */
  const entries = new Map<symbol, Entry>();
  /** Per-engine AsyncLocalStorage frames; there is no process-global subscription registry. */
  const scopes = new AsyncLocalStorage<Frame>();
  /** Owned active dispatch controllers retained until finish, including nested work. */
  const controllers = new Set<AbortController>();
  /** Actual approved async work retained through settlement, not just caller observation. */
  const pending = new Set<Promise<unknown>>();
  let disposed = false;
  /** Idempotently detach one exact registration before any subsequent invocation.
   * @param {Entry} entry - Owned internal registration record when called by the engine.
   * @returns {boolean} Whether removal changed active state; token removal affects no duplicate registration.
   */
  function remove(entry: Entry) {
    if (!entry.active) {
      return false;
    }
    entry.active = false;
    entries.delete(entry.id);
    entry.detach();
    return true;
  }
  /** Validate and register one exact callback with stable priority/insertion ordering. Once handlers detach before invocation; an already-aborted signal returns an inactive token.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {Function} callback - Borrowed explicitly registered handler, never source text or arbitrary package discovery.
   * @param {ServerHookRegistration} settings - Optional priority/once/signal under this registry lifetime.
   * @returns {ServerHookToken} Frozen exact-registration token; the owner must still dispose/drain the registry.
   */
  function register(
    name: string,
    callback: Handler,
    settings: ServerHookRegistration = {}
  ): ServerHookToken {
    if (disposed) {
      throw failure('HOOK_CLOSED');
    }
    hookName(name);
    dispatchOptions({ signal: settings?.signal });
    if (
      !settings ||
      typeof settings !== 'object' ||
      Array.isArray(settings) ||
      Object.keys(settings).some(
        (key) => !['priority', 'once', 'signal'].includes(key)
      ) ||
      typeof callback !== 'function' ||
      !Number.isSafeInteger(
        settings.priority === undefined ? 10 : settings.priority
      ) ||
      Math.abs(settings.priority === undefined ? 10 : settings.priority) >
        1000000 ||
      (settings.once !== undefined && typeof settings.once !== 'boolean')
    ) {
      throw failure('HOOK_INVALID');
    }
    if (!async && callback.constructor?.name === 'AsyncFunction') {
      throw failure('HOOK_ASYNC_IN_SYNC');
    }
    if (!settings.signal?.aborted && entries.size >= maxHandlers) {
      throw failure('HOOK_CAPACITY');
    }
    /** One owned registration checked/detached before invoking its callback. */
    const entry: Entry = {
      id: Symbol(name),
      name,
      callback,
      priority: settings.priority === undefined ? 10 : settings.priority,
      once: settings.once ?? false,
      active: !settings.signal?.aborted,
      /** Remove only this registration-owned abort listener; initial inactive/no-signal entries use a harmless no-op.
       * @returns {void} No other registration or caller signal is disposed.
       */
      detach() {},
    };
    /** Frozen exact-registration removal view with a live active getter. */
    const token: ServerHookToken = Object.freeze({
      id: entry.id,
      get active() {
        return entry.active;
      },
      remove: () => remove(entry),
    });
    if (entry.active) {
      /** Forward cancellation only to the exact registration/dispatch owned here.
       * @returns {void} Listener cleanup is handled by its matching detach/finish hook. */
      const abort = () => {
        remove(entry);
      };
      /** Borrowed caller signal; its abort reason is never copied into fixed library errors. */
      const signal = settings.signal;
      entry.detach = () => {
        signal?.removeEventListener('abort', abort);
      };
      signal?.addEventListener('abort', abort, { once: true });
      entries.set(entry.id, entry);
    }
    return token;
  }
  /** Validate/copy arguments before claiming a pending controller and snapshot the current matching registrations.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {readonly unknown[]} args - Borrowed bounded positional values; objects are not cloned/frozen.
   * @param {ServerHookDispatch} settings - Optional borrowed caller cancellation signal; unknown options reject.
   * @returns {object} Owned frame/context/input plus check/finish hooks; admission failure acquires no pending handle.
   */
  function start(
    name: string,
    args: readonly unknown[],
    settings: ServerHookDispatch
  ) {
    if (disposed) {
      throw failure('HOOK_CLOSED');
    }
    hookName(name);
    dispatchOptions(settings);
    /** Bounded copied outer tuple; argument objects remain caller-owned references. */
    const input = copyArguments(args, 32);
    if (settings.signal?.aborted) {
      throw failure('HOOK_ABORTED');
    }
    /** Current logical frame, counted as a parent only while actually active. */
    const parent = scopes.getStore();
    /** Logical nested level checked before claiming dispatch capacity. */
    const depth = parent?.active ? parent.depth + 1 : 1;
    if (depth > maxDepth) {
      throw failure('HOOK_DEPTH');
    }
    if (controllers.size >= maxPending) {
      throw failure('HOOK_CAPACITY');
    }
    /** Owned derived dispatch controller passed to handlers through a frozen context. */
    const controller = new AbortController();
    /** Borrowed caller signal; its abort reason is never copied into fixed library errors. */
    const signal = settings.signal;
    /** Forward cancellation only to the exact registration/dispatch owned here.
     * @returns {void} Listener cleanup is handled by its matching detach/finish hook. */
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    controllers.add(controller);
    // Map iteration preserves insertion order; stable sort preserves ties without an overflowing sequence counter.
    /** Priority-sorted matching registrations; removed entries are skipped and new ones wait for the next snapshot. */
    const snapshot = [...entries.values()]
      .filter((entry) => entry.name === name)
      .sort((a, b) => a.priority - b.priority);
    /** Owned logical active/depth marker reset only by this dispatch finish. */
    const frame: Frame = { depth, active: true };
    /** Frozen signal-only handler context; no tenant, credentials or raw request data. */
    const context = Object.freeze({ signal: controller.signal });
    return {
      snapshot,
      frame,
      context,
      input,
      /** Reject observed dispatch cancellation with a fixed error, excluding caller-provided reasons.
       * @returns {void} Throws HOOK_ABORTED when the owned controller is aborted.
       */
      check() {
        if (controller.signal.aborted) {
          throw failure('HOOK_ABORTED');
        }
      },
      /** Mark logical nesting inactive and release this dispatch controller/listener after actual settlement.
       * @returns {void} Exact owned resources released without changing other dispatches.
       */
      finish() {
        frame.active = false;
        controllers.delete(controller);
        signal?.removeEventListener('abort', abort);
      },
    };
  }
  /** Invoke one stable snapshot synchronously, removing once handlers first. Misused returned thenables are observed but their started work cannot be undone or drained as approved async work.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {readonly unknown[]} args - Borrowed bounded positional values; objects are not cloned/frozen.
   * @param {ServerHookDispatch} settings - Optional borrowed caller cancellation signal; unknown options reject.
   * @returns {unknown} Final filter value or undefined action result; first failure stops later handlers.
   */
  function syncDispatch(
    name: string,
    args: readonly unknown[],
    settings: ServerHookDispatch = {}
  ): unknown {
    /** Owned dispatch frame/snapshot/input with exact check/finish cleanup. */
    const scope = start(name, args, settings);
    /** Bounded copied outer tuple; argument objects remain caller-owned references. */
    const input = scope.input;
    let value = input[0];
    try {
      return scopes.run(scope.frame, () => {
        // Honor the dispatch snapshot while skipping removed handlers and detaching once before invocation.
        for (const entry of scope.snapshot) {
          scope.check();
          if (!entry.active) {
            continue;
          }
          if (entry.once) {
            remove(entry);
          }
          /** Observed handler output; sync thenables reject, async outputs settle serially. */
          const result = entry.callback(
            scope.context,
            ...(filter ? [value, ...input.slice(1)] : input)
          );
          if (
            result &&
            typeof (
              result as {
                /** Structural thenable probe used to reject synchronous-contract misuse, not to execute a module. */
                then?: unknown;
              }
            ).then === 'function'
          ) {
            // Observe a rejected promise, but never pretend its already-started work was cancelled.
            void Promise.resolve(result).catch(() => {});
            throw failure('HOOK_ASYNC_IN_SYNC');
          }
          if (filter) {
            value = result;
          }
        }
        scope.check();
        return filter ? value : undefined;
      });
    } finally {
      scope.finish();
    }
  }
  /** Await handlers serially while retaining pending admission until actual native callback settlement.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {readonly unknown[]} args - Borrowed bounded positional values; objects are not cloned/frozen.
   * @param {ServerHookDispatch} settings - Optional borrowed caller cancellation signal; unknown options reject.
   * @returns {Promise<unknown>} Final filter value/action completion; original rejection wins even when cancellation is pending.
   */
  async function asyncDispatch(
    name: string,
    args: readonly unknown[],
    settings: ServerHookDispatch = {}
  ): Promise<unknown> {
    /** Owned dispatch frame/snapshot/input with exact check/finish cleanup. */
    const scope = start(name, args, settings);
    /** Bounded copied outer tuple; argument objects remain caller-owned references. */
    const input = scope.input;
    let value = input[0];
    /** Tracked serial async dispatch, never released early by a caller timeout. */
    const work = Promise.resolve().then(() =>
      scopes.run(scope.frame, async () => {
        // Honor the dispatch snapshot while skipping removed handlers and detaching once before invocation.
        for (const entry of scope.snapshot) {
          scope.check();
          if (!entry.active) {
            continue;
          }
          if (entry.once) {
            remove(entry);
          }
          /** Observed handler output; sync thenables reject, async outputs settle serially. */
          const result = await entry.callback(
            scope.context,
            ...(filter ? [value, ...input.slice(1)] : input)
          );
          scope.check();
          if (filter) {
            value = result;
          }
        }
        scope.check();
        return filter ? value : undefined;
      })
    );
    pending.add(work);
    try {
      return await work;
    } finally {
      pending.delete(work);
      scope.finish();
    }
  }
  return {
    register,
    dispatch: async ? asyncDispatch : syncDispatch,
    /** Idempotently stop admission, remove registrations/listeners and abort owned dispatch signals. Follow async disposal with whenIdle.
     * @returns {void} No forced cancellation of arbitrary handler promises or rollback of prior mutations.
     */
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      // Remove exact registration listeners while stopping all future admission.
      for (const entry of entries.values()) {
        remove(entry);
      }
      // Signal active dispatches without releasing their actual-settlement capacity early.
      for (const controller of controllers) {
        controller.abort();
      }
    },
    /** Drain the snapshot of actual approved async dispatch work; error handling remains on each dispatch promise.
     * @returns {Promise<void>} Actual tracked settlement; do not await this from inside its own handler or mistake it for sync-misuse cancellation.
     */
    async whenIdle() {
      await Promise.allSettled([...pending]);
    },
    /** Return only fixed resource/disposal counters, excluding names and private argument values.
     * @returns {object} Frozen disposed/handlers/pending observation.
     */
    getDiagnostics() {
      return Object.freeze({
        disposed,
        handlers: entries.size,
        pending: controllers.size,
      });
    },
  };
}
/** Public event-key map constrained to positional argument tuples. */
type EventMap<M> = { [K in keyof M]: readonly unknown[] };
/** Public filter-key map constrained to a nonempty value-plus-extras tuple. */
type FilterMap<M> = { [K in keyof M]: readonly [unknown, ...unknown[]] };
/** Only statically declared string event/filter keys. */
type Name<M> = Extract<keyof M, string>;
/** Extra filter arguments after the first same-type value member. */
type Rest<T extends readonly unknown[]> = T extends readonly [
  unknown,
  ...infer R,
]
  ? R
  : never;
/** Shared explicit dispose/drain/diagnostic contract for server registries. */
interface Lifetime {
  /** Idempotently stop admission, remove registrations/listeners and abort owned dispatch signals. Follow async disposal with whenIdle.
   * @returns {void} No forced cancellation of arbitrary handler promises or rollback of prior mutations.
   */
  dispose(): void;
  /** Drain the snapshot of actual approved async dispatch work; error handling remains on each dispatch promise.
   * @returns {Promise<void>} Actual tracked settlement; do not await this from inside its own handler or mistake it for sync-misuse cancellation.
   */
  whenIdle(): Promise<void>;
  /** Return only fixed resource/disposal counters, excluding names and private argument values.
   * @returns {object} Frozen disposed/handlers/pending observation.
   */
  getDiagnostics(): Readonly<{
    /** Whether explicit disposal has stopped registry admission. */
    disposed: boolean;
    /** Currently retained active registrations, without event-name labels. */
    handlers: number;
    /** Currently retained dispatch controllers, including sync nesting while active. */
    pending: number;
  }>;
}
/** Typed synchronous notifications with explicit registry disposal. */
export interface ServerActions<M extends EventMap<M>> extends Lifetime {
  /** Validate and register one exact callback with stable priority/insertion ordering. Once handlers detach before invocation; an already-aborted signal returns an inactive token.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {Function} callback - Borrowed explicitly registered handler, never source text or arbitrary package discovery.
   * @param {ServerHookRegistration | undefined} options - Optional priority/once/signal under this registry lifetime.
   * @returns {ServerHookToken} Frozen exact-registration token; the owner must still dispose/drain the registry.
   */
  register<K extends Name<M>>(
    name: K,
    callback: (context: ServerHookContext, ...args: M[K]) => void,
    options?: ServerHookRegistration
  ): ServerHookToken;
  /** Notify handlers under the declared sync or serial-async factory contract; side effects before failure are not rolled back.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {readonly unknown[]} args - Borrowed bounded positional values; objects are not cloned/frozen.
   * @param {ServerHookDispatch | undefined} options - Optional cooperative caller signal.
   * @returns {void | Promise<void>} Synchronous completion or actual async settlement, according to this interface.
   */
  dispatch<K extends Name<M>>(
    name: K,
    args: M[K],
    options?: ServerHookDispatch
  ): void;
}
/** Typed serial awaited notifications retaining actual-settlement capacity. */
export interface AsyncServerActions<M extends EventMap<M>> extends Lifetime {
  /** Validate and register one exact callback with stable priority/insertion ordering. Once handlers detach before invocation; an already-aborted signal returns an inactive token.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {Function} callback - Borrowed explicitly registered handler, never source text or arbitrary package discovery.
   * @param {ServerHookRegistration | undefined} options - Optional priority/once/signal under this registry lifetime.
   * @returns {ServerHookToken} Frozen exact-registration token; the owner must still dispose/drain the registry.
   */
  register<K extends Name<M>>(
    name: K,
    callback: (
      context: ServerHookContext,
      ...args: M[K]
    ) => void | Promise<void>,
    options?: ServerHookRegistration
  ): ServerHookToken;
  /** Notify handlers under the declared sync or serial-async factory contract; side effects before failure are not rolled back.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {readonly unknown[]} args - Borrowed bounded positional values; objects are not cloned/frozen.
   * @param {ServerHookDispatch | undefined} options - Optional cooperative caller signal.
   * @returns {void | Promise<void>} Synchronous completion or actual async settlement, according to this interface.
   */
  dispatch<K extends Name<M>>(
    name: K,
    args: M[K],
    options?: ServerHookDispatch
  ): Promise<void>;
}
/** Typed ordered synchronous transformations preserving the first tuple value type. */
export interface ServerFilters<M extends FilterMap<M>> extends Lifetime {
  /** Validate and register one exact callback with stable priority/insertion ordering. Once handlers detach before invocation; an already-aborted signal returns an inactive token.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {Function} callback - Borrowed explicitly registered handler, never source text or arbitrary package discovery.
   * @param {ServerHookRegistration | undefined} options - Optional priority/once/signal under this registry lifetime.
   * @returns {ServerHookToken} Frozen exact-registration token; the owner must still dispose/drain the registry.
   */
  register<K extends Name<M>>(
    name: K,
    callback: (context: ServerHookContext, ...args: M[K]) => M[K][0],
    options?: ServerHookRegistration
  ): ServerHookToken;
  /** Transform the declared first-tuple value with bounded unchanged extra arguments in priority order.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {M[K][0]} value - Borrowed initial value; filters preserve its declared type, including unions.
   * @param {Rest<M[K]>} args - Borrowed extra argument tuple, at most 31 values.
   * @param {ServerHookDispatch | undefined} options - Optional cooperative caller signal.
   * @returns {M[K][0] | Promise<M[K][0]>} Final same-type value under the declared sync/async interface; empty filters return input.
   */
  apply<K extends Name<M>>(
    name: K,
    value: M[K][0],
    args: Rest<M[K]>,
    options?: ServerHookDispatch
  ): M[K][0];
}
/** Typed serial awaited transformations preserving the declared first value type. */
export interface AsyncServerFilters<M extends FilterMap<M>> extends Lifetime {
  /** Validate and register one exact callback with stable priority/insertion ordering. Once handlers detach before invocation; an already-aborted signal returns an inactive token.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {Function} callback - Borrowed explicitly registered handler, never source text or arbitrary package discovery.
   * @param {ServerHookRegistration | undefined} options - Optional priority/once/signal under this registry lifetime.
   * @returns {ServerHookToken} Frozen exact-registration token; the owner must still dispose/drain the registry.
   */
  register<K extends Name<M>>(
    name: K,
    callback: (
      context: ServerHookContext,
      ...args: M[K]
    ) => M[K][0] | Promise<M[K][0]>,
    options?: ServerHookRegistration
  ): ServerHookToken;
  /** Transform the declared first-tuple value with bounded unchanged extra arguments in priority order.
   * @param {string} name - Validated explicit event/filter name; not an authorization scope.
   * @param {M[K][0]} value - Borrowed initial value; filters preserve its declared type, including unions.
   * @param {Rest<M[K]>} args - Borrowed extra argument tuple, at most 31 values.
   * @param {ServerHookDispatch | undefined} options - Optional cooperative caller signal.
   * @returns {M[K][0] | Promise<M[K][0]>} Final same-type value under the declared sync/async interface; empty filters return input.
   */
  apply<K extends Name<M>>(
    name: K,
    value: M[K][0],
    args: Rest<M[K]>,
    options?: ServerHookDispatch
  ): Promise<M[K][0]>;
}
/** Create an explicit synchronous action registry; normal callback return values are ignored.
 * @param {ServerHookLimits | undefined} options - Optional validated per-owner resource limits.
 * @returns {ServerActions<M>} Dispose owner; no automatic global/request registration.
 */
export function createServerActions<M extends EventMap<M>>(
  options?: ServerHookLimits
): ServerActions<M> {
  return engine(false, false, options) as ServerActions<M>;
}
/** Create an explicit serially awaited action registry with cooperative per-dispatch cancellation.
 * @param {ServerHookLimits | undefined} options - Optional validated per-owner resource limits.
 * @returns {AsyncServerActions<M>} Dispose then whenIdle owner; actual settlement retains capacity.
 */
export function createAsyncServerActions<M extends EventMap<M>>(
  options?: ServerHookLimits
): AsyncServerActions<M> {
  return engine(true, false, options) as AsyncServerActions<M>;
}
/** Create explicit ordered synchronous same-value-type transformations.
 * @param {ServerHookLimits | undefined} options - Optional validated per-owner resource limits.
 * @returns {ServerFilters<M>} Dispose owner with apply, deliberately without a public dispatch method.
 */
export function createServerFilters<M extends FilterMap<M>>(
  options?: ServerHookLimits
): ServerFilters<M> {
  /** Private engine dispatch separated from the public filter facade; no action method is exposed. */
  const { dispatch, ...registry } = engine(false, true, options);
  return {
    ...registry,
    apply: (name, value, args, settings) => {
      return dispatch(name, [value, ...copyArguments(args, 31)], settings);
    },
  } as ServerFilters<M>;
}
/** Create explicit serial async same-value-type transformations without implicit replay or cross-tenant sharing.
 * @param {ServerHookLimits | undefined} options - Optional validated per-owner resource limits.
 * @returns {AsyncServerFilters<M>} Dispose then whenIdle owner; extra argument objects remain borrowed.
 */
export function createAsyncServerFilters<M extends FilterMap<M>>(
  options?: ServerHookLimits
): AsyncServerFilters<M> {
  /** Private engine dispatch separated from the public filter facade; no action method is exposed. */
  const { dispatch, ...registry } = engine(true, true, options);
  return {
    ...registry,
    apply: async (name, value, args, settings) => {
      return dispatch(name, [value, ...copyArguments(args, 31)], settings);
    },
  } as AsyncServerFilters<M>;
}
