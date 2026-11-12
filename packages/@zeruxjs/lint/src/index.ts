import { runEslint } from './runner-eslint.js';
import { runStylelint } from './runner-stylelint.js';
import { runPrettier } from './runner-prettier.js';
import { watchFiles } from './watcher.js';
import type { LintOptions, LintResult, CombinedLintResult } from './types.js';

export { runEslint, runStylelint, runPrettier, watchFiles };
export { loadLintConfig } from './config-loader.js';
export { discoverLintFiles } from './files.js';
export type { LintOptions, LintResult, CombinedLintResult } from './types.js';
/** Run the JavaScript/TypeScript engine with explicit caller options.
 * @param {LintOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {Promise<LintResult>} ESLint counters, diagnostics and native fix candidates; engine/config failures reject.
 * @throws {Error} Rejects for native engine/config/read/write failures.
 */
export async function lintJs(options: LintOptions = {}): Promise<LintResult> {
  return runEslint(options);
}
/** Run CSS/SCSS checks through the owning Stylelint runner.
 * @param {LintOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {Promise<LintResult>} Stylelint counters and diagnostics for bounded CSS/SCSS source checks.
 * @throws {Error} Rejects for native engine/config/read/write failures.
 */
export async function lintCss(options: LintOptions = {}): Promise<LintResult> {
  return runStylelint(options);
}
/** Run the three engines concurrently and preserve each engine outcome.
 * @param {LintOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {Promise<CombinedLintResult>} Per-engine records plus combined counts; all results must pass for ok to be true.
 * @throws {Error} Rejects when any engine fails; other already-started native work is not force-cancelled.
 */
export async function lintAll(
  options: LintOptions = {}
): Promise<CombinedLintResult> {
  /** Concurrent engine outcomes; failures reject rather than invent a passing result. */
  const results = await Promise.all([
    runEslint(options),
    runStylelint(options),
    runPrettier(options),
  ]);
  return {
    results,
    ok: results.every((r) => r.ok),
    errors: results.reduce((n, r) => n + r.errors, 0),
    warnings: results.reduce((n, r) => n + r.warnings, 0),
  };
}
/** Compatibility alias for the combined lint operation.
 * @param {LintOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {Promise<CombinedLintResult>} The combined ESLint, Stylelint and Prettier record, preserving rejection behavior.
 * @throws {Error} Rejects on the same engine failures as lintAll.
 */
export async function lint(
  options: LintOptions = {}
): Promise<CombinedLintResult> {
  return lintAll(options);
}
/** Run an initial check, then register disposable serialized file observation.
 * @param {() => Promise<void>} callback - Host-owned async work; disposal cannot force-stop an already active callback.
 * @param {{ cwd?: string; onError?: (error: Error) => void }} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @param {string} [options.cwd] - Project watch directory; defaults to process.cwd().
 * @param {(error: Error) => void} [options.onError] - Host callback for subsequent watch/check failures; initial failures reject.
 * @returns {Promise<() => void>} Owned disposer; stops new observation but does not force-cancel active work.
 * @throws {Error} Rejects if the initial callback or watcher registration fails; later checks use onError.
 */
export async function watch(
  callback: () => Promise<void>,
  options: { cwd?: string; onError?: (error: Error) => void } = {}
): Promise<() => void> {
  await callback();
  return watchFiles(callback, options);
}

export {
  createDeprecationRegistry,
  builtInDeprecations,
} from './deprecations.js';
export type { DeprecatedApi } from './deprecations.js';
