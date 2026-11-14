import {
  readLintSource,
  writeLintSource,
  LintSourceLimitError,
} from './file-content.js';
import path from 'node:path';
import { discoverLintFiles } from './files.js';
import type { LintOptions, LintResult } from './types.js';

/** Check bounded text sources, writing only explicitly requested and revision-checked fixes.
 * @param {LintOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {Promise<LintResult>} Formatting differences and parse failures; changed counts candidates in check mode.
 * @throws {Error} Rejects for discovery/config/read/write failures; formatting syntax failures become diagnostics.
 */
export async function runPrettier(
  options: LintOptions = {}
): Promise<LintResult> {
  /** Fixed installed formatter dependency; no caller-supplied module is evaluated. */
  const moduleName = 'prettier';
  /** Installed formatter API; project configuration remains trusted executable code. */
  const prettier = (await import(moduleName)) as {
    resolveConfig: (file: string) => Promise<object | null>;
    getFileInfo: (
      file: string,
      options?: object
    ) => Promise<{ ignored: boolean; inferredParser?: string | null }>;
    format: (source: string, options: object) => Promise<string>;
  };
  /** Absolute project root for discovery, ignore files and relative diagnostic labels. */
  const cwd = path.resolve(options.cwd ?? process.cwd());
  /** Bounded discovered source paths, excluding symlinks and generated directories. */
  const files = discoverLintFiles(cwd, options);
  let scanned = 0,
    errors = 0,
    changed = 0;
  /** Invocation-owned formatting diagnostics; ordinary checks never write source. */
  const messages: string[] = [];
  // filename is a discovered regular input; unsupported/ignored/oversized sources stay skipped.
  for (const filename of files) {
    /** Formatter ignore/parser result used to skip unsupported or excluded sources. */
    const info = await prettier.getFileInfo(filename, {
      ignorePath: path.join(cwd, '.prettierignore'),
      resolveConfig: true,
    });
    if (info.ignored || !info.inferredParser) {
      continue;
    }
    let content: string;
    try {
      content = await readLintSource(filename);
    } catch (error) {
      if (error instanceof LintSourceLimitError) {
        messages.push(
          `Skipped oversized file: ${path.relative(cwd, filename)}`
        );
        continue;
      }
      throw error;
    }
    /** Resolved trusted formatter options; file-specific parser selection remains native. */
    const config = (await prettier.resolveConfig(filename)) ?? {};
    let formatted: string;
    try {
      formatted = await prettier.format(content, {
        ...config,
        filepath: filename,
      });
    } catch (error) {
      errors++;
      messages.push(`${path.relative(cwd, filename)}: ${String(error)}`);
      continue;
    }
    scanned++;
    if (formatted !== content) {
      changed++;
      if (options.fix) {
        await writeLintSource(filename, content, formatted);
      } else {
        messages.push(`Needs formatting: ${path.relative(cwd, filename)}`);
      }
    }
  }
  return {
    engine: 'prettier',
    scanned,
    errors: errors + (!options.fix ? changed : 0),
    warnings: 0,
    changed,
    output: messages.join('\n'),
    ok: errors === 0 && (options.fix || changed === 0),
  };
}
