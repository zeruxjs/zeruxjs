/** Environment owned by a package's compilation, not by the tooling package. */
export type TypeScriptPresetName =
  | 'node-server'
  | 'browser-library'
  | 'mixed-exports';

/** JSON tsconfig compiler options. String enums deliberately match tsconfig files. */
export interface PresetCompilerOptions extends Record<string, unknown> {
  /** Language emission baseline shared by all presets. */
  target: 'ES2022';
  /** Module emission format selected for Node or browser resolution. */
  module: 'NodeNext' | 'ESNext';
  /** NodeNext for Node/mixed; Bundler for browser package resolution. */
  moduleResolution: 'NodeNext' | 'Bundler';
  /** Standard library declarations; browser adds DOM and DOM.Iterable. */
  lib: string[];
  /** Explicit ambient type packages; only node-server enables node. */
  types: string[];
  /** Additional package-export conditions; browser enables browser. */
  customConditions: string[];
  /** Enable TypeScript strict checks. */
  strict: boolean;
  /** False: check dependency declaration files rather than ignoring their errors. */
  skipLibCheck: boolean;
  /** Emit package-owned declarations when compiling with this preset. */
  declaration: boolean;
  /** Prevent emission when compiler diagnostics contain errors. */
  noEmitOnError: boolean;
  /** Diagnose unresolved side-effect imports. */
  noUncheckedSideEffectImports: boolean;
  /** Authored source root, initially src. */
  rootDir: string;
  /** Compiler emission directory, initially dist. */
  outDir: string;
  /** Respect installed package export maps. */
  resolvePackageJsonExports: boolean;
  /** Respect owner package imports maps. */
  resolvePackageJsonImports: boolean;
}
/** Mutable JSON configuration returned afresh for each preset request. */
export interface TypeScriptPreset {
  /** Fresh JSON compiler options; consumers own mutations. */
  compilerOptions: PresetCompilerOptions;
  /** Fresh source globs covering TS, TSX, MTS and CTS files. */
  include: string[];
  /** Fresh excluded-directory list for dependencies/build outputs. */
  exclude: string[];
}

/** Return independent JSON configuration for a named compilation environment.
 * Unknown names throw TypeError; callers may mutate returned arrays/options.
 * No filesystem, registration or export-map mutation.
 * NodeNext supplies node/types and per-import import/require conditions itself.
 * Browser builds use Bundler resolution so Node's implicit node condition is absent.
 * Mixed exports start with portable ES globals; check server/browser entries separately.
 *
 * @param {TypeScriptPresetName} name - Environment contract: node-server, browser-library or mixed-exports.
 * @returns {TypeScriptPreset} Fresh compiler options and include/exclude arrays owned by the caller.
 * @throws {TypeError} When name is not a supported preset.
 */
export function createTypeScriptPreset(
  name: TypeScriptPresetName
): TypeScriptPreset {
  if (!['node-server', 'browser-library', 'mixed-exports'].includes(name)) {
    throw new TypeError(`Unknown TypeScript preset: ${String(name)}`);
  }
  /** Environment switch controlling DOM libraries and browser package conditions. */
  const browser = name === 'browser-library';
  return {
    compilerOptions: {
      target: 'ES2022',
      module: browser ? 'ESNext' : 'NodeNext',
      moduleResolution: browser ? 'Bundler' : 'NodeNext',
      lib: browser ? ['ES2022', 'DOM', 'DOM.Iterable'] : ['ES2022'],
      types: name === 'node-server' ? ['node'] : [],
      customConditions: browser ? ['browser'] : [],
      strict: true,
      skipLibCheck: false,
      declaration: true,
      noEmitOnError: true,
      noUncheckedSideEffectImports: true,
      rootDir: 'src',
      outDir: 'dist',
      resolvePackageJsonExports: true,
      resolvePackageJsonImports: true,
    },
    include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.mts', 'src/**/*.cts'],
    exclude: ['node_modules', 'dist', 'build'],
  };
}
