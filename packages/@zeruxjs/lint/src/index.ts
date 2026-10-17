import { runEslint } from './runner-eslint.js';
import { runStylelint } from './runner-stylelint.js';
import { runPrettier } from './runner-prettier.js';
import { watchFiles } from './watcher.js';
import type { LintOptions, LintResult, CombinedLintResult } from './types.js';

export { runEslint, runStylelint, runPrettier, watchFiles };
export { loadLintConfig } from './config-loader.js';
export { discoverLintFiles } from './files.js';
export type { LintOptions, LintResult, CombinedLintResult } from './types.js';
export async function lintJs(options: LintOptions = {}): Promise<LintResult> { return runEslint(options); }
/**
 * Title: Lint CSS.
 * Description: Checks CSS and SCSS through Stylelint and its configured plugins.
 * Global Variables: See runStylelint.
 * @param options CSS lint options.
 * @returns Stylelint diagnostics and lint counts.
 */
export async function lintCss(options: LintOptions = {}): Promise<LintResult> { return runStylelint(options); }
/**
 * Title: Run all source checks.
 * Description: Runs ESLint, Stylelint CSS/SCSS lint and Prettier checks concurrently.
 * Global Variables: Project filesystem and process state accessed by each runner.
 * @param options Shared lint options; cssConfigFile selects a separate Stylelint config.
 * @returns Combined engine results and error counts.
 */
export async function lintAll(options: LintOptions = {}): Promise<CombinedLintResult> {
  const results = await Promise.all([runEslint(options), runStylelint(options), runPrettier(options)]);
  return { results, ok: results.every(r => r.ok), errors: results.reduce((n, r) => n + r.errors, 0), warnings: results.reduce((n, r) => n + r.warnings, 0) };
}
export async function lint(options: LintOptions = {}): Promise<CombinedLintResult> { return lintAll(options); }
/** Returns an unsubscribe function; errors are sent to onError instead of killing the process. */
export async function watch(callback: () => Promise<void>, options: { cwd?: string; onError?: (error: Error) => void } = {}): Promise<() => void> {
  await callback();
  return watchFiles(callback, options);
}
