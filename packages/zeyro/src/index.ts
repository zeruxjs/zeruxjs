import { TestContext } from './core/context.js';
import { executeTests } from './core/runner.js';
import { createTestApi } from './core/test.js';
import { createSuiteApi } from './core/suite.js';
const defaultContext = new TestContext();
export const { test, it } = createTestApi(defaultContext);
export const { describe, beforeAll, afterAll, beforeEach, afterEach } = createSuiteApi(defaultContext);
export function clearTests() { defaultContext.clear(); }
export function runTests(options: import('./types/test.js').RunOptions = {}) { return executeTests(defaultContext,options); }
export function createRunner() {
  const context = new TestContext();
  return { ...createTestApi(context), ...createSuiteApi(context), clearTests: () => context.clear(), runTests: (options: import('./types/test.js').RunOptions = {}) => executeTests(context,options) };
}
export { expect } from './assert/expect.js';
export { waitFor } from './utils/wait.js';
export { fn, spyOn, restoreAllMocks } from './adapters/vitest/mock.js';
export { defineConfig, validateConfig } from './config/index.js';
export type * from './types/index.js';
