import { TestContext } from './context.js';
import type { TestFunction } from '../types/test.js';
/** Create deferred trusted test registration functions bound only to the supplied isolated context.
 * @param {TestContext} context - Borrowed registration owner; callbacks are not executed merely by creating this API.
 * @returns {object} Bound registration aliases; the context owner explicitly runs and clears them.
 */
export function createTestApi(context: TestContext) {
  /** Callable case registrar with explicit skip/only/table/options forms; table values remain ordinary callback arguments.
   * @param {string} name Public case label, excluding private values.
   * @param {TestFunction} fn Trusted deferred test callback.
   * @returns {void} Registers one case without executing it. */
  const test = Object.assign(
    (name: string, fn: TestFunction) => context.test(name, fn),
    {
      skip: (name: string, fn: TestFunction) => context.test(name, fn, true),
      only: (name: string, fn: TestFunction) =>
        context.test(name, fn, false, true),
      each:
        <T>(values: readonly T[]) =>
        (name: string, fn: (value: T) => unknown) => {
          values.forEach((value, i) =>
            context.test(name.replace(/%#/g, String(i)), () => fn(value))
          );
        },
      withOptions: (
        name: string,
        options: { timeoutMs?: number; retries?: number },
        fn: TestFunction
      ) => context.test(name, fn, false, false, options),
    }
  );
  return { test, it: test };
}
