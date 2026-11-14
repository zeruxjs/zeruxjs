import {
  resolveApplicationConfig,
  type ConfigLayers,
} from './config-validation.js';
import path from 'node:path';

import type { ZeruxConfig, ZeruxStructureConfig } from '../index.js';
import { findExistingFile, importModule } from '../utils/fs.js';
import type { ResolvedStructure, RuntimeMode } from './types.js';

/** Legacy source-directory defaults; explicit configuration overrides each selected path. */
const DEFAULT_STRUCTURE: ZeruxStructureConfig = {
  app: 'app',
  middleware: ['middleware'],
  controllers: ['controllers'],
  composables: ['composables'],
  plugins: ['plugins'],
  public: ['public'],
  env: [],
};

/** Normalize optional single/multiple path fields without discovering extra directories.
 * @param {string | string[]} [value] - Explicit path setting.
 * @returns {string[]} Declared paths or an empty list.
 */
const asArray = (value?: string | string[]) => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

/** Resolve and deduplicate trusted host paths in declared order.
 * @param {string} rootDir - Project root.
 * @param {string[]} values - Declared relative/absolute paths.
 * @returns {string[]} Unique absolute paths.
 */
const uniquePaths = (rootDir: string, values: string[]) => [
  ...new Set(values.map((value) => path.resolve(rootDir, value))),
];

/** Select ordered environment filenames without reading credentials.
 * @param {string} rootDir - Project root.
 * @param {RuntimeMode} mode - Development/start selection.
 * @returns {string[]} Ordered explicit candidate paths.
 */
export const resolveDefaultEnvFiles = (
  rootDir: string,
  mode: RuntimeMode
): string[] => {
  /** Host NODE_ENV or the mode’s legacy default, not an inferred tenant context. */
  const environment =
    process.env.NODE_ENV || (mode === 'start' ? 'production' : 'development');

  return uniquePaths(rootDir, [
    '.env',
    '.env.local',
    `.env.${environment}`,
    `.env.${environment}.local`,
  ]);
};

/** Execute the first explicitly supported trusted config file and validate merged layers.
 * @param {string} rootDir - Trusted project root.
 * @param {RuntimeMode} mode - Source/production loader policy.
 * @param {Omit<ConfigLayers, "file">} [layers] - Explicit defaults/environment/overrides.
 * @returns {Promise<ZeruxConfig>} Validated configuration; module code remains trusted.
 */
export const loadConfig = async (
  rootDir: string,
  mode: RuntimeMode,
  layers: Omit<ConfigLayers, 'file'> = {}
): Promise<ZeruxConfig> => {
  /** First existing config file in the documented TypeScript/JavaScript priority order. */
  const configPath = findExistingFile(rootDir, [
    'zerux.config.ts',
    'zerux.config.js',
    'zerux.config.mjs',
    'zerux.config.cjs',
  ]);

  if (!configPath) {
    return resolveApplicationConfig(layers);
  }

  /** Executed trusted configuration namespace; never selected from request data. */
  const loaded = await importModule(configPath, mode);
  return resolveApplicationConfig({
    ...layers,
    file: (loaded.default ||
      loaded.zeruxConfig ||
      loaded.zdevConfig ||
      loaded) as ZeruxConfig,
  });
};

/** Resolve application source locations from explicit configuration and legacy defaults.
 * @param {string} rootDir - Trusted project root.
 * @param {ZeruxConfig} config - Validated application config.
 * @param {string} [serviceName] - Runtime private-directory namespace, default zerux.
 * @returns {ResolvedStructure} Explicit source/output/environment locations.
 */
export const resolveStructure = (
  rootDir: string,
  config: ZeruxConfig,
  serviceName = 'zerux'
): ResolvedStructure => {
  /** Configured application structure mode, separate from renderer capabilities. */
  const mode = config.type ?? 'fix';
  /** Defaults merged with explicit host source mappings. */
  const structure = {
    ...DEFAULT_STRUCTURE,
    ...(config.structure ?? {}),
  };

  /** Host NODE_ENV or the mode’s legacy default, not an inferred tenant context. */
  const environment =
    process.env.NODE_ENV ||
    (mode === 'function' ? 'production' : 'development');
  /** Host-selected environment files appended after the ordered default candidates. */
  const explicitEnvFiles = asArray(structure.env);
  /** Unique candidate paths; actual contents remain with the environment-file owner. */
  const envFiles = uniquePaths(rootDir, [
    ...resolveDefaultEnvFiles(
      rootDir,
      environment === 'production' ? 'start' : 'dev'
    ),
    ...explicitEnvFiles,
  ]);

  return {
    mode,
    rootDir,
    serviceName,
    entryPointName: config.entryPoint ?? 'index',
    appDir: structure.app ? path.resolve(rootDir, structure.app) : null,
    middlewareDirs: uniquePaths(rootDir, asArray(structure.middleware)),
    controllerDirs: uniquePaths(rootDir, asArray(structure.controllers)),
    composableDirs: uniquePaths(rootDir, asArray(structure.composables)),
    pluginDirs: uniquePaths(rootDir, asArray(structure.plugins)),
    publicDirs: uniquePaths(rootDir, asArray(structure.public)),
    envFiles,
    outputDir: path.resolve(rootDir, config.outDir ?? `.${serviceName}`),
    raw: structure,
  };
};
