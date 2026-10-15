import path from 'node:path';
import type { LintOptions, LintResult } from './types.js';

export async function runEslint(options: LintOptions = {}): Promise<LintResult> {
  const moduleName = 'eslint';
  const { ESLint } = await import(moduleName) as { ESLint: {
    new (settings: object): {
      lintFiles: (patterns: string[]) => Promise<Array<{ errorCount: number; warningCount: number; filePath: string; output?: string }>>;
      loadFormatter: (name: string) => Promise<{ format: (results: unknown[]) => string }>;
    };
    outputFixes: (results: unknown[]) => Promise<void>;
  } };
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const eslint = new ESLint({ cwd, fix: options.fix ?? false, overrideConfigFile: options.configFile });
  const result = await eslint.lintFiles(options.files?.length ? options.files : ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx,vue}']);
  if (options.fix) {
    const fixOutput = ESLint.outputFixes;
    await fixOutput(result);
  }
  const formatter = await eslint.loadFormatter('stylish');
  const errors = result.reduce((sum, row) => sum + row.errorCount, 0);
  const warnings = result.reduce((sum, row) => sum + row.warningCount, 0);
  return { engine: 'eslint', scanned: result.length, errors, warnings,
    changed: result.filter(row => row.output !== undefined).length,
    output: formatter.format(result), ok: errors === 0 };
}
