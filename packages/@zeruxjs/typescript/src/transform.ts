import * as ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { dependencyDiagnostics } from './dependencies.js';
import { nonemptyString, stringList } from './validation.js';

export type ScriptFormat = 'esm' | 'cjs';
export interface TransformOptions { filename?: string; format?: ScriptFormat; sourceMap?: boolean; target?: ts.ScriptTarget }
/** Transpiles a TypeScript file without type-checking. Use checkTypes for diagnostics. */
export function transformTypescript(source: string, options: TransformOptions = {}): { code: string; map?: string } {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
  if (options.filename !== undefined) nonemptyString(options.filename, 'filename');
  if (options.format !== undefined && !['esm', 'cjs'].includes(options.format)) throw new TypeError('Invalid transform format');
  if (options.sourceMap !== undefined && typeof options.sourceMap !== 'boolean') throw new TypeError('sourceMap must be boolean');
  if (options.target !== undefined && (typeof options.target !== 'number' || typeof ts.ScriptTarget[options.target] !== 'string')) throw new TypeError('Invalid target');
  const name = options.filename ?? 'module.ts';
  const extension = path.extname(name).toLowerCase();
  const jsx = extension === '.tsx' ? ts.JsxEmit.ReactJSX : ts.JsxEmit.Preserve;
  const result = ts.transpileModule(source, {
    fileName: name, reportDiagnostics: true,
    compilerOptions: {
      target: options.target ?? ts.ScriptTarget.ES2022,
      module: options.format === 'cjs' ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
      jsx,
      sourceMap: options.sourceMap ?? false,
      esModuleInterop: true
    }
  });
  const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) throw new Error(ts.formatDiagnostics(errors, {
    getCanonicalFileName: f => f,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n'
  }));
  return { code: result.outputText, map: result.sourceMapText };
}

export function transpileTypescriptFile(filename: string, options: Omit<TransformOptions, 'filename'> = {}) {
  return transformTypescript(fs.readFileSync(filename, 'utf8'), { ...options, filename });
}

export interface TypecheckOptions {
  files: string[];
  cwd?: string;
  configFile?: string;
  /** Opt in to checking literal bare imports against the source owner's manifest. */
  checkDependencies?: boolean;
  signal?: AbortSignal;
  /** Also supports compiler-owned cooperative cancellation in synchronous checks. */
  cancellationToken?: ts.CancellationToken;
}
export interface TypecheckResult {
  ok: boolean;
  status: 'passed' | 'failed' | 'cancelled';
  diagnostics: ts.Diagnostic[];
  /** Preserves AbortSignal.reason for callers; do not expose private reasons to clients. */
  reason?: unknown;
}
/** Checks without emitting. Compiler/configuration errors remain raw TS diagnostics.
 * Synchronous: an AbortSignal is observed at checkpoints, not a wall-clock deadline.
 * Unexpected compiler/IO exceptions propagate; only cancellation becomes a result.
 */
export function checkTypes(options: TypecheckOptions): TypecheckResult {
  if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
  stringList(options.files, 'files');
  if (options.cwd !== undefined) nonemptyString(options.cwd, 'cwd');
  if (options.configFile !== undefined) nonemptyString(options.configFile, 'configFile');
  if (options.checkDependencies !== undefined && typeof options.checkDependencies !== 'boolean') throw new TypeError('checkDependencies must be boolean');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
  if (options.cancellationToken !== undefined && (typeof options.cancellationToken?.isCancellationRequested !== 'function' || typeof options.cancellationToken?.throwIfCancellationRequested !== 'function')) throw new TypeError('Invalid cancellationToken');
  const diagnostics: ts.Diagnostic[] = [];
  const token: ts.CancellationToken = {
    isCancellationRequested: () => options.signal?.aborted === true || options.cancellationToken?.isCancellationRequested() === true,
    throwIfCancellationRequested() {
      if (this.isCancellationRequested()) throw new ts.OperationCanceledException();
    }
  };
  try {
    token.throwIfCancellationRequested();
    const base = path.resolve(options.cwd ?? process.cwd());
    const configPath = options.configFile ? path.resolve(base, options.configFile) : ts.findConfigFile(base, ts.sys.fileExists);
    let config: ts.ParsedCommandLine | undefined;
    if (configPath) {
      const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
      if (loaded.error) return { ok: false, status: 'failed', diagnostics: [loaded.error] };
      config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath));
    }
    const files = options.files.length ? options.files.map(file => path.resolve(base, file)) : config?.fileNames ?? [];
    const program = ts.createProgram({ rootNames: files, options: { ...config?.options, noEmit: true, noUncheckedSideEffectImports: options.checkDependencies ? true : config?.options.noUncheckedSideEffectImports }, projectReferences: config?.projectReferences });
    diagnostics.push(...(config?.errors ?? []));
    token.throwIfCancellationRequested();
    diagnostics.push(...ts.getPreEmitDiagnostics(program, undefined, token));
    if (options.checkDependencies) diagnostics.push(...dependencyDiagnostics(program, base, token));
    token.throwIfCancellationRequested();
    const ok = !diagnostics.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
    return { ok, status: ok ? 'passed' : 'failed', diagnostics };
  } catch (error) {
    if (!(error instanceof ts.OperationCanceledException)) throw error;
    return { ok: false, status: 'cancelled', diagnostics, reason: options.signal?.reason };
  }
}
