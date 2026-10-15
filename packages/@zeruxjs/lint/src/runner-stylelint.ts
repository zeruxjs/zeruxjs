import path from 'node:path';
import type { LintOptions, LintResult } from './types.js';

export async function runStylelint(options: LintOptions = {}): Promise<LintResult> {
  const specifier = 'stylelint';
  const imported = await import(specifier) as { default?: { lint: (settings: object) => Promise<any> }; lint?: (settings: object) => Promise<any> };
  const stylelint = imported.default ?? imported;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const checked = await stylelint.lint!({ cwd, files: options.files?.length ? options.files : ['**/*.{css,scss}'],
    fix: options.fix ?? false, ...(options.configFile ? { configFile: options.configFile } : {}) });
  const results = checked.results ?? [];
  const errors = results.reduce((n: number, r: any) => n + (r.errored ? Math.max(1, (r.warnings ?? []).filter((w: any) => w.severity === 'error').length) : 0), 0);
  const warnings = results.reduce((n: number, r: any) => n + (r.warnings ?? []).filter((w: any) => w.severity !== 'error').length, 0);
  return { engine: 'stylelint', scanned: results.length, errors, warnings,
    changed: results.filter((r: any) => r._postcssResult?.root?.source?.input?.css !== r.code && r.code !== undefined).length,
    output: checked.report ?? '', ok: !checked.errored && errors === 0 };
}
