import { TestContext } from './core/context.js';
import { executeTests } from './core/runner.js';
import { createTestApi } from './core/test.js';
import { createSuiteApi } from './core/suite.js';
/** Legacy process-global registration owner; scoped createRunner avoids cross-project registration state. */
const defaultContext = new TestContext();
/** Compatibility aliases bound only to the legacy context. */
export const { test, it } = createTestApi(defaultContext);
/** Legacy suite/hook registrations; these do not execute callbacks on import. */
export const { describe, beforeAll, afterAll, beforeEach, afterEach } =
  createSuiteApi(defaultContext);
/** Clear only the legacy process-global registration context; scoped runners own independent registries.
 * @returns {void} Removes registrations without cancelling already-running callbacks or sweeping global mocks.
 */
export function clearTests() {
  defaultContext.clear();
}
/** Execute the legacy process-global registered tests under explicit runner policy; use createRunner for parallel project isolation.
 * @param {import('./types/test.js').RunOptions} options - Trusted match/retry/deadline/result-observer policy.
 * @returns {Promise<import('./types/test.js').RunSummary>} Actual normalized runner outcome; callback deadlines do not force-cancel arbitrary JavaScript.
 */
export function runTests(options: import('./types/test.js').RunOptions = {}) {
  return executeTests(defaultContext, options);
}
/** Create an independent inert test/suite registry without browser loading, network access or test execution.
 * @returns {object} Independent registration/clear/run API; callback resources require explicit execution-context cleanup.
 */
export function createRunner() {
  /** New isolated per-runner registration context; no callback executes during construction. */
  const context = new TestContext();
  return {
    ...createTestApi(context),
    ...createSuiteApi(context),
    clearTests: () => context.clear(),
    runTests: (options: import('./types/test.js').RunOptions = {}) =>
      executeTests(context, options),
  };
}
export { expect } from './assert/expect.js';
export { waitFor } from './utils/wait.js';
export { fn, spyOn, restoreAllMocks } from './adapters/vitest/mock.js';
export { defineConfig, validateConfig } from './config/index.js';
export type * from './types/index.js';

export * from './http/index.js';

export {
  EnvironmentUnavailableError,
  IntentionalSkipError,
  skipTest,
  normalizeResults,
} from './results.js';
export {
  normalizeV8Coverage,
  mergeCoverage,
  summarizeCoverage,
} from './coverage.js';
export type {
  CoverageRecord,
  CoverageRange,
  V8SourceCoverage,
} from './coverage.js';

export * from './reports/index.js';
export type { NormalizedResultRecord } from './results.js';
