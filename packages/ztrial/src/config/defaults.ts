import type { ZtrialConfig } from '../types/config.js';
/** Shallow-frozen inert compatibility defaults; constructing settings never discovers or executes tests. */
export const defaultConfig: Readonly<ZtrialConfig> = Object.freeze({
  timeoutMs: 5000,
  retries: 0,
  reporter: 'pretty',
  files: ['**/*.test.mjs', '**/*.test.js', '**/*.spec.mjs', '**/*.spec.js'],
  root: '.',
  bail: false,
  allowOnly: true,
});
