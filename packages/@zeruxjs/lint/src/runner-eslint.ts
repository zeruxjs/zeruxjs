import path from 'node:path';
import type { LintOptions, LintResult } from './types.js';

/** Run the installed ESLint engine; project configuration/plugins are trusted executable code.
 * @param {LintOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {Promise<LintResult>} Native file/error/warning counters, formatted diagnostics and explicit fix outcomes.
 * @throws {Error} Rejects for dependency/config/engine/read/write failures; source is written only in explicit fix mode.
 */
export async function runEslint(
  options: LintOptions = {}
): Promise<LintResult> {
  /** Fixed installed engine name; callers cannot select arbitrary imported modules. */
  const moduleName = 'eslint';
  /** Installed engine constructor; executable project configs remain explicitly trusted. */
  const { ESLint } = (await import(moduleName)) as {
    ESLint: {
      new (settings: object): {
        lintFiles: (patterns: string[]) => Promise<
          Array<{
            errorCount: number;
            warningCount: number;
            filePath: string;
            output?: string;
          }>
        >;
        loadFormatter: (
          name: string
        ) => Promise<{ format: (results: unknown[]) => string }>;
      };
      outputFixes: (results: unknown[]) => Promise<void>;
    };
  };
  /** Absolute trusted project directory used for engine discovery and diagnostics. */
  const cwd = path.resolve(options.cwd ?? process.cwd());
  /** Invocation-owned lint engine configured for read-only checks unless fixes are explicit. */
  const eslint = new ESLint({
    cwd,
    fix: options.fix ?? false,
    overrideConfigFile: options.configFile,
  });
  /** Native engine diagnostics and optional fix output for the selected files. */
  const result = await eslint.lintFiles(
    options.files?.length
      ? options.files
      : ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx,vue}']
  );
  if (options.fix) {
    /** Native fix writer, invoked only after the caller explicitly enables fixes. */
    const fixOutput = ESLint.outputFixes;
    await fixOutput(result);
  }
  /** Native human-readable formatter; its output may contain local paths/source diagnostics. */
  const formatter = await eslint.loadFormatter('stylish');
  /** Aggregate native error count used to determine pass/fail status. */
  const errors = result.reduce((sum, row) => sum + row.errorCount, 0);
  /** Aggregate native warning count reported independently from errors. */
  const warnings = result.reduce((sum, row) => sum + row.warningCount, 0);
  return {
    engine: 'eslint',
    scanned: result.length,
    errors,
    warnings,
    changed: result.filter((row) => row.output !== undefined).length,
    output: formatter.format(result),
    ok: errors === 0,
  };
}
