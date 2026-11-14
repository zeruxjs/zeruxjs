import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import {
  createTypeScriptPreset,
  type TypeScriptPresetName,
} from './presets.js';
import { nonemptyString, stringList } from './validation.js';

/** Trusted config-generation policy; this API does not authorize the output directory. */
export interface TsConfigOptions {
  /** Optional named environment preset, merged before explicit compiler options. */
  preset?: TypeScriptPresetName;
  /** Replace an existing tsconfig only when true; defaults to false. */
  overwrite?: boolean;
  /** Trusted JSON compiler options validated by TypeScript before promotion. */
  compilerOptions?: Record<string, unknown>;
  /** Root-file globs overriding preset/default include patterns. */
  include?: string[];
  /** Excluded globs; defaults to node_modules, dist and build. */
  exclude?: string[];
}
/** Create a tsconfig in a trusted local directory and return its absolute path.
 * Keeps an existing file unless overwrite is explicit; caller options override the
 * selected preset. Invalid options/compiler settings throw before file promotion.
 * Creates the root directory and uses a private temporary file plus rename; it is
 * not a cross-process create-only lock or a path-authorization boundary.
 *
 * @param {string} rootDir - Trusted output directory, resolved relative to process.cwd().
 * @param {TsConfigOptions} options - Optional preset, replacement policy and compiler/include/exclude overrides.
 * @returns {string} Absolute tsconfig.json path, including when an existing file is preserved.
 * @throws {TypeError} For malformed options, unsupported presets or invalid compiler settings.
 * @throws {Error} Propagates directory/write/rename/cleanup failures; cleanup failure takes precedence.
 */
export function createTsConfig(
  rootDir: string,
  options: TsConfigOptions = {}
): string {
  nonemptyString(rootDir, 'rootDir');
  if (!options || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (
    options.overwrite !== undefined &&
    typeof options.overwrite !== 'boolean'
  ) {
    throw new TypeError('overwrite must be boolean');
  }
  if (options.include !== undefined) {
    stringList(options.include, 'include');
  }
  if (options.exclude !== undefined) {
    stringList(options.exclude, 'exclude');
  }
  if (
    options.compilerOptions !== undefined &&
    (!options.compilerOptions ||
      typeof options.compilerOptions !== 'object' ||
      Array.isArray(options.compilerOptions))
  ) {
    throw new TypeError('compilerOptions must be an object');
  }
  /** Optional fresh environment defaults, applied before explicit compiler overrides. */
  const preset =
    options.preset === undefined
      ? undefined
      : createTypeScriptPreset(options.preset);
  /** Absolute trusted directory used for config validation and temporary-file promotion. */
  const root = path.resolve(rootDir);
  fs.mkdirSync(root, { recursive: true });
  /** Final tsconfig path; an existing file is retained unless overwrite is explicit. */
  const file = path.join(root, 'tsconfig.json');
  if (fs.existsSync(file) && !options.overwrite) {
    return file;
  }
  /** JSON configuration candidate combining defaults, preset and caller-owned overrides. */
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      ...preset?.compilerOptions,
      ...options.compilerOptions,
    },
    include: options.include ??
      preset?.include ?? ['src/**/*.ts', 'src/**/*.tsx'],
    exclude: options.exclude ?? ['node_modules', 'dist', 'build'],
  };
  /** TypeScript validation result used to reject invalid compiler options before promotion. */
  const converted = ts.convertCompilerOptionsFromJson(
    config.compilerOptions,
    root
  );
  if (converted.errors.length) {
    throw new TypeError(
      ts.formatDiagnosticsWithColorAndContext(converted.errors, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      })
    );
  }
  // Stage beside the destination so rename stays on the same filesystem. The
  // finally block removes the owned temporary file after failed promotion too.
  /** Private same-directory staging path, exclusively created and cleaned after promotion. */
  const temp = path.join(root, `.tsconfig-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temp, file);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Preserve the established policy: cleanup failure overrides a write failure.
        // eslint-disable-next-line no-unsafe-finally -- Owned temporary-file cleanup failures intentionally propagate.
        throw err;
      }
    }
  }
  return file;
}
