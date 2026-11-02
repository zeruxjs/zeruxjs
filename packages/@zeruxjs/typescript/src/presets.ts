/** Environment owned by a package's compilation, not by the tooling package. */
export type TypeScriptPresetName = 'node-server' | 'browser-library' | 'mixed-exports';

/** JSON tsconfig compiler options. String enums deliberately match tsconfig files. */
export interface PresetCompilerOptions extends Record<string, unknown> {
  target: 'ES2022';
  module: 'NodeNext' | 'ESNext';
  moduleResolution: 'NodeNext' | 'Bundler';
  lib: string[];
  types: string[];
  customConditions: string[];
  strict: boolean;
  skipLibCheck: boolean;
  declaration: boolean;
  noEmitOnError: boolean;
  noUncheckedSideEffectImports: boolean;
  rootDir: string;
  outDir: string;
  resolvePackageJsonExports: boolean;
  resolvePackageJsonImports: boolean;
}
export interface TypeScriptPreset {
  compilerOptions: PresetCompilerOptions;
  include: string[];
  exclude: string[];
}

/** Returns fresh JSON options; no filesystem, registration or export-map mutation.
 * NodeNext supplies node/types and per-import import/require conditions itself.
 * Browser builds use Bundler resolution so Node's implicit node condition is absent.
 * Mixed exports start with portable ES globals; check server/browser entries separately.
 */
export function createTypeScriptPreset(name: TypeScriptPresetName): TypeScriptPreset {
  if (!['node-server', 'browser-library', 'mixed-exports'].includes(name)) {
    throw new TypeError(`Unknown TypeScript preset: ${String(name)}`);
  }
  const browser = name === 'browser-library';
  return {
    compilerOptions: {
      target: 'ES2022',
      module: browser ? 'ESNext' : 'NodeNext',
      moduleResolution: browser ? 'Bundler' : 'NodeNext',
      lib: browser ? ['ES2022', 'DOM', 'DOM.Iterable'] : ['ES2022'],
      types: name === 'node-server' ? ['node'] : [],
      customConditions: browser ? ['browser'] : [],
      strict: true, skipLibCheck: false, declaration: true, noEmitOnError: true, noUncheckedSideEffectImports: true,
      rootDir: 'src', outDir: 'dist',
      resolvePackageJsonExports: true, resolvePackageJsonImports: true
    },
    include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.mts', 'src/**/*.cts'],
    exclude: ['node_modules', 'dist', 'build']
  };
}
