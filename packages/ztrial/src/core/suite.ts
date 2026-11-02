import type { HookFunction } from '../types/test.js';
import { TestContext } from './context.js';
export function createSuiteApi(context: TestContext) {
  const describe = Object.assign((name: string, fn: () => void) => context.suite(name, fn), {
    skip: (name: string, fn: () => void) => context.suite(name, fn, true),
    only: (name: string, fn: () => void) => context.suite(name, fn, false, true)
  });
  return { describe, beforeAll: (fn: HookFunction) => context.hook('beforeAll', fn), afterAll: (fn: HookFunction) => context.hook('afterAll', fn), beforeEach: (fn: HookFunction) => context.hook('beforeEach', fn), afterEach: (fn: HookFunction) => context.hook('afterEach', fn) };
}
