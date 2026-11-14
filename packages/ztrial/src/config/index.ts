import { defaultConfig } from './defaults.js';
import { validateConfig } from './schema.js';
import type { ZtrialConfig } from '../types/config.js';
/** Validate explicit known configuration fields and merge defaults without discovering files, importing tests or starting optional environments.
 * @param {ZtrialConfig} config - Trusted JSON/programmatic settings, default empty overrides.
 * @returns {ZtrialConfig} Detached shallow settings; nested host-owned lists/patterns are not recursively cloned.
 */
export function defineConfig(config: ZtrialConfig = {}): ZtrialConfig {
  return { ...defaultConfig, ...validateConfig(config) };
}
export { validateConfig, defaultConfig };
