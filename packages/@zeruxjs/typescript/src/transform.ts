import * as ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { dependencyDiagnostics } from './dependencies.js';
import { nonemptyString, stringList } from './validation.js';

/** Supported JavaScript module emission syntaxes; not a runtime loader choice. */
export type ScriptFormat = 'esm' | 'cjs';
/** Optional text-transpilation settings; omission preserves the documented emit defaults. */
export interface TransformOptions {
  /** Diagnostic/JSX filename hint; defaults to module.ts and is not read from disk. */
  filename?: string;
  /** Output syntax; defaults to esm. */
  format?: ScriptFormat;
  /** Request a source map; defaults to false. */
  sourceMap?: boolean;
  /** TypeScript emit target; defaults to ScriptTarget.ES2022. */
  target?: ts.ScriptTarget;
}
/** Transpile source text without reading files, executing it or typechecking it.
 * filename selects JSX behavior and diagnostic labels, not a filesystem read.
 * Invalid options throw TypeError; compiler syntax errors throw formatted errors.
 * Returns emitted code and an optional source map. Use checkTypes for type errors.
 *
 * @param {string} source - TypeScript source text; no source module is imported or executed.
 * @param {TransformOptions} options - Filename/format/target/map overrides; omitted options preserve package defaults.
 * @returns {{code: string, map?: string}} JavaScript text and an optional compiler-generated source map.
 * @throws {TypeError} When source or a transform option fails runtime validation.
 * @throws {Error} For compiler syntax diagnostics or unexpected compiler failures.
 */
export function transformTypescript(
  source: string,
  options: TransformOptions = {}
): { code: string; map?: string } {
  if (typeof source !== 'string') {
    throw new TypeError('source must be a string');
  }
  if (!options || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (options.filename !== undefined) {
    nonemptyString(options.filename, 'filename');
  }
  if (
    options.format !== undefined &&
    !['esm', 'cjs'].includes(options.format)
  ) {
    throw new TypeError('Invalid transform format');
  }
  if (
    options.sourceMap !== undefined &&
    typeof options.sourceMap !== 'boolean'
  ) {
    throw new TypeError('sourceMap must be boolean');
  }
  if (
    options.target !== undefined &&
    (typeof options.target !== 'number' ||
      typeof ts.ScriptTarget[options.target] !== 'string')
  ) {
    throw new TypeError('Invalid target');
  }
  /** Filename hint used for JSX selection and compiler diagnostic labels. */
  const name = options.filename ?? 'module.ts';
  /** Normalized suffix used to select TSX emission behavior. */
  const extension = path.extname(name).toLowerCase();
  /** TSX uses the automatic React JSX runtime; other suffixes preserve JSX syntax. */
  const jsx = extension === '.tsx' ? ts.JsxEmit.ReactJSX : ts.JsxEmit.Preserve;
  /** Compiler transpilation result; JavaScript text is returned without executing it. */
  const result = ts.transpileModule(source, {
    fileName: name,
    reportDiagnostics: true,
    compilerOptions: {
      target: options.target ?? ts.ScriptTarget.ES2022,
      module:
        options.format === 'cjs'
          ? ts.ModuleKind.CommonJS
          : ts.ModuleKind.ESNext,
      jsx,
      sourceMap: options.sourceMap ?? false,
      esModuleInterop: true,
    },
  });
  /** Only error-category transpilation diagnostics cause this API to throw. */
  const errors =
    result.diagnostics?.filter(
      (d) => d.category === ts.DiagnosticCategory.Error
    ) ?? [];
  if (errors.length) {
    throw new Error(
      ts.formatDiagnostics(errors, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
      })
    );
  }
  return { code: result.outputText, map: result.sourceMapText };
}

/** Read a trusted local UTF-8 file and return its transpilation without execution.
 * Filesystem and transform failures propagate; path authorization is caller-owned.
 *
 * @param {string} filename - Trusted file path read synchronously as UTF-8, relative to process.cwd() if needed.
 * @param {Omit<TransformOptions, 'filename'>} options - Transform overrides; filename always comes from the first argument.
 * @returns {{code: string, map?: string}} Transpiled JavaScript and optional source map; no emitted file is written.
 * @throws {Error} Propagates filesystem, option-validation and compiler errors.
 */
export function transpileTypescriptFile(
  /** Diagnostic/JSX filename hint; defaults to module.ts and is not read from disk. */
  filename: string,
  options: Omit<TransformOptions, 'filename'> = {}
) {
  return transformTypescript(fs.readFileSync(filename, 'utf8'), {
    ...options,
    filename,
  });
}

/** Diagnostic-only project check with explicit roots and cooperative cancellation. */
export interface TypecheckOptions {
  /** Explicit roots relative to cwd; an empty list uses the selected config file roots. */
  files: string[];
  /** Project lookup directory; defaults to process.cwd(). */
  cwd?: string;
  /** Explicit config path relative to cwd; otherwise TypeScript searches ancestor directories. */
  configFile?: string;
  /** Opt in to checking literal bare imports against the source owner's manifest. */
  checkDependencies?: boolean;
  /** Borrowed signal observed at synchronous checkpoints; does not provide timer-driven interruption. */
  signal?: AbortSignal;
  /** Also supports compiler-owned cooperative cancellation in synchronous checks. */
  cancellationToken?: ts.CancellationToken;
}
/** Diagnostic outcome; raw diagnostics/reasons may contain host-private data. */
export interface TypecheckResult {
  /** True only when status is passed and no error diagnostics were found. */
  ok: boolean;
  /** Passed, failed or cooperatively cancelled; failed and cancelled both set ok to false. */
  status: 'passed' | 'failed' | 'cancelled';
  /** Raw compiler/configuration/manifest diagnostics; may include private source paths and text. */
  diagnostics: ts.Diagnostic[];
  /** Preserves AbortSignal.reason for callers; do not expose private reasons to clients. */
  reason?: unknown;
}
/** Checks without emitting. Compiler/configuration errors remain raw TS diagnostics.
 * Synchronous: an AbortSignal is observed at checkpoints, not a wall-clock deadline.
 * Unexpected compiler/IO exceptions propagate; only cancellation becomes a result.
 *
 * @param {TypecheckOptions} options - Project roots/configuration, manifest diagnostics and cooperative cancellation policy.
 * @returns {TypecheckResult} Passed/failed/cancelled status with compiler diagnostics; cancellation may include a private reason.
 * @throws {TypeError} When options or cancellation contracts fail runtime validation.
 * @throws {Error} Propagates unexpected compiler/I/O failures; ordinary compiler errors stay in diagnostics.
 */
export function checkTypes(options: TypecheckOptions): TypecheckResult {
  if (!options || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  stringList(options.files, 'files');
  if (options.cwd !== undefined) {
    nonemptyString(options.cwd, 'cwd');
  }
  if (options.configFile !== undefined) {
    nonemptyString(options.configFile, 'configFile');
  }
  if (
    options.checkDependencies !== undefined &&
    typeof options.checkDependencies !== 'boolean'
  ) {
    throw new TypeError('checkDependencies must be boolean');
  }
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (
    options.cancellationToken !== undefined &&
    (typeof options.cancellationToken?.isCancellationRequested !== 'function' ||
      typeof options.cancellationToken?.throwIfCancellationRequested !==
        'function')
  ) {
    throw new TypeError('Invalid cancellationToken');
  }
  /** Accumulated config, compiler and optional manifest diagnostics for this check. */
  const diagnostics: ts.Diagnostic[] = [];
  /** Composite cancellation token; observes either caller signal or compiler callback. */
  const token: ts.CancellationToken = {
    isCancellationRequested: () =>
      options.signal?.aborted === true ||
      options.cancellationToken?.isCancellationRequested() === true,
    throwIfCancellationRequested() {
      if (this.isCancellationRequested()) {
        throw new ts.OperationCanceledException();
      }
    },
  };
  try {
    token.throwIfCancellationRequested();
    /** Absolute project base for config search and explicit source roots. */
    const base = path.resolve(options.cwd ?? process.cwd());
    /** Explicit config path or the nearest config discovered by TypeScript. */
    const configPath = options.configFile
      ? path.resolve(base, options.configFile)
      : ts.findConfigFile(base, ts.sys.fileExists);
    let config: ts.ParsedCommandLine | undefined;
    if (configPath) {
      /** Compiler-read JSON configuration; ordinary config failures become failed results. */
      const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
      if (loaded.error) {
        return { ok: false, status: 'failed', diagnostics: [loaded.error] };
      }
      config = ts.parseJsonConfigFileContent(
        loaded.config,
        ts.sys,
        path.dirname(configPath)
      );
    }
    // Explicit files replace the config's root list; config compiler options and
    // project references still apply. Always force noEmit for this diagnostic API.
    /** Explicit root list when supplied, otherwise the selected config root files. */
    const files = options.files.length
      ? options.files.map((file) => path.resolve(base, file))
      : (config?.fileNames ?? []);
    /** Borrowed compiler graph created for diagnostics only, with emission disabled. */
    const program = ts.createProgram({
      rootNames: files,
      options: {
        ...config?.options,
        noEmit: true,
        noUncheckedSideEffectImports: options.checkDependencies
          ? true
          : config?.options.noUncheckedSideEffectImports,
      },
      projectReferences: config?.projectReferences,
    });
    diagnostics.push(...(config?.errors ?? []));
    token.throwIfCancellationRequested();
    diagnostics.push(...ts.getPreEmitDiagnostics(program, undefined, token));
    if (options.checkDependencies) {
      diagnostics.push(...dependencyDiagnostics(program, base, token));
    }
    token.throwIfCancellationRequested();
    /** Success requires no error-category diagnostics; warnings do not fail the result. */
    const ok = !diagnostics.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
    );
    return { ok, status: ok ? 'passed' : 'failed', diagnostics };
  } catch (error) {
    // Only compiler cancellation is normalized; unexpected I/O/compiler failures
    // must not be reported as successful or merely cancelled checks.
    if (!(error instanceof ts.OperationCanceledException)) {
      throw error;
    }
    return {
      ok: false,
      status: 'cancelled',
      diagnostics,
      reason: options.signal?.reason,
    };
  }
}
