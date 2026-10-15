import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverLintFiles } from './files.js';
import type { LintOptions, LintResult } from './types.js';

export async function runPrettier(options: LintOptions = {}): Promise<LintResult> {
  const moduleName = 'prettier';
  const prettier = await import(moduleName) as {
    resolveConfig: (file: string) => Promise<object | null>;
    getFileInfo: (file: string, options?: object) => Promise<{ ignored: boolean; inferredParser?: string | null }>;
    format: (source: string, options: object) => Promise<string>;
  };
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const files = discoverLintFiles(cwd, options);
  let scanned = 0, errors = 0, changed = 0;
  const messages: string[] = [];
  for (const filename of files) {
    const info = await prettier.getFileInfo(filename, { ignorePath: path.join(cwd, '.prettierignore'), resolveConfig: true });
    if (info.ignored || !info.inferredParser) continue;
    const stat = await fs.stat(filename);
    if (stat.size > 5 * 1024 * 1024) { messages.push(`Skipped oversized file: ${path.relative(cwd, filename)}`); continue; }
    const content = await fs.readFile(filename, 'utf8');
    const config = (await prettier.resolveConfig(filename)) ?? {};
    let formatted: string;
    try { formatted = await prettier.format(content, { ...config, filepath: filename }); }
    catch (error) { errors++; messages.push(`${path.relative(cwd, filename)}: ${String(error)}`); continue; }
    scanned++;
    if (formatted !== content) {
      changed++;
      if (options.fix) await fs.writeFile(filename, formatted, 'utf8');
      else messages.push(`Needs formatting: ${path.relative(cwd, filename)}`);
    }
  }
  return { engine: 'prettier', scanned, errors: errors + (!options.fix ? changed : 0),
    warnings: 0, changed, output: messages.join('\n'), ok: errors === 0 && (options.fix || changed === 0) };
}
