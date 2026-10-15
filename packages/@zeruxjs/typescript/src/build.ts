import path from 'node:path';

export interface TypeScriptBuildOptions {
  entryPoints: string[];
  outdir: string;
  cwd?: string;
  format?: 'esm' | 'cjs';
  target?: string;
  bundle?: boolean;
  minify?: boolean;
  sourcemap?: boolean;
  external?: string[];
}
/** Optional esbuild-backed fast build; resolves entry/output paths relative to cwd. */
export async function buildTypescript(options: TypeScriptBuildOptions) {
  if (!options.entryPoints?.length) throw new Error('At least one TypeScript entry point is required');
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const outdir = path.resolve(cwd, options.outdir);
  if (outdir === cwd) throw new Error('The output directory cannot equal the project root');
  const moduleName = 'esbuild';
  const { build } = await import(moduleName) as { build: (options: Record<string, unknown>) => Promise<unknown> };
  return build({ absWorkingDir: cwd, entryPoints: options.entryPoints,
    outdir, platform: 'node', format: options.format ?? 'esm',
    target: options.target ?? 'node20', bundle: options.bundle ?? false,
    minify: options.minify ?? false, sourcemap: options.sourcemap ?? true,
    external: options.external ?? [], logLevel: 'silent' });
}
