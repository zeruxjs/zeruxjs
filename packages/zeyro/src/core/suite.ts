import { TestContext } from './context.js';
export function createSuiteApi(context: TestContext) {
  const describe = Object.assign((name: string, fn: () => void) => context.suite(name, fn), {
    skip: (name: string, fn: () => void) => context.suite(name, fn, true),
    only: (name: string, fn: () => void) => context.suite(name, fn, false, true)
  });
  return { describe, beforeAll: (fn: () => unknown) => context.hook('beforeAll', fn), afterAll: (fn: () => unknown) => context.hook('afterAll', fn), beforeEach: (fn: () => unknown) => context.hook('beforeEach', fn), afterEach: (fn: () => unknown) => context.hook('afterEach', fn) };
}
