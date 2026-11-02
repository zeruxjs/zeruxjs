import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { createTypeScriptPreset, type TypeScriptPresetName } from './presets.js';
import { nonemptyString, stringList } from './validation.js';

export interface TsConfigOptions { preset?: TypeScriptPresetName; overwrite?: boolean; compilerOptions?: Record<string, unknown>; include?: string[]; exclude?: string[] }
/** Generates a safe default tsconfig only if none exists, unless overwrite is explicit. */
export function createTsConfig(rootDir: string, options: TsConfigOptions = {}): string {
  nonemptyString(rootDir, 'rootDir');
  if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
  if (options.overwrite !== undefined && typeof options.overwrite !== 'boolean') throw new TypeError('overwrite must be boolean');
  if (options.include !== undefined) stringList(options.include, 'include');
  if (options.exclude !== undefined) stringList(options.exclude, 'exclude');
  if (options.compilerOptions !== undefined && (!options.compilerOptions || typeof options.compilerOptions !== 'object' || Array.isArray(options.compilerOptions))) {
    throw new TypeError('compilerOptions must be an object');
  }
  const preset = options.preset === undefined ? undefined : createTypeScriptPreset(options.preset);
  const root = path.resolve(rootDir);
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'tsconfig.json');
  if (fs.existsSync(file) && !options.overwrite) return file;
  const config = {
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, skipLibCheck: true, esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      ...preset?.compilerOptions,
      ...options.compilerOptions
    },
    include: options.include ?? preset?.include ?? ['src/**/*.ts', 'src/**/*.tsx'],
    exclude: options.exclude ?? ['node_modules', 'dist', 'build']
  };
  const converted = ts.convertCompilerOptionsFromJson(config.compilerOptions, root);
  if (converted.errors.length) throw new TypeError(ts.formatDiagnosticsWithColorAndContext(converted.errors, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  const temp = path.join(root, `.tsconfig-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    // eslint-disable-next-line no-unsafe-finally -- Cleanup failures intentionally propagate so private temporary-file cleanup failures are visible.
    try { fs.unlinkSync(temp); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  }
  return file;
}
