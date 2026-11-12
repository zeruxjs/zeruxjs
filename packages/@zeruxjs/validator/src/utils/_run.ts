import type { BaseIssue, Config, ParseEvent } from '../types/index.js';
import { getGlobalConfig } from '../storages/globalConfig.js';

type Runnable = {
  readonly async: boolean;
  readonly kind?: string;
  readonly type?: string;
  readonly '~run': (...args: any[]) => any;
};
/** Private module symbol binds nested work to one root parse without a global request registry. */
const runtime = Symbol('validator.parse');
type RunConfig = Config<any> & { [runtime]: { state: State; depth: number } };

/** A hard execution/input budget was exceeded; never a successful partial parse. */
export class ValidationLimitError extends Error {
  /** Represent a hard budget exhaustion, never a successful partial parse.
   * @param {string} code - Fixed limit category identifying the exhausted budget.
   * @param {number} limit - Configured hard ceiling associated with this failure.
   */
  constructor(
    readonly code: string,
    readonly limit: number
  ) {
    super(`Validation limit exceeded: ${code} (${limit})`);
    this.name = 'ValidationLimitError';
  }
}
/** Sync entry points encountered an async node or callback. */
export class AsyncValidationError extends TypeError {
  /** Represent explicit async misuse in a synchronous schema/action/parse path.
   */
  constructor() {
    super(
      'Async validation requires an explicitly async schema/action and parseAsync or safeParseAsync'
    );
    this.name = 'AsyncValidationError';
  }
}
/** Notification failure; cause remains trusted application-side diagnostic data. */
export class ValidationHookError extends Error {
  /** Represent synchronous hook failure while keeping underlying diagnostics private.
   * @param {unknown} cause - Private hook exception or aggregate original/hook failure cause.
   */
  constructor(cause: unknown) {
    super('Validation event hook failed', { cause });
    this.name = 'ValidationHookError';
  }
}

/** Reject thenables in synchronous callback paths while observing their rejection. Work executed before a callback returns cannot be undone.
 * @param {T} value - Trusted callback result that must be immediately synchronous.
 * @returns {T} Unchanged synchronous result; thenable misuse throws AsyncValidationError.
 */
export function syncValue<T>(value: T): T {
  if (value && typeof (value as any).then === 'function') {
    void Promise.resolve(value).catch(() => {});
    throw new AsyncValidationError();
  }
  return value;
}

/** Reject native async callbacks before invocation in sync paths, then reject any returned thenable. Trusted callback exceptions retain operational meaning.
 * @param {(input: TInput) => TOutput} callback - Trusted explicitly synchronous callback; no sandbox or rollback is implied.
 * @param {TInput} input - Current declared callback input.
 * @returns {TOutput} Immediate synchronous output; async misuse throws before any result is accepted.
 */
export function syncCallback<TInput, TOutput>(
  callback: (input: TInput) => TOutput,
  input: TInput
): TOutput {
  if (callback.constructor.name === 'AsyncFunction') {
    throw new AsyncValidationError();
  }
  return syncValue(callback(input));
}

/** Internal root-owned execution state; never a process-global or cross-tenant queue. */
class State {
  /** Cumulative schema/action/callback work counter, separate from the input scan counter.  */
  nodes = 0;
  /** Cumulative generated/reused issue count across all attempted branches.  */
  issues = 0;
  /** Currently executing built-in async leaf callbacks; containers never occupy these slots.  */
  active = 0;
  /** Whether one operational failure has been recorded; subsequent work must reject.  */
  failed = false;
  /** First private operational failure retained for propagation, never default logging.  */
  failure: unknown;
  /** Actual callback/container promises retained through settlement even after cancellation.  */
  readonly pending = new Set<Promise<unknown>>();
  /** Owned FIFO leaf-slot waiters awakened on release or failure drain.  */
  readonly waiting: (() => void)[] = [];
  /** Owned cooperative parse signal shared with built-in async callback contexts.  */
  readonly controller = new AbortController();
  /** Independent validated default/override limits for this root execution.  */
  readonly limits: Record<
    | 'maxDepth'
    | 'maxNodes'
    | 'maxCollectionSize'
    | 'maxIssues'
    | 'maxConcurrency',
    number
  >;
  /** Owned external abort listener recording fixed-name cancellation; removed by dispose.
   * @returns {void} Records initiating cancellation without exposing its private cause.
   */
  readonly abort = () => this.stop(this.abortError(this.external?.reason));
  /** Own one root parse’s counters, queue, cooperative cancellation and abort listener. The execution wrapper disposes/drains it before notification.
   * @param {boolean} sync - True rejects asynchronous schema/action execution.
   * @param {AbortSignal | undefined} external - Optional borrowed initiating signal; listener removal belongs to dispose.
   * @param {Config<any>} config - Validated root/default configuration used to snapshot finite budgets.
   */
  constructor(
    readonly sync: boolean,
    readonly external: AbortSignal | undefined,
    config: Config<any>
  ) {
    /** Documented default per-parse budgets, copied independently for each execution. */
    const defaults = {
      maxDepth: 64,
      maxNodes: 10000,
      maxCollectionSize: 1000,
      maxIssues: 100,
      maxConcurrency: 8,
    };
    /** Fixed hard implementation caps; caller options may narrow but never exceed them. */
    const ceilings = {
      maxDepth: 128,
      maxNodes: 100000,
      maxCollectionSize: 10000,
      maxIssues: 1000,
      maxConcurrency: 32,
    };
    this.limits = { ...defaults };
    // Validate every budget before registering the external abort listener.
    for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
      /** Selected candidate budget or current traversal value; validated before schema execution. */
      const value = config[key] === undefined ? defaults[key] : config[key];
      if (!Number.isSafeInteger(value) || value < 1 || value > ceilings[key]) {
        throw new TypeError(`${key} must be an integer in 1..${ceilings[key]}`);
      }
      this.limits[key] = value;
    }
    external?.addEventListener('abort', this.abort, { once: true });
    if (external?.aborted) {
      this.abort();
    }
  }
  /** Create a fixed-name cancellation error with a private initiating cause.
   * @param {unknown} cause - Underlying private cancellation reason.
   * @returns {Error} AbortError-named Error whose cause is never included in default notifications.
   */
  abortError(cause: unknown) {
    /** Private cancellation error whose public class/name is fixed and underlying reason stays in cause. */
    const error = new Error('Validation cancelled', { cause });
    error.name = 'AbortError';
    return error;
  }
  /** Retain the first operational failure and cooperatively abort started/queued work.
   * @param {unknown} error - First private operational failure or cancellation.
   * @returns {void} Records only the first failure; it does not force-stop arbitrary JavaScript.
   */
  stop(error: unknown) {
    if (!this.failed) {
      this.failed = true;
      this.failure = error;
      this.controller.abort(error);
    }
  }
  /** Reject work immediately after the parse records its first failure.
   * @returns {void} Completes only while the parse remains active.
   */
  check() {
    if (this.failed) {
      throw this.failure;
    }
  }
  /** Remove the one borrowed external abort listener after synchronous execution or async drain.
   * @returns {void} Releases listener ownership; it does not itself wait for callbacks.
   */
  dispose() {
    this.external?.removeEventListener('abort', this.abort);
  }
  /** Retain actual native callback settlement and record its first failure.
   * @param {Promise<T>} promise - Actual callback/container promise owned by this parse.
   * @returns {Promise<T>} The same promise; settlement removes it from the retained set.
   */
  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      (error) => {
        this.pending.delete(promise);
        this.stop(error);
      }
    );
    return promise;
  }
  /** Wait for one bounded async leaf slot, then recheck failure before invoking trusted code.
   * @param {() => T | Promise<T>} operation - Trusted cooperative refinement/transformation; containers never acquire these slots.
   * @returns {Promise<T>} Actual callback settlement; finally releases one slot and wakes a queued leaf.
   */
  async leaf<T>(operation: () => T | Promise<T>): Promise<T> {
    // Containers remain outside this gate so nested child work cannot deadlock.
    while (this.active >= this.limits.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.check();
    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
  /** Wake queued leaves to observe failure and await every actual started settlement.
   * @returns {Promise<void>} Completes only after tracked work settles; noncooperative callbacks may delay cleanup.
   */
  async drain() {
    // Wake queued work after failure so it rejects without invoking callbacks.
    for (const wake of this.waiting.splice(0)) {
      wake();
    }
    // New tracked descendants may appear while an existing container settles.
    while (this.pending.size) {
      await Promise.allSettled([...this.pending]);
    }
  }
}

/** Determine bounded container size without treating string length as schema collection work.
 * @param {unknown} value - Candidate input/container metadata checked by the caller.
 * @returns {number} Array/string length, map/set size, own object-key count or zero for scalars.
 */
function collectionSize(value: unknown): number {
  if (Array.isArray(value) || typeof value === 'string') {
    return value.length;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size;
  }
  return value && typeof value === 'object' ? Object.keys(value).length : 0;
}

/** Iteratively bound even unknown/any input before schema dispatch, rejecting cycles and enumerable accessors without invoking them. Trusted custom callbacks remain outside this data traversal guarantee.
 * @param {unknown} input - Candidate input graph; structural validation is not a deep clone.
 * @param {State} state - Owned per-parse limits, cancellation and failure context.
 * @returns {void} Completes only within input depth/node/collection limits; exhaustion never yields partial success.
 */
function inspectInput(input: unknown, state: State) {
  /** Bounded explicit traversal work list; no recursive call-stack dependence. */
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [
    { value: input, depth: 0 },
  ];
  /** Ancestor-only object set detects cycles while permitting repeated acyclic references. */
  const active = new WeakSet<object>();
  let nodes = 0;
  // Bound all queued traversal work before accepting another node/issue.
  while (stack.length) {
    state.check();
    /** Current explicit traversal frame; exit frames release the ancestor-cycle marker. */
    const { value, depth, exit } = stack.pop()!;
    if (exit) {
      active.delete(value as object);
      continue;
    }
    if (++nodes > state.limits.maxNodes) {
      throw new ValidationLimitError('max_nodes', state.limits.maxNodes);
    }
    if (depth > state.limits.maxDepth) {
      throw new ValidationLimitError('max_depth', state.limits.maxDepth);
    }
    // Strings are scalar values; HTTP byte limits and maxLength own their size.
    if (typeof value === 'string') {
      continue;
    }
    if (collectionSize(value) > state.limits.maxCollectionSize) {
      throw new ValidationLimitError(
        'max_collection_size',
        state.limits.maxCollectionSize
      );
    }
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (active.has(value)) {
      throw new ValidationLimitError('cyclic_input', 0);
    }
    active.add(value);
    stack.push({ value, depth, exit: true });
    let children: unknown[];
    if (value instanceof Map) {
      children = [...value].flatMap(([key, item]) => [key, item]);
    } else if (value instanceof Set) {
      children = [...value];
    } else {
      children = Object.keys(value).map((key) => {
        /** Own enumerable property descriptor inspected before reading its value. */
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in descriptor)) {
          throw new ValidationLimitError('accessor_input', 0);
        }
        return descriptor.value;
      });
    }
    // Reverse pushes preserve deterministic depth-first child order without recursion.
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({ value: children[index], depth: depth + 1 });
    }
  }
}

/** Dispatch one schema/action under shared per-parse budgets while preserving its declared output. Gate only async leaves so a container cannot deadlock waiting for children behind its own slot.
 * @param {T} schema - Trusted declared runnable schema/action; private ~run is not a standalone safety boundary.
 * @param {any} dataset - Current internal typed/issues/value dataset.
 * @param {Config<any>} config - Root-derived configuration carrying the private owned parse context.
 * @returns {ReturnType<T['~run']>} Declared native result with budget/async checks; started async work remains tracked through settlement.
 */
export function _runSchema<T extends Runnable>(
  schema: T,
  dataset: any,
  config: Config<any>
): ReturnType<T['~run']> {
  /** Private root-owned state/depth carrier; absent context preserves compatible direct internal dispatch. */
  const context = (config as RunConfig)[runtime];
  if (!context) {
    return schema['~run'](dataset, config);
  }
  /** Shared owned parse state plus this nested schema depth, never a new global scope. */
  const { state, depth } = context;
  state.check();
  if (
    'entries' in schema &&
    schema.entries &&
    typeof schema.entries === 'object'
  ) {
    /** Declared own schema fields checked before any schema callback executes. */
    const keys = Object.keys(schema.entries);
    if (keys.length > state.limits.maxCollectionSize) {
      throw new ValidationLimitError(
        'max_collection_size',
        state.limits.maxCollectionSize
      );
    }
    if (
      keys.some((key) =>
        ['__proto__', 'prototype', 'constructor'].includes(key)
      )
    ) {
      throw new TypeError('Unsafe object schema key');
    }
  }
  if (state.sync && schema.async) {
    throw new AsyncValidationError();
  }
  if (++state.nodes > state.limits.maxNodes) {
    throw new ValidationLimitError('max_nodes', state.limits.maxNodes);
  }
  if (depth > state.limits.maxDepth) {
    throw new ValidationLimitError('max_depth', state.limits.maxDepth);
  }
  if (
    typeof dataset.value !== 'string' &&
    collectionSize(dataset.value) > state.limits.maxCollectionSize
  ) {
    throw new ValidationLimitError(
      'max_collection_size',
      state.limits.maxCollectionSize
    );
  }
  /** Independent nested config increments depth while sharing root counters/cancellation. */
  const child = { ...config, [runtime]: { state, depth: depth + 1 } };
  /** Trusted runnable invocation checks first failure immediately before entering callback code.
   * @returns {any} Declared native runnable dataset; generic dispatch preserves its public return contract.
   */
  const invoke = () => {
    state.check();
    return schema['~run'](dataset, child);
  };
  if (!schema.async) {
    /** Immediate synchronous dataset accepted only after thenable and failure checks. */
    const result = syncValue(invoke());
    state.check();
    return result;
  }
  // Gate only leaf validators/transformations. Gating containers would deadlock
  // when a container held a slot while waiting for its own nested children.
  /** Actual async leaf/container work tracked until settlement; containers do not hold leaf slots. */
  const promise =
    (schema.kind !== 'schema' && schema.type !== 'check_items') ||
    schema.type === 'custom'
      ? state.leaf(invoke)
      : Promise.resolve().then(invoke);
  return state.track(
    promise.then((result) => {
      state.check();
      return result;
    })
  ) as ReturnType<T['~run']>;
}

/** Prevent explicit signal/budget-controlled parses from borrowing cached work owned by a different parse. Legacy default-cache identity behavior remains compatible.
 * @param {Config<any>} config - Current parse configuration and optional private context.
 * @returns {boolean} Whether explicit signal or limit controls require skipping cache reuse.
 */
export function bypassCache(config: Config<any>): boolean {
  /** Root-owned context selected from current config; no global per-user mutable state. */
  const state = (config as RunConfig)[runtime]?.state;
  return (
    !!state?.external ||
    [
      'maxDepth',
      'maxNodes',
      'maxCollectionSize',
      'maxIssues',
      'maxConcurrency',
    ].some((key) => (config as any)[key] !== undefined)
  );
}

/** Schedule one built-in per-item asynchronous leaf without occupying a container slot. Existing parse context owns cumulative work, cancellation and drain.
 * @param {Config<any>} config - Current root-derived parse configuration.
 * @param {() => T | Promise<T>} operation - Trusted cooperative callback whose actual promise must settle for cleanup.
 * @returns {Promise<T>} Tracked leaf result; missing private context preserves compatible direct execution.
 */
export function _asyncCallback<T>(
  config: Config<any>,
  operation: () => T | Promise<T>
): Promise<T> {
  /** Root-owned context selected from current config; no global per-user mutable state. */
  const state = (config as RunConfig)[runtime]?.state;
  if (!state) {
    return Promise.resolve().then(operation);
  }
  state.check();
  if (++state.nodes > state.limits.maxNodes) {
    throw new ValidationLimitError('max_nodes', state.limits.maxNodes);
  }
  return state.track(state.leaf(operation));
}

/** Charge every cached nested issue to the receiving parse before issue reuse/cloning. Speculative union work is not free.
 * @param {Config<any>} config - Receiving parse configuration with optional owned context.
 * @param {readonly BaseIssue<unknown>[] | undefined} issues - Optional cached issue tree; private rejected values are not logged here.
 * @returns {void} Completes within the receiving issue budget or throws before accepting partial success.
 */
export function consumeCachedIssues(
  config: Config<any>,
  issues: readonly BaseIssue<unknown>[] | undefined
) {
  if (!issues) {
    return;
  }
  /** Bounded explicit traversal work list; no recursive call-stack dependence. */
  const stack = [...issues];
  while (stack.length) {
    /** One cached nested issue charged against the receiving parse budget. */
    const issue = stack.pop()!;
    countIssue(config);
    if (issue.issues) {
      stack.push(...issue.issues);
    }
  }
}

/** Charge one generated/reused issue across actions and branches before allocating another.
 * @param {Config<any>} config - Current parse configuration carrying its owned cumulative counter.
 * @returns {void} Completes unless the hard per-parse issue ceiling is exceeded.
 */
export function countIssue(config: Config<any>) {
  /** Root-owned context selected from current config; no global per-user mutable state. */
  const state = (config as RunConfig)[runtime]?.state;
  if (state && ++state.issues > state.limits.maxIssues) {
    throw new ValidationLimitError('max_issues', state.limits.maxIssues);
  }
}

/** Validate caller controls and snapshot legacy defaults before allocating owned per-parse state. Global config never retains request hooks or signals.
 * @param {Config<any> | undefined} config - Optional trusted root parse configuration with validated callback/flag types.
 * @param {boolean} sync - True for synchronous execution; false permits explicit async schemas/actions.
 * @returns {object} Owned state and private root configuration; the caller must dispose/drain according to execution mode.
 */
function prepare(config: Config<any> | undefined, sync: boolean) {
  if (
    config !== undefined &&
    (!config || typeof config !== 'object' || Array.isArray(config))
  ) {
    throw new TypeError('config must be an object');
  }
  // Validate per-call hook types without placing callbacks in global storage.
  for (const key of ['onSuccess', 'onError'] as const) {
    if (config?.[key] !== undefined && typeof config[key] !== 'function') {
      throw new TypeError(`${key} must be a function`);
    }
  }
  // Only explicit Boolean abort flags are accepted; truthiness is not policy.
  for (const key of ['abortEarly', 'abortPipeEarly'] as const) {
    if (config?.[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new TypeError(`${key} must be boolean`);
    }
  }
  if (config?.signal !== undefined && !(config.signal instanceof AbortSignal)) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (
    config?.message !== undefined &&
    !['string', 'function'].includes(typeof config.message)
  ) {
    throw new TypeError('message must be a string or function');
  }
  if (config?.lang !== undefined && typeof config.lang !== 'string') {
    throw new TypeError('lang must be a string');
  }
  /** Fresh caller/default config merge; only legacy flags can come from process-wide storage. */
  const merged = getGlobalConfig(config);
  /** Root-owned context selected from current config; no global per-user mutable state. */
  const state = new State(sync, config?.signal, merged);
  /** Private root config with the owned combined signal and shared depth/counters. */
  const runConfig: RunConfig = {
    ...merged,
    signal: state.controller.signal,
    [runtime]: { state, depth: 0 },
  };
  return { state, runConfig };
}

/** Emit one synchronous value-free parse notification only after execution cleanup. Hook exceptions are explicit and do not trigger a second error notification after a failed success hook.
 * @param {Config<any> | undefined} config - Caller-owned root config; hooks are never copied into global storage.
 * @param {any} dataset - Observed execution result, possibly absent on operational failure.
 * @param {unknown} error - Private operational failure retained only as a hook-error cause.
 * @param {boolean} failed - Whether execution failed operationally; defaults false, independent of ordinary schema issues.
 * @returns {void} Runs at most the selected hook; returned thenables/throws become ValidationHookError.
 */
function notify(
  config: Config<any> | undefined,
  dataset: any,
  error?: unknown,
  failed = false
) {
  /** Issue-free execution classification, independent of operational failure causes. */
  const success = !failed && !dataset.issues;
  /** At most one caller-owned synchronous success/error notification. */
  const hook = success ? config?.onSuccess : config?.onError;
  if (!hook) {
    return;
  }
  /** Value-free notification of fixed failure classes, issue codes and redacted paths. */
  const event: ParseEvent = {
    success,
    ...(!success
      ? {
          // Classify fixed public outcomes while leaving underlying causes private.
          failure: (() => {
            if (failed) {
              if (error instanceof ValidationLimitError) {
                return 'limit' as const;
              }
              if ((error as Error)?.name === 'AbortError') {
                return 'cancelled' as const;
              }
              return 'exception' as const;
            }
            return 'validation' as const;
          })(),
        }
      : {}),
    issues: (dataset?.issues ?? []).map((issue: BaseIssue<unknown>) => ({
      code: issue.code ?? `${issue.kind}.${issue.type}`,
      path: (issue.path ?? []).map((item) =>
        item.type === 'array' && typeof item.key === 'number'
          ? item.key
          : '<field>'
      ),
    })),
  };
  try {
    syncValue(hook(event));
  } catch (hookError) {
    throw new ValidationHookError(failed ? { error, hookError } : hookError);
  }
}

/** Own one root synchronous parse with shared nested budgets and no global state retention. Dispose the initiating abort listener before any notification or returned dataset.
 * @param {T} schema - Trusted explicitly synchronous runnable schema.
 * @param {unknown} input - Candidate input scanned within per-call limits before dispatch.
 * @param {Config<any>} config - Optional caller-owned root controls/hooks and cancellation signal.
 * @returns {ReturnType<T['~run']>} Completed internal dataset; budget/operational/async failures throw, never partial success.
 */
export function executeSchema<T extends Runnable>(
  schema: T,
  input: unknown,
  config?: Config<any>
): ReturnType<T['~run']> {
  /** One newly owned root execution state/config, disposed or drained before notifying. */
  const { state, runConfig } = prepare(config, true);
  let dataset: any;
  let failed = false;
  let error: unknown;
  try {
    inspectInput(input, state);
    dataset = _runSchema(schema, { value: input }, runConfig);
  } catch (cause) {
    failed = true;
    error = cause;
  } finally {
    state.dispose();
  }
  notify(config, dataset, error, failed);
  if (failed) {
    throw error;
  }
  return dataset;
}

/** Own one root asynchronous parse, stop queued callbacks after failure and drain all started work before removing its listener or notifying. Noncooperative trusted callbacks may delay settlement.
 * @param {T} schema - Trusted declared runnable schema with explicit async support.
 * @param {unknown} input - Candidate graph scanned within per-call limits before dispatch.
 * @param {Config<any>} config - Optional per-call controls, signal and synchronous value-free hooks.
 * @returns {Promise<Awaited<ReturnType<T['~run']>>>} Completed dataset after actual cleanup, or original operational/cancellation failure.
 */
export async function executeSchemaAsync<T extends Runnable>(
  schema: T,
  input: unknown,
  config?: Config<any>
): Promise<Awaited<ReturnType<T['~run']>>> {
  /** One newly owned root execution state/config, disposed or drained before notifying. */
  const { state, runConfig } = prepare(config, false);
  let dataset: any;
  let failed = false;
  let error: unknown;
  try {
    inspectInput(input, state);
    dataset = await _runSchema(schema, { value: input }, runConfig);
    state.check();
  } catch (cause) {
    state.stop(cause);
    failed = true;
    error = state.failure;
  } finally {
    await state.drain();
    state.dispose();
  }
  notify(config, dataset, error, failed);
  if (failed) {
    throw error;
  }
  return dataset;
}
