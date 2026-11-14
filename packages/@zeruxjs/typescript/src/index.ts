// Node tooling entry: use /presets alone for browser-safe configuration data.
export { registerTypescript } from './register.js';
export { createTsConfig } from './tsconfig.js';
export {
  transformTypescript,
  transpileTypescriptFile,
  checkTypes,
} from './transform.js';
export { buildTypescript } from './build.js';
export type {
  TransformOptions,
  TypecheckOptions,
  TypecheckResult,
} from './transform.js';
export type { TypeScriptBuildOptions } from './build.js';
export type { TsConfigOptions } from './tsconfig.js';

export { createTypeScriptPreset } from './presets.js';
export type {
  TypeScriptPresetName,
  TypeScriptPreset,
  PresetCompilerOptions,
} from './presets.js';
