import type { HookFunction } from '../types/test.js';
import { TestContext } from './context.js';
/** Create synchronous trusted suite/hook registration functions bound only to the supplied isolated context.
 * @param {TestContext} context - Borrowed registration owner; callbacks are not executed merely by creating this API.
 * @returns {object} Bound registration aliases; the context owner explicitly runs and clears them.
 */
export function createSuiteApi(context: TestContext) {
  /** Callable synchronous suite registrar with explicit inherited skip/only forms.
   * @param {string} name Public suite label, excluding private values.
   * @param {() => void} fn Trusted synchronous declaration callback.
   * @returns {void} Registers nested cases/hooks while restoring the prior suite stack. */
  const describe = Object.assign(
    (name: string, fn: () => void) => context.suite(name, fn),
    {
      skip: (name: string, fn: () => void) => context.suite(name, fn, true),
      only: (name: string, fn: () => void) =>
        context.suite(name, fn, false, true),
    }
  );
  return {
    describe,
    beforeAll: (fn: HookFunction) => context.hook('beforeAll', fn),
    afterAll: (fn: HookFunction) => context.hook('afterAll', fn),
    beforeEach: (fn: HookFunction) => context.hook('beforeEach', fn),
    afterEach: (fn: HookFunction) => context.hook('afterEach', fn),
  };
}
