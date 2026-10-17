import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverLintFiles } from './files.js';
import type { LintOptions, LintResult } from './types.js';

/**
 * Title: Lint CSS and SCSS with Stylelint.
 * Description: Lints bounded, explicitly discovered sources using project configs or the packaged CSS/SCSS standard configs. Plugins and custom syntaxes remain supported.
 * Global Variables: process.cwd(), import.meta.url and the project filesystem. Trusted Stylelint config/plugin modules may execute application code.
 * @param options Project directory, explicit files/directories, maximum file count, fixes and optional Stylelint config path.
 * @returns Stylelint diagnostics and lint counts; configuration and filesystem failures reject.
 */
export async function runStylelint(options: LintOptions = {}): Promise<LintResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const files = discoverLintFiles(cwd, options).filter(file => /\.(?:css|scss)$/i.test(file));
  const result: LintResult = { engine: 'stylelint', scanned: 0, errors: 0, warnings: 0, changed: 0, output: '', ok: true };
  if (!files.length) return result;
  const { default: stylelint } = await import('stylelint');
  const explicitConfig = options.cssConfigFile ?? options.configFile;
  const fallbackConfig = fileURLToPath(new URL('./stylelint.config.js', import.meta.url));
  const messages: string[] = [];
  for (const filename of files) {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) throw new Error('Unsafe or oversized stylesheet');
    const source = await fs.readFile(filename, 'utf8');
    if (Buffer.byteLength(source) > 5 * 1024 * 1024) throw new Error('Stylesheet exceeds 5 MiB');
    let projectConfig: Awaited<ReturnType<typeof stylelint.resolveConfig>>;
    if (!explicitConfig) {
      try { projectConfig = await stylelint.resolveConfig(filename, { cwd }); }
      catch (error) {
        // Stylelint 17 throws for a missing config; malformed project configs must still fail.
        if (!(error instanceof Error) || !('code' in error) || error.code !== 78 ||
          error.message !== `No configuration provided for ${filename}`) throw error;
      }
    }
    const configuration = explicitConfig
      ? { configFile: path.resolve(cwd, explicitConfig) }
      : projectConfig ? { config: projectConfig } : { configFile: fallbackConfig };
    // Pass source text rather than file patterns: filenames are never glob expressions.
    const checked = await stylelint.lint({ cwd, code: source, codeFilename: filename, fix: options.fix ?? false,
      quiet: options.quiet ?? false, ...configuration });
    let errors = 0;
    for (const row of checked.results) {
      if (row.ignored) continue;
      result.scanned++;
      for (const warning of row.warnings) {
        if (warning.severity === 'error') errors++;
        else result.warnings++;
        messages.push(`${path.relative(cwd, filename)}:${warning.line ?? 0}:${warning.column ?? 0} ${warning.severity} ${warning.text}`);
      }
    }
    // Parser failures must remain failures even if the engine supplies no warning entries.
    result.errors += checked.errored ? Math.max(1, errors) : errors;
    if (options.fix && typeof checked.code === 'string' && checked.code !== source) {
      // Recheck the target before applying only the explicitly requested fixes.
      const target = await fs.lstat(filename);
      if (!target.isFile() || target.isSymbolicLink()) throw new Error('Unsafe stylesheet fix target');
      await fs.writeFile(filename, checked.code, 'utf8');
      result.changed++;
    }
  }
  result.output = messages.join('\n');
  result.ok = result.errors === 0;
  return result;
}
