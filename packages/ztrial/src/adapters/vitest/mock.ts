export interface MockFunction<
  TArgs extends unknown[] = unknown[],
  TResult = unknown,
> {
  (...args: TArgs): TResult;
  /** Mutable local call/result recording state; no bounded production retention is implied. */
  mock: {
    /** Shallow copied per-call argument lists, retaining nested trusted object references. */
    calls: TArgs[];
    /** Actual synchronous return/throw outcomes; promises remain borrowed return values. */
    results: Array<{
      /** Fixed return/throw outcome classification. */
      type: 'return' | 'throw';
      /** Actual trusted return or thrown value; may contain private data. */
      value: unknown;
    }>;
  };
  /** Replace only this local mock’s trusted callback implementation.
   * @param {(...args: TArgs) => TResult} fn - Explicit trusted replacement function, never a source string.
   * @returns {MockFunction<TArgs, TResult>} This same callable mock for chaining.
   */
  mockImplementation(
    fn: (...args: TArgs) => TResult
  ): MockFunction<TArgs, TResult>;
  /** Replace this local implementation with a trusted constant-return callback.
   * @param {TResult} value - Trusted returned value; object identity is preserved.
   * @returns {MockFunction<TArgs, TResult>} This same callable mock.
   */
  mockReturnValue(value: TResult): MockFunction<TArgs, TResult>;
  /** Release this mock’s retained call/result lists without changing its implementation.
   * @returns {void} Clears only this recorder; no other parallel runner’s spies are restored.
   */
  mockClear(): void;
}
/** Create a local trusted callback spy recording shallow argument lists and actual returns/throws; this is not a production bounded event store.
 * @param {(...args: TArgs) => TResult} impl - Optional trusted callback; the default returns undefined without side effects.
 * @returns {MockFunction<TArgs, TResult>} Callable local recorder with explicit reset/implementation methods; callers own retention and restoration.
 */
export function fn<TArgs extends unknown[] = unknown[], TResult = unknown>(
  impl?: (...args: TArgs) => TResult
): MockFunction<TArgs, TResult> {
  let current = impl ?? (() => undefined as TResult);
  /** Local retained shallow argument lists until mockClear; no cross-test global sweep. */
  const calls: TArgs[] = [];
  /** Local retained actual synchronous callback returns/throws until mockClear. */
  const results: Array<{
    /** Fixed return/throw outcome classification. */
    type: 'return' | 'throw';
    /** Actual trusted return or thrown value; may contain private data. */
    value: unknown;
  }> = [];
  /** Callable local spy invoking the explicitly trusted current implementation exactly once.
   * @param {TArgs} args Trusted supplied callback arguments.
   * @returns {TResult} Actual trusted implementation result, preserving thrown causes. */
  const mock = ((...args: TArgs) => {
    calls.push([...args] as TArgs);
    try {
      /** Actual synchronous implementation result; not serialized or redacted. */
      const value = current(...args);
      results.push({ type: 'return', value });
      return value;
    } catch (e) {
      results.push({ type: 'throw', value: e });
      throw e;
    }
  }) as MockFunction<TArgs, TResult>;
  mock.mock = { calls, results };
  mock.mockImplementation = (next) => {
    current = next;
    return mock;
  };
  mock.mockReturnValue = (v) => mock.mockImplementation(() => v);
  mock.mockClear = () => {
    calls.length = 0;
    results.length = 0;
  };
  return mock;
}
/** Legacy process-global active method restorers; parallel fixtures must use their own mockRestore handles. */
const restorers = new Set<() => void>();
/** Temporarily replace one trusted object method, recording calls while applying its original implementation to that object.
 * @param {T} obj - Trusted test-owned object; property reads may invoke its own getter.
 * @param {K} key - Explicit existing function-valued key.
 * @returns {MockFunction<unknown[], unknown> & { mockRestore(): void }} Owned restoration handle; register mockRestore on this test’s cleanup context.
 */
export function spyOn<T extends object, K extends keyof T>(obj: T, key: K) {
  /** Original own property descriptor, retained for exact restoration when present. */
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  /** Borrowed trusted original function read before temporary replacement. */
  const original = obj[key];
  if (typeof original !== 'function') {
    throw new TypeError(`Not a function: ${String(key)}`);
  }
  /** Owned local call recorder forwarding to the original method with its original object receiver. */
  const spy = fn<unknown[], unknown>((...args) =>
    (original as (...args: unknown[]) => unknown).apply(obj, args)
  );
  Object.defineProperty(obj, key, {
    configurable: true,
    writable: true,
    enumerable: descriptor?.enumerable ?? true,
    value: spy,
  });
  /** Restore the captured original descriptor, or remove the temporary own override when originally inherited.
   * @returns {void} Removes only this restorer from the legacy registry. */
  const restore = () => {
    if (descriptor) {
      Object.defineProperty(obj, key, descriptor);
    } else {
      delete (obj as Record<PropertyKey, unknown>)[key as PropertyKey];
    }
    restorers.delete(restore);
  };
  restorers.add(restore);
  return Object.assign(spy, { mockRestore: restore });
}
/** Restore the legacy process-global active spy set; scoped parallel tests should restore only their own handles instead.
 * @returns {void} Invokes retained restorers; no implicit per-runner isolation or timeout sweep is claimed.
 */
export function restoreAllMocks() {
  for (const restore of [...restorers]) {
    restore();
  }
}
