import { readLintSource, writeLintSource } from './file-content.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverLintFiles } from './files.js';
import type { LintOptions, LintResult } from './types.js';

/** Lint literal stylesheet text with explicit, project or packaged configuration.
 * @param {LintOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {Promise<LintResult>} Aggregated stylesheet diagnostics and counts; parser failures keep ok false.
 * @throws {Error} Rejects for discovery/dependency/config/source/fix failures; malformed CSS becomes diagnostics.
 */
export async function runStylelint(
  options: LintOptions = {}
): Promise<LintResult> {
  /** Absolute trusted project root for stylesheet discovery and native configuration. */
  const cwd = path.resolve(options.cwd ?? process.cwd());
  /** Bounded discovered CSS/SCSS paths; other text types are not sent to Stylelint. */
  const files = discoverLintFiles(cwd, options).filter((file) =>
    /\.(?:css|scss)$/i.test(file)
  );
  /** Invocation-owned aggregate counters; parser failures cannot become a passing result. */
  const result: LintResult = {
    engine: 'stylelint',
    scanned: 0,
    errors: 0,
    warnings: 0,
    changed: 0,
    output: '',
    ok: true,
  };
  if (!files.length) {
    return result;
  }
  /** Installed stylesheet engine, loaded only when matching sources exist. */
  const { default: stylelint } = await import('stylelint');
  /** Caller-selected stylesheet config takes precedence over generic configFile. */
  const explicitConfig = options.cssConfigFile ?? options.configFile;
  /** Packaged CSS/SCSS standards used only when project config is genuinely absent. */
  const fallbackConfig = fileURLToPath(
    new URL('./stylelint.config.js', import.meta.url)
  );
  /** Collected source-addressable native stylesheet diagnostics. */
  const messages: string[] = [];
  // filename identifies one bounded stylesheet checked as literal text, never a glob.
  for (const filename of files) {
    /** Descriptor-bound stylesheet text; length is checked before native parsing. */
    const source = await readLintSource(filename);
    if (Buffer.byteLength(source) > 5 * 1024 * 1024) {
      throw new Error('Stylesheet exceeds 5 MiB');
    }
    let projectConfig: Awaited<ReturnType<typeof stylelint.resolveConfig>>;
    if (!explicitConfig) {
      try {
        projectConfig = await stylelint.resolveConfig(filename, { cwd });
      } catch (error) {
        // Stylelint 17 throws for a missing config; malformed project configs must still fail.
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 78 ||
          error.message !== `No configuration provided for ${filename}`
        ) {
          throw error;
        }
      }
    }
    let configuration:
      | { configFile: string }
      | { config: NonNullable<typeof projectConfig> };
    if (explicitConfig) {
      configuration = { configFile: path.resolve(cwd, explicitConfig) };
    } else if (projectConfig) {
      configuration = { config: projectConfig };
    } else {
      configuration = { configFile: fallbackConfig };
    }
    // Pass source text rather than file patterns: filenames are never glob expressions.
    /** Native lint result for literal source text, never a filename glob. */
    const checked = await stylelint.lint({
      cwd,
      code: source,
      codeFilename: filename,
      fix: options.fix ?? false,
      quiet: options.quiet ?? false,
      ...configuration,
    });
    let errors = 0;
    // row is a native result; ignored rows must not inflate scan counts.
    for (const row of checked.results) {
      if (row.ignored) {
        continue;
      }
      result.scanned++;
      // warning preserves native severity and location while contributing to aggregate counts.
      for (const warning of row.warnings) {
        if (warning.severity === 'error') {
          errors++;
        } else {
          result.warnings++;
        }
        messages.push(
          `${path.relative(cwd, filename)}:${warning.line ?? 0}:${warning.column ?? 0} ${warning.severity} ${warning.text}`
        );
      }
    }
    // Parser failures must remain failures even if the engine supplies no warning entries.
    result.errors += checked.errored ? Math.max(1, errors) : errors;
    if (
      options.fix &&
      typeof checked.code === 'string' &&
      checked.code !== source
    ) {
      // Recheck the target before applying only the explicitly requested fixes.
      await writeLintSource(filename, source, checked.code);
      result.changed++;
    }
  }
  result.output = messages.join('\n');
  result.ok = result.errors === 0;
  return result;
}
