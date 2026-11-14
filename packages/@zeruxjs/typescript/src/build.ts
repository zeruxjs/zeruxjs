import path from 'node:path';
import type { BuildOptions, BuildResult } from 'esbuild';
import { nonemptyString, stringList } from './validation.js';

/** Caller-owned build policy; paths and native output permissions remain host responsibilities. */
export interface TypeScriptBuildOptions {
  /** Explicit source paths relative to cwd; nonempty list, at most 10,000 entries. */
  entryPoints: string[];
  /** Output directory relative to cwd; cannot equal the project root. Files are not staged atomically. */
  outdir: string;
  /** Working directory; defaults to process.cwd(). */
  cwd?: string;
  /** Output module format; defaults to esm. */
  format?: 'esm' | 'cjs' | 'iife';
  /** Defaults to node; browser omits Node built-in resolution for browser assets. */
  platform?: 'node' | 'browser' | 'neutral';
  /** esbuild target; defaults to es2022 for browser, node20 otherwise. */
  target?: string;
  /** Resolve and bundle dependencies when true; defaults to false. */
  bundle?: boolean;
  /** Minify emitted output when true; defaults to false. */
  minify?: boolean;
  /** Emit source maps when true; defaults to true. Disable for private production source. */
  sourcemap?: boolean;
  /** Module patterns left external by esbuild; defaults to an empty list. */
  external?: string[];
  /** Cancels the owned build context; it is always disposed before settling. */
  signal?: AbortSignal;
}

/** Fast transpile/bundle only, never typechecks or emits declarations. Returns raw
 * esbuild results and propagates compiler failures with their errors/warnings.
 * Paths are relative to cwd; cancellation rejects with AbortError and cause details.
 *
 * @param {TypeScriptBuildOptions} options - Entry points, destination and build policy; see individual option fields for defaults.
 * @returns {Promise<BuildResult>} Native esbuild result after all owned cancellation/disposal work settles. Output files may remain on failure.
 * @throws {TypeError} When an option has an invalid runtime type or value.
 * @throws {Error} For invalid entry/output choices, dependency/compiler failures or cancellation (name AbortError).
 * @throws {AggregateError} When both build and resource cleanup fail.
 */
export async function buildTypescript(
  options: TypeScriptBuildOptions
): Promise<BuildResult> {
  if (!options || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  stringList(options.entryPoints, 'entryPoints');
  if (!options.entryPoints.length) {
    throw new Error('At least one TypeScript entry point is required');
  }
  nonemptyString(options.outdir, 'outdir');
  if (options.cwd !== undefined) {
    nonemptyString(options.cwd, 'cwd');
  }
  if (options.target !== undefined) {
    nonemptyString(options.target, 'target');
  }
  if (options.external !== undefined) {
    stringList(options.external, 'external');
  }
  // key identifies each boolean flag; validate it before loading native tooling.
  for (const key of ['bundle', 'minify', 'sourcemap'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new TypeError(`${key} must be boolean`);
    }
  }
  if (
    options.platform !== undefined &&
    !['node', 'browser', 'neutral'].includes(options.platform)
  ) {
    throw new TypeError('Invalid platform');
  }
  if (
    options.format !== undefined &&
    !['esm', 'cjs', 'iife'].includes(options.format)
  ) {
    throw new TypeError('Invalid format');
  }
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    throw new TypeError('signal must be an AbortSignal');
  }
  /** Borrowed cancellation signal; this build owns listeners, not the controller. */
  const { signal } = options;
  /** Create a stable public cancellation error while retaining private cause details.
   * @param {unknown} cause - Private signal/compiler reason; defaults to signal.reason.
   * @returns {Error} AbortError-named error; never logged by this helper.
   */
  const abortError = (cause: unknown = signal?.reason) => {
    /** Cancellation error carrying private cause data for host diagnostics. */
    const error = new Error('TypeScript build cancelled', { cause });
    error.name = 'AbortError';
    return error;
  };
  if (signal?.aborted) {
    throw abortError();
  }
  /** Absolute project base used for all esbuild path resolution. */
  const cwd = path.resolve(options.cwd ?? process.cwd());
  /** Absolute output destination, checked against the project root before writing. */
  const outdir = path.resolve(cwd, options.outdir);
  if (outdir === cwd) {
    throw new Error('The output directory cannot equal the project root');
  }
  /** Lazy native build entry points; imported only after validating caller options. */
  const { build, context } = await import('esbuild');
  if (signal?.aborted) {
    throw abortError();
  }
  /** Validated native options; defaults preserve the existing Node build contract. */
  const buildOptions: BuildOptions = {
    absWorkingDir: cwd,
    entryPoints: options.entryPoints,
    outdir,
    platform: options.platform ?? 'node',
    format: options.format ?? 'esm',
    target:
      options.target ?? (options.platform === 'browser' ? 'es2022' : 'node20'),
    bundle: options.bundle ?? false,
    minify: options.minify ?? false,
    sourcemap: options.sourcemap ?? true,
    external: options.external ?? [],
    logLevel: 'silent',
  };
  if (!signal) {
    return build(buildOptions);
  }
  /** Native build context owned until rebuild, cancellation and disposal settle. */
  const owned = await context(buildOptions);
  let cancellation: Promise<void> | undefined;
  let cancellationError: unknown;
  /** One-shot cancellation request; native failures are retained for final cleanup reporting.
   * @returns {void} Starts or reuses cancellation; the enclosing build awaits settlement.
   */
  const cancel = () => {
    cancellation ??= owned.cancel().catch((error) => {
      cancellationError = error;
    });
  };
  signal.addEventListener('abort', cancel, { once: true });
  let result: BuildResult | undefined;
  /** Ordered build and cleanup failures; multiple failures are reported together. */
  const failures: unknown[] = [];
  try {
    if (signal.aborted) {
      throw abortError();
    }
    result = await owned.rebuild();
    if (signal.aborted) {
      throw abortError();
    }
  } catch (error) {
    // Preserve esbuild's diagnostic payload when cancellation races a compiler error.
    failures.push(
      signal.aborted ? abortError({ reason: signal.reason, error }) : error
    );
  }
  // Settle every owned resource even after a compiler or cancellation failure.
  // Report cleanup failures alongside the original error instead of hiding it.
  signal.removeEventListener('abort', cancel);
  await cancellation;
  if (cancellationError !== undefined) {
    failures.push(cancellationError);
  }
  try {
    await owned.dispose();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'TypeScript build and cleanup failed');
  }
  return result!;
}
