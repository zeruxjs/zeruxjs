import {
  createDeprecationRegistry,
  type DeprecatedApi,
} from './deprecations.js';
export {
  createDeprecationRegistry,
  builtInDeprecations,
} from './deprecations.js';
export type { DeprecatedApi } from './deprecations.js';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import type { Linter } from 'eslint';
import { createZeruxPlugin } from './rules.js';
import { readPackageExportContracts } from './contracts.js';

export interface PresetOptions {
  /** Explicit app/third-party deprecation facts; no scanning or imported-code evaluation. */
  deprecations?: readonly DeprecatedApi[];
  /** Include source-verified builtins; defaults to true. Explicit host entries replace exact keys. */
  includeBuiltInDeprecations?: boolean;

  /** Prefer verified managed packages; defaults to false in package and true in application presets. */
  packageUsage?: boolean;

  /** Explicit ambient globals; does not classify authorization or runtime trust. */
  environment?: 'node' | 'browser' | 'universal';
  /** Used only when reading explicitly selected installed package manifests. */
  cwd?: string;
  /** Empty by default. Missing declared packages fail configuration, never fall back to source paths. */
  packages?: readonly string[];
}
/** Supported JavaScript and TypeScript flat-config file patterns. */
const files = ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'];
/** TypeScript-only patterns for parser-aware recommended diagnostics. */
const typescript = ['**/*.{ts,mts,cts,tsx}'];
/** Shared mandatory security/ownership errors, retained by both preset families. */
const security: Record<string, Linter.RuleEntry> = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'zerux/client-server-import': 'error',
  'zerux/public-service-config': 'error',
  'zerux/package-exports': 'error',
  'zerux/cleanup-ownership': 'error',
  'zerux/a11y-required-label': 'error',
  'zerux/a11y-relationships': 'error',
};
/** Validate environment and package policy before reading explicit installed contracts.
 * @param {PresetOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {{environment: string, contracts: ReturnType<typeof readPackageExportContracts>, deprecations: ReturnType<typeof createDeprecationRegistry>}} Validated ambient environment and selected installed public-export snapshots.
 * @throws {Error} For invalid options or missing/invalid explicitly requested installed contracts.
 */
function optionsFor(options: PresetOptions) {
  if (
    options.packageUsage !== undefined &&
    typeof options.packageUsage !== 'boolean'
  ) {
    throw new TypeError('lint: packageUsage must be boolean');
  }
  /** Validated host-selected ambient environment, not an authorization classification. */
  const environment = options.environment ?? 'universal';
  if (
    !['node', 'browser', 'universal'].includes(environment) ||
    (options.cwd !== undefined && typeof options.cwd !== 'string')
  ) {
    throw new TypeError('lint: invalid preset options');
  }
  /** Explicit installed export maps, read as data only when requested. */
  const contracts = readPackageExportContracts(
    options.cwd ?? process.cwd(),
    options.packages ?? []
  );
  /** Snapshot deprecations before any rule instance can observe mutable caller data. */
  const deprecations = createDeprecationRegistry(options.deprecations, {
    includeBuiltIns: options.includeBuiltInDeprecations,
  });
  return { environment, contracts, deprecations };
}
/** Create fresh light flat-config entries; no lint engine or watcher starts.
 * @param {PresetOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {Linter.Config[]} Fresh flat-config array owned by the caller; no engine checks run here.
 * @throws {Error} For invalid options or installed export-contract failures.
 */
export function createPackageConfig(
  options: PresetOptions = {}
): Linter.Config[] {
  /** Validated preset environment and immutable installed export snapshots. */
  const { environment, contracts, deprecations } = optionsFor(options);
  /** Fresh application-owned rule plugin; overlapping config entries reuse this identity. */
  const plugin = createZeruxPlugin(contracts, undefined, deprecations);
  let ambient = {};
  if (environment === 'node') {
    ambient = globals.node;
  } else if (environment === 'browser') {
    ambient = globals.browser;
  }
  return [
    {
      name: 'zerux/ignores',
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.zerux/**',
        '**/.output/**',
        '**/coverage/**',
      ],
    },
    {
      name: 'zerux/package',
      files: [...files],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
        globals: { ...globals.es2022, ...ambient },
      },
      plugins: { zerux: plugin },
      rules: {
        ...js.configs.recommended.rules,
        ...security,
        'zerux/deprecated-api': 'warn',
        ...(options.packageUsage ? { 'zerux/package-usage': 'error' } : {}),
        'no-unused-vars': [
          'warn',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    // Keep recommended parser-aware diagnostics scoped to TS rather than parsing every framework file.
    ...(tseslint.configs.recommended.map((config) => ({
      ...config,
      files: [...typescript],
    })) as Linter.Config[]),
    {
      name: 'zerux/package-types',
      files: [...typescript],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': [
          'warn',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        ...security,
        'zerux/deprecated-api': 'warn',
      },
    },
  ];
}
/** Create fresh strict application entries using the optional real localization extractor.
 * @param {PresetOptions} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @returns {Promise<Linter.Config[]>} Fresh strict flat config after the optional real extractor loads; missing peer rejects.
 * @throws {Error} Rejects for invalid options, export-contract failures or a missing/failing optional extractor.
 */
export async function createApplicationConfig(
  options: PresetOptions = {}
): Promise<Linter.Config[]> {
  /** Validated preset environment and immutable installed export snapshots. */
  const { environment, contracts, deprecations } = optionsFor(options);
  /** Optional actual localization extractor, loaded only for the strict preset. */
  const { extractMessages } = await import('zlocale/build');
  /** Fresh light config reused before adding strict application checks. */
  const config = createPackageConfig({
    ...options,
    environment,
    packageUsage: options.packageUsage ?? true,
  });
  // Replace only our plugin object before ESLint sees the array, keeping one plugin identity.
  // entry reuses the same fresh plugin identity across overlapping strict flat configurations.
  for (const entry of config) {
    if (entry.plugins?.zerux) {
      entry.plugins = {
        ...entry.plugins,
        zerux: createZeruxPlugin(contracts, extractMessages, deprecations),
      };
    }
  }
  return [
    ...config,
    {
      name: 'zerux/application',
      files: [...files],
      rules: {
        ...security,
        'zerux/deprecated-api': 'error',
        'zerux/locale-text-domain': 'error',
        'no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      name: 'zerux/application-types',
      files: [...typescript],
      rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        ...security,
        'zerux/deprecated-api': 'error',
      },
    },
  ];
}
/** Fresh factories are preferred when adding local overrides; this value performs no linting/I/O. */
export const packageDevelopment: Linter.Config[] = createPackageConfig();
