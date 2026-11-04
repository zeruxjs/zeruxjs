import path from 'node:path';
import type { BuildOptions, BuildResult } from 'esbuild';
import { nonemptyString, stringList } from './validation.js';

export interface TypeScriptBuildOptions {
  entryPoints: string[];
  outdir: string;
  cwd?: string;
  format?: 'esm' | 'cjs' | 'iife';
  /** Defaults to node; browser omits Node built-in resolution for browser assets. */
  platform?: 'node' | 'browser' | 'neutral';
  target?: string;
  bundle?: boolean;
  minify?: boolean;
  sourcemap?: boolean;
  external?: string[];
  /** Cancels the owned build context; it is always disposed before settling. */
  signal?: AbortSignal;
}

/** Fast transpile/bundle only, never typechecks or emits declarations. Returns raw
 * esbuild results and propagates compiler failures with their errors/warnings.
 * Paths are relative to cwd; cancellation rejects with AbortError and cause details.
 */
export async function buildTypescript(options: TypeScriptBuildOptions): Promise<BuildResult> {
  if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
  stringList(options.entryPoints, 'entryPoints');
  if (!options.entryPoints.length) throw new Error('At least one TypeScript entry point is required');
  nonemptyString(options.outdir, 'outdir');
  if (options.cwd !== undefined) nonemptyString(options.cwd, 'cwd');
  if (options.target !== undefined) nonemptyString(options.target, 'target');
  if (options.external !== undefined) stringList(options.external, 'external');
  for (const key of ['bundle', 'minify', 'sourcemap'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  }
  if (options.platform !== undefined && !['node', 'browser', 'neutral'].includes(options.platform)) throw new TypeError('Invalid platform');
  if (options.format !== undefined && !['esm', 'cjs', 'iife'].includes(options.format)) throw new TypeError('Invalid format');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
  const { signal } = options;
  const abortError = (cause: unknown = signal?.reason) => {
    const error = new Error('TypeScript build cancelled', { cause });
    error.name = 'AbortError';
    return error;
  };
  if (signal?.aborted) throw abortError();
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const outdir = path.resolve(cwd, options.outdir);
  if (outdir === cwd) throw new Error('The output directory cannot equal the project root');
  const { build, context } = await import('esbuild');
  if (signal?.aborted) throw abortError();
  const buildOptions: BuildOptions = {
    absWorkingDir: cwd, entryPoints: options.entryPoints, outdir,
    platform: options.platform ?? 'node', format: options.format ?? 'esm',
    target: options.target ?? (options.platform === 'browser' ? 'es2022' : 'node20'),
    bundle: options.bundle ?? false, minify: options.minify ?? false,
    sourcemap: options.sourcemap ?? true, external: options.external ?? [], logLevel: 'silent'
  };
  if (!signal) return build(buildOptions);
  const owned = await context(buildOptions);
  let cancellation: Promise<void> | undefined;
  let cancellationError: unknown;
  const cancel = () => {
    cancellation ??= owned.cancel().catch(error => { cancellationError = error; });
  };
  signal.addEventListener('abort', cancel, { once: true });
  let result: BuildResult | undefined;
  const failures: unknown[] = [];
  try {
    if (signal.aborted) throw abortError();
    result = await owned.rebuild();
    if (signal.aborted) throw abortError();
  } catch (error) {
    // Preserve esbuild's diagnostic payload when cancellation races a compiler error.
    failures.push(signal.aborted ? abortError({ reason: signal.reason, error }) : error);
  }
  // Settle every owned resource even after a compiler or cancellation failure.
  // Report cleanup failures alongside the original error instead of hiding it.
  signal.removeEventListener('abort', cancel);
  await cancellation;
  if (cancellationError !== undefined) failures.push(cancellationError);
  try { await owned.dispose(); } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'TypeScript build and cleanup failed');
  return result!;
}
